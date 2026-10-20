import "server-only";
import { promises as fs } from "node:fs";
import type { Group, Note, Source } from "../content";
import type { ContentStore } from "../content/store";
import type { AiEvent } from "../dto";
import { fakeAiEnabled } from "./client";
import { fetchReadable } from "./fetch-url";
import { MAX_DIRECT_PDF_BYTES, MAX_DIRECT_PDF_PAGES, pdfPageCount, pdfTextChunks } from "./pdf";
import { chunkPrompt, splitOverview, groupPrompt, notePrompt, sourcePrompt, type SourceMaterial, type SourceMeta } from "./prompts";
import { AiError, describeError, isBadRequest, runModel, type AiBackend, type Part, type RunOptions, type RunResult } from "./providers";
import { getAiCredentials } from "./user-config";

export { describeError } from "./providers";

type Opts = RunOptions & { backend: AiBackend | null };

const NOT_CONFIGURED = "Add your Claude or OpenAI API key in Settings to generate AI summaries.";

/** The provider to use for a user: their own key, or the fake in development. */
export async function backendFor(userId: string): Promise<AiBackend | null> {
  if (fakeAiEnabled()) return { provider: "fake", userId };
  const credentials = await getAiCredentials(userId);
  return credentials && { ...credentials, userId };
}

function run(parts: Part[], opts: Opts) {
  return runModel(opts.backend!, parts, opts);
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
  opts: Opts & { mode?: "metadata" },
): AsyncGenerator<AiEvent> {
  if (!opts.backend) {
    yield { type: "error", code: "not_configured", message: NOT_CONFIGURED };
    return;
  }
  const source = await store.getSource(id);
  if (!source) {
    yield { type: "error", code: "not_found", message: "Source not found." };
    return;
  }
  const meta = metaOf(source);
  const base = { meta, notes: source.notes };

  try {
    let result: RunResult;
    if (opts.mode === "metadata") {
      result = yield* run([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "metadata-only" } }) }], opts);
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
        result = yield* run([{ type: "text", text: sourcePrompt({ ...base, material }) }], opts);
      }
    } else {
      yield { type: "notice", message: "There's no PDF or link, so this summary uses only the details and your notes." };
      result = yield* run([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "metadata-only" } }) }], opts);
    }

    if (!result.text) throw new AiError("The model returned an empty summary. Nothing was saved.", "api");
    // The short overview at the end is kept separately, for group pages.
    const { summary, overview } = splitOverview(result.text);
    const saved = await store.setSourceAiSummary(id, { text: summary, model: result.model, overview });
    yield {
      type: "done",
      summary: saved.aiSummary ?? { text: summary, model: result.model },
      warning: result.truncated ? "The summary hit the length limit and may be cut short." : undefined,
    };
  } catch (err) {
    if (opts.signal?.aborted) return;
    yield { type: "error", ...describeError(err, opts.backend ?? undefined) };
  }
}

async function* summarisePdf(
  data: Buffer,
  base: { meta: SourceMeta; notes: string },
  opts: Opts,
): AsyncGenerator<AiEvent, RunResult> {
  const pages = await pdfPageCount(data);
  const direct = data.length <= MAX_DIRECT_PDF_BYTES && (pages ?? 0) <= MAX_DIRECT_PDF_PAGES;
  if (direct) {
    try {
      return yield* run(
        [
          { type: "pdf", data },
          { type: "text", text: sourcePrompt({ ...base, material: { kind: "pdf" } }) },
        ],
        opts,
      );
    } catch (err) {
      // A PDF can be within the byte and page limits but still too long for
      // one request; fall back to reading it in parts.
      if (!isBadRequest(err)) throw err;
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
    const part = yield* run(
      [{ type: "text", text: chunkPrompt({ meta: base.meta, part: i + 1, parts: chunks.length, firstPage: chunk.firstPage, lastPage: chunk.lastPage, text: chunk.text }) }],
      { ...opts, quiet: true, maxTokens: 8_000 },
    );
    summaries.push(part.text);
  }
  yield { type: "notice", message: "Combining the parts…" };
  return yield* run([{ type: "text", text: sourcePrompt({ ...base, material: { kind: "chunk-summaries", summaries } }) }], opts);
}

/** Summarise a reading group from its sources' details, notes and AI summaries. */
export async function* summariseGroup(store: ContentStore, id: string, opts: Opts): AsyncGenerator<AiEvent> {
  if (!opts.backend) {
    yield { type: "error", code: "not_configured", message: NOT_CONFIGURED };
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
    const result = yield* run(
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
    yield { type: "error", ...describeError(err, opts.backend ?? undefined) };
  }
}

/** At most this many attached PDFs are sent with a note summary. */
const MAX_NOTE_PDFS = 3;

/** Summarise a note: its text, and any attached PDFs small enough to send whole. */
export async function* summariseNote(store: ContentStore, id: string, opts: Opts): AsyncGenerator<AiEvent> {
  if (!opts.backend) {
    yield { type: "error", code: "not_configured", message: NOT_CONFIGURED };
    return;
  }
  const note: Note | null = await store.getNote(id);
  if (!note) {
    yield { type: "error", code: "not_found", message: "Note not found." };
    return;
  }
  const pdfs: { name: string; data: Buffer }[] = [];
  const skipped: string[] = [];
  const others: string[] = [];
  for (const a of note.attachments) {
    if (a.type !== "application/pdf") {
      others.push(a.name);
      continue;
    }
    const abs = await store.attachmentPath(a.file);
    const data = abs ? await fs.readFile(abs) : null;
    const pages = data ? await pdfPageCount(data) : null;
    if (data && pdfs.length < MAX_NOTE_PDFS && data.length <= MAX_DIRECT_PDF_BYTES && (pages ?? 0) <= MAX_DIRECT_PDF_PAGES) {
      pdfs.push({ name: a.name, data });
    } else {
      skipped.push(a.name);
    }
  }
  if (!note.text.trim() && !pdfs.length) {
    yield { type: "error", code: "api", message: "Write something in the note (or attach a PDF) first." };
    return;
  }
  if (skipped.length) {
    yield {
      type: "notice",
      message: `Not included (too large, or more than ${MAX_NOTE_PDFS} PDFs): ${skipped.join(", ")}.`,
    };
  }
  const { researchContext } = await store.getSettings();
  try {
    const result = yield* run(
      [
        ...pdfs.map((p): Part => ({ type: "pdf", data: p.data })),
        {
          type: "text",
          text: notePrompt({
            title: note.title,
            text: note.text,
            pdfNames: pdfs.map((p) => p.name),
            otherAttachments: [...others, ...skipped],
            researchContext,
          }),
        },
      ],
      opts,
    );
    if (!result.text) throw new AiError("The model returned an empty summary. Nothing was saved.", "api");
    const saved = await store.setNoteAiSummary(id, { text: result.text, model: result.model });
    yield {
      type: "done",
      summary: saved.aiSummary ?? { text: result.text, model: result.model },
      warning: result.truncated ? "The summary hit the length limit and may be cut short." : undefined,
    };
  } catch (err) {
    if (opts.signal?.aborted) return;
    yield { type: "error", ...describeError(err, opts.backend ?? undefined) };
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
