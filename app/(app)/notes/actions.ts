"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";

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

export async function renameNote(id: string, title: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.renameNote(id, title)));
}

/** Autosave: rewrites only the note's text, never the AI summary. */
export async function saveNoteText(id: string, text: string): Promise<ActionResult> {
  return run(() => getContentStore().then((s) => s.setNoteText(id, text)), { refresh: false });
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const result = await run(() => getContentStore().then((s) => s.deleteNote(id)), { refresh: false });
  if (result.ok) redirect("/notes");
  return result;
}
