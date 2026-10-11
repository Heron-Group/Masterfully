"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { toSourceType } from "@/lib/content/schemas";

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
