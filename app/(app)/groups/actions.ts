"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import type { GroupSourceRef } from "@/lib/content";
import { isPaletteColour } from "@/lib/map/colours";
import { updateMapLayout } from "@/lib/map/layout";

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

/** Create a group (from the blank new-group page); returns its id. */
export async function createGroup(title: string, overview = ""): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let id = "";
  const result = await run(async () => {
    id = (await (await getContentStore()).createGroup({ title, overview })).id;
  }, { refresh: false });
  return result.ok ? { ok: true, id } : result;
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

/** The group's colour on the Source Map (one of the palette's colours), saved in map-layout.json. */
export async function setGroupColour(id: string, hex: string): Promise<ActionResult> {
  const account = await requireSession();
  if (!isPaletteColour(hex)) return { ok: false, error: "Choose one of the palette's colours." };
  try {
    await updateMapLayout(account.id, (layout) => {
      layout.colours[id] = hex;
    });
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, error: "Something went wrong on the server. Nothing was saved." };
  }
}

/** Archive a group with all its sources, or bring them back. */
export async function setGroupArchived(id: string, archived: boolean): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setGroupArchived(id, archived)));
}
