"use server";

import { promises as fs } from "node:fs";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { setByHand, SOURCE_DETAIL_FIELDS, toSourceType, type SourceDetailField } from "@/lib/content/schemas";
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

type Found = { title?: string; authors?: string[]; year?: number; type?: SourceType };
export type FilledField = { field: SourceDetailField; before: string; after: string };
/** Values before a fill-in, for Undo. A missing year is null (undefined wouldn't survive the trip to the page). */
export type PreviousDetails = { title?: string; authors?: string[]; year?: number | null; type?: SourceType };
export type FillResult =
  | { ok: true; from: string | null; filled: FilledField[]; previous: PreviousDetails; problems: string[] }
  | { ok: false; error: string };

const detailText = (field: SourceDetailField, v: Found): string =>
  field === "authors" ? (v.authors ?? []).join("; ") : field === "year" ? (v.year ? String(v.year) : "") : field === "type" ? (v.type ?? "") : (v.title ?? "");

/**
 * Fill in a source's details (title, authors, year, type) from one of its
 * PDFs or links: `target` names which, or all are tried in turn (PDFs first)
 * until one gives something. Details the user set themselves are never
 * changed. Returns what changed and the values before, for Undo.
 */
export async function fillSourceDetails(id: string, target?: { kind: "pdf" | "link"; index: number }): Promise<FillResult> {
  await requireSession();
  try {
    const store = await getContentStore();
    const source = await store.getSource(id);
    if (!source) return { ok: false, error: "Source not found." };
    const open = SOURCE_DETAIL_FIELDS.filter((f) => !setByHand(source).includes(f));
    const none = { ok: true as const, from: null, filled: [], previous: {} };
    if (!open.length) return { ...none, problems: [] };

    const candidates = [
      ...source.pdfs.map((file, index) => ({ kind: "pdf" as const, index, file })),
      ...source.links.map((url, index) => ({ kind: "link" as const, index, url })),
    ].filter((c) => !target || (c.kind === target.kind && c.index === target.index));
    const problems: string[] = [];
    for (const c of candidates) {
      let from: string;
      let details: Found | null = null;
      if (c.kind === "pdf") {
        from = c.file.split("/").pop() ?? "the PDF";
        const abs = await store.attachmentPath(c.file);
        details = abs ? await detailsFromPdfBytes(await fs.readFile(abs)).catch(() => null) : null;
        if (!details) problems.push(`${from} couldn't be read`);
      } else {
        from = c.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        const read = await detailsFromLink(c.url);
        if (read.ok) details = read.details;
        else problems.push(`${from}: ${read.reason}`);
      }
      if (!details || !(details.title || details.authors?.length || details.year)) continue;

      const filled = open
        .map((field) => ({ field, before: detailText(field, source), after: detailText(field, details) }))
        .filter((f) => f.after && f.after.toLowerCase() !== f.before.toLowerCase());
      if (!filled.length) return { ...none, from, problems };
      const patch: Parameters<typeof store.updateSource>[1] = { byHand: false };
      const previous: PreviousDetails = {};
      for (const { field } of filled) {
        if (field === "title") {
          patch.title = details.title;
          previous.title = source.title;
        } else if (field === "authors") {
          patch.authors = details.authors;
          previous.authors = source.authors;
        } else if (field === "year") {
          patch.year = details.year;
          previous.year = source.year ?? null;
        } else {
          patch.type = details.type;
          previous.type = source.type;
        }
      }
      await store.updateSource(id, patch);
      refresh();
      return { ok: true, from, filled, previous, problems };
    }
    return { ...none, problems };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Something went wrong reading the source's details." };
  }
}

/** Undo a fill-in: put back the values from before (still not counted as typed by the user). */
export async function undoFilledDetails(id: string, previous: PreviousDetails): Promise<ActionResult> {
  return run(async () => {
    const patch: Parameters<Awaited<ReturnType<typeof getContentStore>>["updateSource"]>[1] = { byHand: false };
    if ("title" in previous) patch.title = previous.title;
    if ("authors" in previous) patch.authors = previous.authors ?? [];
    if ("year" in previous) patch.year = previous.year ?? null;
    if ("type" in previous) patch.type = toSourceType(previous.type);
    await (await getContentStore()).updateSource(id, patch);
  });
}

/** Archive a source (hidden from the library, groups and map until shown) or bring it back. */
export async function setSourceArchived(id: string, archived: boolean): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setSourceArchived(id, archived)));
}
