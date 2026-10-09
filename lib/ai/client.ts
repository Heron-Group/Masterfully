import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** The model is set by ANTHROPIC_MODEL so it can change without a code change. */
export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim() || fakeAiEnabled();
}

/**
 * Development and tests only: AI_FAKE=1 replaces the API with a scripted
 * stream so the summary flow can be exercised without spending money.
 */
export function fakeAiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AI_FAKE === "1";
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}

// Models that accept server-side refusal fallbacks ("default" mode) and the
// effort setting. Other models (e.g. an older one set in ANTHROPIC_MODEL)
// are called without these options.
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;
const EFFORT_MODELS = /^claude-(opus-5|opus-4-[5-8]|sonnet-5|fable-5|haiku-5|sonnet-4-6|opus-4-6)/;

export function modelOptions(model: string) {
  return {
    ...(FALLBACK_MODELS.test(model)
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
    ...(EFFORT_MODELS.test(model) ? { output_config: { effort: "high" as const } } : {}),
  };
}
