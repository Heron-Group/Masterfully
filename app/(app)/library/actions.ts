"use server";

import { promises as fs } from "node:fs";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { toSourceType } from "@/lib/content/schemas";
import type { SourceType } from "@/lib/dto";
import { detailsFromLink, detailsFromPdfBytes } from "@/lib/sources/details";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>, opts: { refresh?: boolean } = {}): Promise<ActionResult> {
  await requireSession();
  try {
    await fn();
    if (opts.refresh !== false) refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof ContentError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong on the server. Nothing was saved." };
  }
}

export type SourceProps = {
  title?: string;
  authors?: string[];
  year?: string;
  type?: string;
  url?: string;
};

/** Save one or more inline-edited properties. Empty year or link clears it. */
export async function updateSourceProps(id: string, props: SourceProps): Promise<ActionResult> {
  return run(async () => {
    const patch: Parameters<Awaited<ReturnType<typeof getContentStore>>["updateSource"]>[1] = {};
    if (props.title !== undefined) {
      if (!props.title.trim()) throw new ContentError("A source needs a title", 400);
      patch.title = props.title;
    }
    if (props.authors !== undefined) patch.authors = props.authors;
    if (props.type !== undefined) patch.type = toSourceType(props.type);
    if (props.year !== undefined) {
      const y = props.year.trim();
      if (y && !/^\d{1,4}$/.test(y)) throw new ContentError("Year should be a number like 2025", 400);
      patch.year = y ? Number(y) : null;
    }
    if (props.url !== undefined) {
      const u = props.url.trim();
      if (u && !/^https?:\/\//i.test(u)) throw new ContentError("The link should start with http:// or https://", 400);
      patch.url = u;
    }
    await (await getContentStore()).updateSource(id, patch);
  });
}

/** Autosave: rewrites only the ## Notes section. */
export async function saveSourceNotes(id: string, notes: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setSourceNotes(id, notes)), { refresh: false });
}

/** Remove one of a source's PDFs (`file` is its path, from SourceDto.pdfs). */
export async function removeSourcePdf(id: string, file: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.removeSourcePdf(id, file)));
}

/** Add a link (no `from`), change one (`from` → `to`), or remove one (`to` empty). */
export async function setSourceLink(id: string, change: { from?: string; to?: string }): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setSourceLink(id, change)));
}

export async function setSourceInGroup(sourceId: string, groupId: string, member: boolean): Promise<ActionResult> {
  return run(async () => {
    const store = await getContentStore();
    if (member) await store.addSourceToGroup(groupId, sourceId);
    else await store.removeSourceFromGroup(groupId, sourceId);
  });
}

export async function deleteSource(id: string): Promise<ActionResult> {
  const result = await run(() => getContentStore().then((s) => s.deleteSource(id)), { refresh: false });
  if (result.ok) redirect("/library");
  return result;
}

export type DetailsSuggestion = { from: string; title?: string; authors?: string[]; year?: number; type?: SourceType };
export type SuggestResult = { ok: true; suggestion: DetailsSuggestion | null; problems: string[] } | { ok: false; error: string };

/**
 * Read a source's details (title, authors, year, type) from one of its PDFs
 * or links: `target` names which, or all are tried in turn (PDFs first)
 * until one gives something. Nothing is saved; the page offers what's found.
 */
export async function suggestSourceDetails(id: string, target?: { kind: "pdf" | "link"; index: number }): Promise<SuggestResult> {
  await requireSession();
  try {
    const store = await getContentStore();
    const source = await store.getSource(id);
    if (!source) return { ok: false, error: "Source not found." };
    const candidates = [
      ...source.pdfs.map((file, index) => ({ kind: "pdf" as const, index, file })),
      ...source.links.map((url, index) => ({ kind: "link" as const, index, url })),
    ].filter((c) => !target || (c.kind === target.kind && c.index === target.index));
    const problems: string[] = [];
    for (const c of candidates) {
      let from: string;
      let details;
      if (c.kind === "pdf") {
        from = c.file.split("/").pop() ?? "the PDF";
        const abs = await store.attachmentPath(c.file);
        if (!abs) {
          problems.push(`${from} is missing`);
          continue;
        }
        details = await detailsFromPdfBytes(await fs.readFile(abs)).catch(() => null);
        if (!details) {
          problems.push(`${from} couldn't be read`);
          continue;
        }
      } else {
        from = c.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        const read = await detailsFromLink(c.url);
        if (!read.ok) {
          problems.push(`${from}: ${read.reason}`);
          continue;
        }
        details = read.details;
      }
      const { title, authors, year, type } = details;
      if (title || authors?.length || year) return { ok: true, suggestion: { from, title, authors, year, type }, problems };
      problems.push(`no details found in ${from}`);
    }
    return { ok: true, suggestion: null, problems };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Something went wrong reading the source's details." };
  }
}
