// Text handling for reading aloud: splitting into sentences, estimating
// listening time, and finding a sentence again in the page's text so it can
// be highlighted. No browser APIs here, so it can be unit-tested.

/** A typical pace for synthesised speech at 1× speed. */
export const WORDS_PER_MINUTE = 155;

export type Block = { text: string; page?: number };
export type Sentence = { text: string; page?: number; words: number };

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en-GB", { granularity: "sentence" })
    : null;

/** Text ending in one of these isn't the end of a sentence. */
const ABBREVIATION =
  /(?:^|[\s(])(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|cf|e\.g|i\.e|etc|et al|al|ed|eds|vol|vols|no|nos|p|pp|ch|fig|figs|eq|approx|ca|c)\.$/i;

/** Split text into sentences (keeping each block, e.g. a paragraph or page, separate). */
export function toSentences(blocks: Block[]): Sentence[] {
  const out: Sentence[] = [];
  for (const block of blocks) {
    const text = block.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const parts = segmenter
      ? [...segmenter.segment(text)].map((s) => s.segment)
      : text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
    let pending = "";
    for (const part of parts) {
      const t = `${pending}${part}`.trim();
      // "Dr.", "et al.", "p." and the like don't end a sentence.
      if (ABBREVIATION.test(t)) {
        pending = `${t} `;
        continue;
      }
      pending = "";
      const words = countWords(t);
      if (words) out.push({ text: t, page: block.page, words });
    }
    if (pending.trim()) out.push({ text: pending.trim(), page: block.page, words: countWords(pending) });
  }
  return out;
}

/** "About 14 min" / "About 40 sec" to listen to `words` at `rate`. */
export function formatListeningTime(words: number, rate = 1): string {
  const seconds = Math.max(1, Math.round((words / (WORDS_PER_MINUTE * rate)) * 60));
  if (seconds < 60) return `About ${Math.max(5, Math.round(seconds / 5) * 5)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `About ${h} hr${m ? ` ${m} min` : ""}`;
}

/** "12:30" for a countdown. */
export function formatClock(words: number, rate = 1): string {
  const total = Math.round((words / (WORDS_PER_MINUTE * rate)) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Text with all whitespace collapsed and lower-cased, plus where each
 * character came from, so a sentence can be found in text laid out
 * differently (line breaks, extra spaces) and mapped back to the original.
 */
export function normalise(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!space) {
        out += " ";
        map.push(i);
        space = true;
      }
    } else {
      out += ch.toLowerCase();
      map.push(i);
      space = false;
    }
  }
  return { text: out, map };
}

/**
 * Where `needle` occurs in `haystack` at or after `from` (an index into
 * haystack), ignoring differences in whitespace and case. Returns offsets
 * into the original haystack, or null.
 */
export function findText(haystack: string, needle: string, from = 0): { start: number; end: number } | null {
  const h = normalise(haystack);
  const n = normalise(needle).text.trim();
  if (!n) return null;
  let fromN = h.map.findIndex((i) => i >= from);
  if (fromN < 0) return null;
  let at = h.text.indexOf(n, fromN);
  if (at < 0 && fromN > 0) at = h.text.indexOf(n); // fall back to anywhere
  if (at < 0) return null;
  fromN = at + n.length - 1;
  return { start: h.map[at], end: h.map[fromN] + 1 };
}

/**
 * Group consecutive sentences into chunks of up to `maxChars`, for voices
 * that are fetched over the network (fewer, larger requests).
 */
export function chunk(sentences: Sentence[], maxChars: number): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let length = 0;
  sentences.forEach((s, i) => {
    if (current.length && (length + s.text.length > maxChars || s.page !== sentences[current[0]].page)) {
      out.push(current);
      current = [];
      length = 0;
    }
    current.push(i);
    length += s.text.length + 1;
  });
  if (current.length) out.push(current);
  return out;
}
