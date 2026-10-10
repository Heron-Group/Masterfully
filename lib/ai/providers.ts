import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AiEvent } from "../dto";
import { modelOptions } from "./client";
import { fakeRefuses, fakeStream } from "./fake";
import { SYSTEM_PROMPT } from "./prompts";
import { PROVIDER_LABELS, type AiCredentials } from "./user-config";

/** One request's input, independent of provider. */
export type Part = { type: "text"; text: string } | { type: "pdf"; data: Buffer };
export type RunResult = { text: string; model: string; truncated: boolean };
export type RunOptions = { signal?: AbortSignal; quiet?: boolean; maxTokens?: number };

/** The provider to call: a user's own key, or the development fake. */
export type AiBackend = AiCredentials | { provider: "fake" };

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: NonNullable<Extract<AiEvent, { type: "error" }>["code"]>,
  ) {
    super(message);
  }
}

/**
 * Stream one request, yielding text deltas as events, and return the final
 * text. With `quiet`, nothing is yielded (used for the parts of a long PDF,
 * which are combined afterwards).
 */
export async function* runModel(backend: AiBackend, parts: Part[], opts: RunOptions): AsyncGenerator<AiEvent, RunResult> {
  if (backend.provider === "fake") return yield* runFake(parts, opts);
  if (backend.provider === "openai") return yield* runOpenAI(backend, parts, opts);
  return yield* runClaude(backend, parts, opts);
}

async function* runFake(parts: Part[], opts: RunOptions): AsyncGenerator<AiEvent, RunResult> {
  const prompt = parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  if (fakeRefuses(prompt)) throw new AiError("The model declined to summarise this (simulated refusal).", "refusal");
  let text = "";
  for await (const delta of fakeStream(prompt, opts.signal)) {
    text += delta;
    if (!opts.quiet) yield { type: "delta", text: delta };
  }
  return { text, model: "fake-model", truncated: false };
}

async function* runClaude(cred: AiCredentials, parts: Part[], opts: RunOptions): AsyncGenerator<AiEvent, RunResult> {
  const client = new Anthropic({ apiKey: cred.apiKey, maxRetries: 2 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data.toString("base64") } },
  );
  const stream = client.beta.messages.stream(
    {
      model: cred.model,
      max_tokens: opts.maxTokens ?? 16_000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      ...modelOptions(cred.model),
    },
    { signal: opts.signal },
  );
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "fallback") {
      if (!opts.quiet) yield { type: "reset", message: "The first model declined; another model is writing the summary instead." };
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && !opts.quiet) {
      yield { type: "delta", text: event.delta.text };
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new AiError(
      `The model declined to summarise this${final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : "."}`,
      "refusal",
    );
  }
  // Keep only the text written after the last model switch.
  const lastFallback = final.content.map((b) => b.type).lastIndexOf("fallback");
  const text = final.content
    .slice(lastFallback + 1)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  return { text, model: final.model, truncated: final.stop_reason === "max_tokens" };
}

async function* runOpenAI(cred: AiCredentials, parts: Part[], opts: RunOptions): AsyncGenerator<AiEvent, RunResult> {
  const client = new OpenAI({ apiKey: cred.apiKey, maxRetries: 2 });
  const content: OpenAI.Responses.ResponseInputContent[] = parts.map((p) =>
    p.type === "text"
      ? { type: "input_text", text: p.text }
      : { type: "input_file", filename: "source.pdf", file_data: `data:application/pdf;base64,${p.data.toString("base64")}` },
  );
  const stream = client.responses.stream(
    {
      model: cred.model,
      instructions: SYSTEM_PROMPT,
      input: [{ role: "user", content }],
      max_output_tokens: opts.maxTokens ?? 16_000,
      store: false,
    },
    { signal: opts.signal },
  );
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && !opts.quiet) yield { type: "delta", text: event.delta };
  }
  const final = await stream.finalResponse();
  const refusal = final.output
    .flatMap((o) => (o.type === "message" ? o.content : []))
    .find((c) => c.type === "refusal");
  if (refusal) throw new AiError(`The model declined to summarise this: ${refusal.refusal}`, "refusal");
  return {
    text: final.output_text.trim(),
    model: final.model,
    truncated: final.status === "incomplete" && final.incomplete_details?.reason === "max_output_tokens",
  };
}

/** True when a request was rejected as invalid (e.g. a PDF too long for one request). */
export function isBadRequest(err: unknown): boolean {
  return err instanceof Anthropic.BadRequestError || err instanceof OpenAI.BadRequestError;
}

type ErrorCode = Extract<AiEvent, { type: "error" }>["code"];

/** Map SDK errors to a message the researcher can act on. */
export function describeError(err: unknown, backend?: AiBackend): { message: string; code: ErrorCode } {
  if (err instanceof AiError) return { message: err.message, code: err.code };
  const label = backend && backend.provider !== "fake" ? PROVIDER_LABELS[backend.provider] : "AI provider";
  const model = backend && backend.provider !== "fake" ? backend.model : "";
  const api = err instanceof Anthropic.APIError || err instanceof OpenAI.APIError ? err : null;
  if (api) {
    const status = api.status;
    if (status === 401 || status === 403)
      return { message: `Your ${label} API key was rejected. Check it in Settings.`, code: "not_configured" };
    if (status === 404) return { message: `The model "${model}" wasn't found. Check the model name in Settings.`, code: "api" };
    if (status === 429)
      return { message: `${label} is rate-limiting requests, or your account is out of credit. Wait a minute and try again.`, code: "api" };
    if (status === 400) return { message: `${label} rejected the request: ${api.message}`, code: "api" };
    if (status === undefined)
      return { message: `Couldn't reach ${label}. Check the server's internet connection and try again.`, code: "api" };
    return { message: `${label} returned an error (${status}). Try again shortly.`, code: "api" };
  }
  console.error("[ai]", err);
  return { message: err instanceof Error ? err.message : "Something went wrong while summarising.", code: "api" };
}
