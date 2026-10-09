import "server-only";
import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Group, Source } from "../content";
import type { ContentStore } from "../content/store";
import type { AiEvent } from "../dto";
import { aiConfigured, aiModel, anthropic, modelOptions, fakeAiEnabled } from "./client";
import { fakeRefuses, fakeStream } from "./fake";
import { fetchReadable } from "./fetch-url";
import { MAX_DIRECT_PDF_BYTES, MAX_DIRECT_PDF_PAGES, pdfPageCount, pdfTextChunks } from "./pdf";
import { chunkPrompt, groupPrompt, SYSTEM_PROMPT, sourcePrompt, type SourceMaterial, type SourceMeta } from "./prompts";

type Content = Anthropic.Beta.BetaContentBlockParam[];
type RunResult = { text: string; model: string; truncated: boolean };

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: NonNullable<Extract<AiEvent, { type: "error" }>["code"]>,
  ) {
    super(message);
  }
}

/**
 * Stream one request to Claude, yielding text deltas as events, and return
 * the final text. With `quiet`, nothing is yielded (used for the parts of a
 * long PDF, which are combined afterwards).
 */
async function* runClaude(content: Content, opts: { signal?: AbortSignal; quiet?: boolean; maxTokens?: number }): AsyncGenerator<AiEvent, RunResult> {
  const model = aiModel();
  if (fakeAiEnabled()) {
    const prompt = content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    if (fakeRefuses(prompt)) throw new AiError("The model declined to summarise this (simulated refusal).", "refusal");
    let text = "";
    for await (const delta of fakeStream(prompt, opts.signal)) {
      text += delta;
      if (!opts.quiet) yield { type: "delta", text: delta };
    }
    return { text, model: "fake-model", truncated: false };
  }

  const stream = anthropic().beta.messages.stream(
    {
      model,
      max_tokens: opts.maxTokens ?? 16_000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      ...modelOptions(model),
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

/** Map SDK errors to a message the researcher can act on. */
export function describeError(err: unknown): { message: string; code: Extract<AiEvent, { type: "error" }>["code"] } {
  if (err instanceof AiError) return { message: err.message, code: err.code };
  if (err instanceof Anthropic.AuthenticationError) return { message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.", code: "not_configured" };
  if (err instanceof Anthropic.NotFoundError) return { message: `The model "${aiModel()}" wasn't found. Check ANTHROPIC_MODEL.`, code: "api" };
  if (err instanceof Anthropic.RateLimitError) return { message: "The API is rate-limiting requests. Wait a minute and try again.", code: "api" };
  if (err instanceof Anthropic.BadRequestError) return { message: `The API rejected the request: ${err.message}`, code: "api" };
  if (err instanceof Anthropic.APIConnectionError) return { message: "Couldn't reach the Anthropic API. Check the server's internet connection and try again.", code: "api" };
  if (err instanceof Anthropic.APIError) return { message: `The API returned an error (${err.status ?? "unknown"}). Try again shortly.`, code: "api" };
  console.error("[ai]", err);
  return { message: err instanceof Error ? err.message : "Something went wrong while summarising.", code: "api" };
}

function metaOf(s: Source): SourceMeta {
  return { title: s.title, authors: s.authors, year: s.year, type: s.type, url: s.url };
}

/**
 * Summarise a source. Uses the PDF if there is one (in parts if it is too
 * large), otherwise the readable text at its link, otherwise (only when
 * asked with mode "metadata") the details and notes alone. Saves the result
 * to the ## AI summary section only after it completes.
 */
export async function* summariseSource(
  store: ContentStore,
  id: string,
  opts: { mode?: "metadata"; signal?: AbortSignal } = {},
): AsyncGenerator<AiEvent> {
  if (!aiConfigured()) {
    yield { type: "error", code: "not_configured", message: "AI summaries need ANTHROPIC_API_KEY to be set on the server." };
    return;
  }
  const source = await store.getSource(id);
  if (!source) {
    yield { type: "error", code: "not_found", message: "Source not found." };
    return;
  }
  const { researchContext } = await store.getSettings();
  const meta = metaOf(source);
  const base = { meta, notes: source.notes, researchContext };

  try {
    let result: RunResult;
    if (opts.mode === "metadata") {
      result = yield* runClaude([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "metadata-only" } }) }], opts);
    } else if (source.pdf) {
      const abs = await store.attachmentPath(source.pdf);
      if (!abs) throw new AiError(`The PDF file (${source.pdf}) is missing from the content folder.`, "api");
      result = yield* summarisePdf(await fs.readFile(abs), base, opts);
    } else if (source.url) {
      yield { type: "notice", message: "Reading the linked page…" };
      const page = await fetchReadable(source.url);
      if (!page.ok) {
        yield {
          type: "error",
          code: "url_unavailable",
          message: `Couldn't read the linked page: ${page.reason}.`,
        };
        return;
      }
      if (page.kind === "pdf") {
        result = yield* summarisePdf(page.data, base, opts);
      } else {
        const material: SourceMaterial = { kind: "web", text: page.text.slice(0, 400_000), pageTitle: page.title };
        result = yield* runClaude([{ type: "text", text: sourcePrompt({ ...base, material }) }], opts);
      }
    } else {
      yield { type: "notice", message: "There's no PDF or link, so this summary uses only the details and your notes." };
      result = yield* runClaude([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "metadata-only" } }) }], opts);
    }

    if (!result.text) throw new AiError("The model returned an empty summary. Nothing was saved.", "api");
    const saved = await store.setSourceAiSummary(id, { text: result.text, model: result.model });
    yield {
      type: "done",
      summary: saved.aiSummary ?? { text: result.text, model: result.model },
      warning: result.truncated ? "The summary hit the length limit and may be cut short." : undefined,
    };
  } catch (err) {
    if (opts.signal?.aborted) return;
    yield { type: "error", ...describeError(err) };
  }
}

async function* summarisePdf(
  data: Buffer,
  base: { meta: SourceMeta; notes: string; researchContext: string },
  opts: { signal?: AbortSignal },
): AsyncGenerator<AiEvent, RunResult> {
  const pages = await pdfPageCount(data);
  const direct = data.length <= MAX_DIRECT_PDF_BYTES && (pages ?? 0) <= MAX_DIRECT_PDF_PAGES;
  if (direct) {
    try {
      return yield* runClaude(
        [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } },
          { type: "text", text: sourcePrompt({ ...base, material: { kind: "pdf" } }) },
        ],
        opts,
      );
    } catch (err) {
      // A PDF can be within the byte and page limits but still too long for
      // one request; fall back to reading it in parts.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
    }
  }

  const chunks = await pdfTextChunks(data);
  if (!chunks.length) {
    throw new AiError("This PDF has no extractable text (it may be scanned images), and it is too large to send whole.", "api");
  }
  yield {
    type: "notice",
    message: `This PDF${pages ? ` (${pages} pages)` : ""} is too large to read in one request, so it is being summarised in ${chunks.length} part${chunks.length === 1 ? "" : "s"} from its extracted text and then combined. This takes longer.`,
  };
  const summaries: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    yield { type: "notice", message: `Reading pages ${chunk.firstPage}–${chunk.lastPage} (part ${i + 1} of ${chunks.length})…` };
    const part = yield* runClaude(
      [{ type: "text", text: chunkPrompt({ meta: base.meta, part: i + 1, parts: chunks.length, firstPage: chunk.firstPage, lastPage: chunk.lastPage, text: chunk.text }) }],
      { ...opts, quiet: true, maxTokens: 8_000 },
    );
    summaries.push(part.text);
  }
  yield { type: "notice", message: "Combining the parts…" };
  return yield* runClaude([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "chunk-summaries", summaries } }) }], opts);
}

/** Summarise a reading group from its sources' details, notes and AI summaries. */
export async function* summariseGroup(store: ContentStore, id: string, opts: { signal?: AbortSignal } = {}): AsyncGenerator<AiEvent> {
  if (!aiConfigured()) {
    yield { type: "error", code: "not_configured", message: "AI summaries need ANTHROPIC_API_KEY to be set on the server." };
    return;
  }
  const group: Group | null = await store.getGroup(id);
  if (!group) {
    yield { type: "error", code: "not_found", message: "Group not found." };
    return;
  }
  if (!group.sources.length) {
    yield { type: "error", code: "api", message: "Add some sources to the group first." };
    return;
  }
  const { researchContext } = await store.getSettings();
  const sources = [];
  for (const ref of group.sources) {
    const s = await store.getSource(ref.id);
    if (!s) continue;
    sources.push({ meta: metaOf(s), groupNote: ref.note, notes: s.notes, aiSummary: s.aiSummary?.text });
  }
  const missingSummaries = sources.filter((s) => !s.aiSummary).length;
  if (missingSummaries) {
    yield {
      type: "notice",
      message: `${missingSummaries} of ${sources.length} sources have no AI summary yet, so the group summary relies on your notes for those.`,
    };
  }
  try {
    const result = yield* runClaude(
      [{ type: "text", text: groupPrompt({ title: group.title, overview: group.overview, researchContext, sources }) }],
      opts,
    );
    if (!result.text) throw new AiError("The model returned an empty summary. Nothing was saved.", "api");
    const saved = await store.setGroupAiSummary(id, { text: result.text, model: result.model });
    yield {
      type: "done",
      summary: saved.aiSummary ?? { text: result.text, model: result.model },
      warning: result.truncated ? "The summary hit the length limit and may be cut short." : undefined,
    };
  } catch (err) {
    if (opts.signal?.aborted) return;
    yield { type: "error", ...describeError(err) };
  }
}

/** Stream events to the browser as newline-delimited JSON. */
export function ndjsonResponse(events: AsyncGenerator<AiEvent>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
