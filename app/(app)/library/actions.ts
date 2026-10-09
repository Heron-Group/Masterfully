"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { toSourceType } from "@/lib/content/schemas";
import { sourceFields } from "@/lib/uploads";

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

export async function updateSourceDetails(id: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const fields = sourceFields((n) => {
      const v = form.get(n);
      return typeof v === "string" ? v : undefined;
    });
    if (!fields.title) throw new ContentError("A source needs a title", 400);
    await (await getContentStore()).updateSource(id, {
      ...fields,
      type: toSourceType(fields.type),
      url: fields.url ?? "",
    });
  });
}

/** Autosave: rewrites only the ## Notes section. */
export async function saveSourceNotes(id: string, notes: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setSourceNotes(id, notes)), { refresh: false });
}

export async function removeSourcePdf(id: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setSourcePdf(id, null)));
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
