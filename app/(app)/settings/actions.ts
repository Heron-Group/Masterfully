"use server";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { fakeAiEnabled } from "@/lib/ai/client";
import { AI_PROVIDERS, DEFAULT_MODELS, getAiSettings, getProviderKey, updateAiSettings, type AiProvider, type AiSettingsView } from "@/lib/ai/user-config";
import { requireSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";

/** Autosave for the research context (settings.md). */
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

export type ModelOption = { id: string; label: string };

/** Offered when there's no key to ask the provider with. */
const SUGGESTED: Record<AiProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  ],
  openai: [{ id: DEFAULT_MODELS.openai, label: DEFAULT_MODELS.openai }],
};

// OpenAI lists every model it has; keep the ones that write text.
const OPENAI_TEXT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_TEXT = /(audio|realtime|tts|transcribe|search|image|embedding|moderation|instruct|codex|computer)/;

const listCache = new Map<string, { at: number; models: ModelOption[] }>();

/**
 * The models the user's key can use, from the provider (cached for an hour),
 * or suggestions when there's no key yet. `live` says which it is.
 */
export async function listModels(provider: AiProvider): Promise<{ models: ModelOption[]; live: boolean }> {
  const account = await requireSession();
  if (!AI_PROVIDERS.includes(provider)) return { models: [], live: false };
  const apiKey = await getProviderKey(account.id, provider);
  if (!apiKey || fakeAiEnabled()) return { models: SUGGESTED[provider], live: false };
  const cacheKey = `${account.id}:${provider}`;
  const hit = listCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return { models: hit.models, live: true };
  try {
    let models: ModelOption[];
    if (provider === "anthropic") {
      const page = await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 100 });
      models = page.data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
    } else {
      const page = await new OpenAI({ apiKey, maxRetries: 1 }).models.list();
      models = page.data
        .filter((m) => OPENAI_TEXT.test(m.id) && !OPENAI_NOT_TEXT.test(m.id))
        .sort((a, b) => b.created - a.created)
        .map((m) => ({ id: m.id, label: m.id }));
    }
    if (!models.length) return { models: SUGGESTED[provider], live: false };
    listCache.set(cacheKey, { at: Date.now(), models });
    return { models, live: true };
  } catch {
    return { models: SUGGESTED[provider], live: false };
  }
}
