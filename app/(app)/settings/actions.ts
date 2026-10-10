"use server";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { fakeAiEnabled } from "@/lib/ai/client";
import { AI_PROVIDERS, getAiSettings, updateAiSettings, type AiProvider, type AiSettingsView } from "@/lib/ai/user-config";
import { requireSession } from "@/lib/auth";

export type AiSettingsResult = { ok: true; settings: AiSettingsView; warning?: string } | { ok: false; error: string };

/**
 * Check a key with a free request (listing models). Returns an error for a
 * key the provider rejects; a network problem only warns, so a key can
 * still be saved while the provider is unreachable.
 */
async function checkKey(provider: AiProvider, apiKey: string): Promise<{ error?: string; warning?: string }> {
  if (fakeAiEnabled()) return {};
  try {
    if (provider === "anthropic") await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 1 });
    else await new OpenAI({ apiKey, maxRetries: 1 }).models.list();
    return {};
  } catch (err) {
    const status = err instanceof Anthropic.APIError || err instanceof OpenAI.APIError ? err.status : undefined;
    if (status === 401 || status === 403) return { error: "That key was rejected. Check you copied all of it." };
    return { warning: "Saved, but the key couldn't be checked just now." };
  }
}

export async function saveAiSettings(update: {
  provider: AiProvider;
  model?: string;
  apiKey?: string;
}): Promise<AiSettingsResult> {
  const account = await requireSession();
  if (!AI_PROVIDERS.includes(update.provider)) return { ok: false, error: "Unknown provider." };
  try {
    let warning: string | undefined;
    if (update.apiKey?.trim()) {
      const check = await checkKey(update.provider, update.apiKey.trim());
      if (check.error) return { ok: false, error: check.error };
      warning = check.warning;
    }
    await updateAiSettings(account.id, update);
    return { ok: true, settings: await getAiSettings(account.id), warning };
  } catch (err) {
    if (err instanceof Error && /doesn't look like/.test(err.message)) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong on the server. Nothing was saved." };
  }
}
