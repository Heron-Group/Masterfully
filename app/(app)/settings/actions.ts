"use server";

import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";

export async function saveResearchContext(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireSession();
  try {
    await (await getContentStore()).setResearchContext(text);
    return { ok: true };
  } catch (err) {
    if (err instanceof ContentError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong on the server. Nothing was saved." };
  }
}
