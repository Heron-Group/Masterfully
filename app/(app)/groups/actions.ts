"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import type { GroupSourceRef } from "@/lib/content";

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

export async function createGroup(title: string): Promise<ActionResult> {
  let id = "";
  const result = await run(async () => {
    id = (await (await getContentStore()).createGroup({ title })).id;
  }, { refresh: false });
  if (result.ok) redirect(`/groups/${id}`);
  return result;
}

export async function renameGroup(id: string, title: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.renameGroup(id, title)));
}

/** Autosave: rewrites only the ## Overview section. */
export async function saveGroupOverview(id: string, overview: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setGroupOverview(id, overview)), { refresh: false });
}

/** Save a new order (drag and drop). */
export async function reorderGroupSources(id: string, refs: GroupSourceRef[]): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setGroupSources(id, refs)), { refresh: false });
}

export async function saveGroupSourceNote(id: string, sourceId: string, note: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setGroupSourceNote(id, sourceId, note)), { refresh: false });
}

export async function addSourcesToGroup(id: string, sourceIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const store = await getContentStore();
    for (const sourceId of sourceIds) await store.addSourceToGroup(id, sourceId);
  });
}

export async function removeSourceFromGroup(id: string, sourceId: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.removeSourceFromGroup(id, sourceId)));
}

/** Deleting a group never deletes its sources. */
export async function deleteGroup(id: string): Promise<ActionResult> {
  const result = await run(() => getContentStore().then((s) => s.deleteGroup(id)), { refresh: false });
  if (result.ok) redirect("/groups");
  return result;
}
