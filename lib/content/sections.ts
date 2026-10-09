/**
 * Read and rewrite `## Heading` sections of a Markdown body without touching
 * anything else.
 *
 * A section runs from its heading to the next *known* heading for that file
 * type (e.g. "Notes" and "AI summary" for sources). Any other `##` headings
 * the user writes inside their notes are treated as part of the notes, so
 * rewriting the AI summary can never clip them. Headings inside fenced code
 * blocks are ignored.
 */

export const SOURCE_SECTIONS = ["Notes", "AI summary"] as const;
export const GROUP_SECTIONS = ["Overview", "AI summary"] as const;
export const AI_SUMMARY = "AI summary";

type Span = { name: string; start: number; end: number }; // line indices, end exclusive

function normaliseHeading(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function findSections(lines: string[], known: readonly string[]): Span[] {
  const wanted = new Map(known.map((k) => [normaliseHeading(k), k]));
  const spans: Span[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const heading = line.match(/^##[ \t]+(.+?)[ \t#]*$/);
    if (!heading) return;
    const name = wanted.get(normaliseHeading(heading[1]));
    if (name && !spans.some((s) => s.name === name)) {
      spans.push({ name, start: i, end: lines.length });
    }
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 0; i < spans.length - 1; i++) spans[i].end = spans[i + 1].start;
  return spans;
}

function trimBlankLines(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

function splitLines(body: string): string[] {
  return body.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Content of a section (without its heading), trimmed of surrounding blank
 * lines. With `preambleFallback`, a body that lacks the heading returns the
 * text before the first known heading instead; this treats a hand-written
 * file with no headings as all notes.
 */
export function getSection(
  body: string,
  name: string,
  known: readonly string[],
  options: { preambleFallback?: boolean } = {},
): string {
  const lines = splitLines(body);
  const spans = findSections(lines, known);
  const span = spans.find((s) => s.name === name);
  if (span) return trimBlankLines(lines.slice(span.start + 1, span.end)).join("\n");
  if (options.preambleFallback) {
    const end = spans.length ? spans[0].start : lines.length;
    return trimBlankLines(lines.slice(0, end)).join("\n");
  }
  return "";
}

export function hasSection(body: string, name: string, known: readonly string[]): boolean {
  return findSections(splitLines(body), known).some((s) => s.name === name);
}

/**
 * Replace one section's content, leaving every other line of the body
 * unchanged (only blank lines at the section's edges are normalised to one).
 * A missing section is added at the start or end.
 * With `preambleFallback`, a missing section takes over the preamble (the
 * text that `getSection` would have returned for it).
 */
export function replaceSection(
  body: string,
  name: string,
  content: string,
  known: readonly string[],
  options: { position?: "start" | "end"; preambleFallback?: boolean } = {},
): string {
  const lines = splitLines(body);
  const spans = findSections(lines, known);
  const span = spans.find((s) => s.name === name);
  const contentLines = trimBlankLines(splitLines(content));
  const block = [`## ${name}`, ...(contentLines.length ? ["", ...contentLines] : [])];

  let before: string[];
  let after: string[];
  if (span) {
    before = lines.slice(0, span.start);
    after = lines.slice(span.end);
  } else if (options.preambleFallback || options.position === "start") {
    const firstKnown = spans.length ? spans[0].start : lines.length;
    if (options.preambleFallback) {
      before = [];
      after = lines.slice(firstKnown);
    } else {
      before = lines.slice(0, firstKnown);
      after = lines.slice(firstKnown);
    }
  } else {
    before = lines;
    after = [];
  }

  const head = trimTrailingBlank(before);
  const tail = trimLeadingBlank(after);
  const out = [
    ...head,
    ...(head.length ? [""] : []),
    ...block,
    ...(tail.length ? ["", ...tail] : []),
  ];
  return trimTrailingBlank(out).join("\n") + "\n";
}

function trimTrailingBlank(lines: string[]): string[] {
  let b = lines.length;
  while (b > 0 && !lines[b - 1].trim()) b--;
  return lines.slice(0, b);
}

function trimLeadingBlank(lines: string[]): string[] {
  let a = 0;
  while (a < lines.length && !lines[a].trim()) a++;
  return lines.slice(a);
}

// --- AI summary -------------------------------------------------------------

export type AiSummary = {
  text: string;
  generated?: string;
  model?: string;
};

const META_RE = /^<!--\s*(.*?)\s*-->\s*$/;

/** Parse the AI summary section, including its `<!-- generated: … -->` comment. */
export function getAiSummary(body: string, known: readonly string[]): AiSummary | null {
  if (!hasSection(body, AI_SUMMARY, known)) return null;
  const lines = splitLines(getSection(body, AI_SUMMARY, known));
  const summary: AiSummary = { text: "" };
  const meta = lines[0]?.match(META_RE);
  if (meta) {
    for (const part of meta[1].split(/[;·]/)) {
      const m = part.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (key === "generated") summary.generated = m[2];
      if (key === "model") summary.model = m[2];
    }
    lines.shift();
  }
  summary.text = trimBlankLines(lines).join("\n");
  return summary;
}

/** Rewrite only the AI summary section, demoting any headings in the generated text. */
export function setAiSummary(
  body: string,
  summary: Required<AiSummary>,
  known: readonly string[],
): string {
  const content = [
    `<!-- generated: ${summary.generated}; model: ${summary.model} -->`,
    "",
    demoteHeadings(summary.text),
  ].join("\n");
  return replaceSection(body, AI_SUMMARY, content, known, { position: "end" });
}

/**
 * Turn `#` and `##` headings into `###` so generated text can never introduce
 * a heading that would be mistaken for a section boundary.
 */
export function demoteHeadings(markdown: string): string {
  let fence: string | null = null;
  return splitLines(markdown)
    .map((line) => {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (fence) return line;
      return line.replace(/^\s{0,3}#{1,2}(?=[ \t])/, "###");
    })
    .join("\n");
}
