import "server-only";

/**
 * Development and tests only: AI_FAKE=1 replaces the providers with a
 * scripted stream so the summary flow can be exercised without an API key
 * or spending money.
 */
export function fakeAiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AI_FAKE === "1";
}

// Claude models that accept server-side refusal fallbacks ("default" mode)
// and the effort setting. Other models (e.g. an older one a user picks) are
// called without these options.
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
