// All prompts for AI summaries live here so they can be edited in one place.
// Summaries are only generated when the button is pressed, and are always
// stored separately from your own writing (in the ## AI summary section).

export type SourceMeta = {
  title: string;
  authors: string[];
  year?: number;
  type: string;
  url?: string;
};

export const SYSTEM_PROMPT = `You are a research assistant helping a practice-led PhD researcher at the Royal College of Art keep a reading list.

Write in British English, in clear, plain academic prose. Use Markdown. Use "###" for section headings and never use "#" or "##".

Be faithful to the source. Do not invent claims, quotations, page numbers or references. If something is uncertain or the text is incomplete, say so briefly. Quote sparingly and only text that actually appears in the material you were given.

The researcher's own notes are provided for context. Do not repeat them back; build on them, and point out where the source supports, complicates or contradicts them.`;

function describeSource(meta: SourceMeta): string {
  const lines = [
    `Title: ${meta.title}`,
    meta.authors.length ? `Authors: ${meta.authors.join("; ")}` : "Authors: (not recorded)",
    meta.year ? `Year: ${meta.year}` : null,
    `Type: ${meta.type}`,
    meta.url ? `Link: ${meta.url}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function researchContextBlock(context: string): string {
  return context.trim()
    ? `<research_context>\n${context.trim()}\n</research_context>`
    : "<research_context>\n(The researcher hasn't written a research context yet. Keep the relevance section general.)\n</research_context>";
}

function notesBlock(notes: string): string {
  return notes.trim() ? `<my_notes>\n${notes.trim()}\n</my_notes>` : "<my_notes>\n(No notes yet.)\n</my_notes>";
}

export type SourceMaterial =
  | { kind: "pdf" } // the PDF is attached as a document block
  | { kind: "web"; text: string; pageTitle?: string }
  | { kind: "chunk-summaries"; summaries: string[] }
  | { kind: "metadata-only" };

const SOURCE_OUTPUT = `Write the summary with these sections:

### Argument
A short summary (one or two paragraphs) of what the source argues and how.

### Key concepts and methods
A bulleted list of the main concepts, frameworks and methods, each with a one-line explanation.

### Notable claims worth citing
A bulleted list of specific claims worth citing, each with a page number in the form (p. 12) where the material shows it. Omit page numbers you cannot see; never guess them.

### Relevance to my research
How this source relates to the research context: what it offers, and where it falls short or pulls in a different direction. Be specific.`;

/** The text part of a source-summary request. */
export function sourcePrompt(input: {
  meta: SourceMeta;
  notes: string;
  researchContext: string;
  material: SourceMaterial;
}): string {
  const { meta, notes, researchContext, material } = input;
  let materialText: string;
  switch (material.kind) {
    case "pdf":
      materialText = "The full text of the source is attached as a PDF.";
      break;
    case "web":
      materialText = `The readable text of the web page${material.pageTitle ? ` "${material.pageTitle}"` : ""}:\n<page_text>\n${material.text}\n</page_text>`;
      break;
    case "chunk-summaries":
      materialText = `The PDF was too large to read in one go, so it was summarised in ${material.summaries.length} parts. Combine these into one summary. Keep page numbers that the part summaries give.\n${material.summaries
        .map((s, i) => `<part number="${i + 1}">\n${s}\n</part>`)
        .join("\n")}`;
      break;
    case "metadata-only":
      materialText =
        "The full text is not available. Work only from the details and the researcher's notes below. Say clearly at the start that this summary is based on metadata and notes, not the source itself, and keep it short. Leave out the citable-claims section if there is nothing to cite.";
      break;
  }
  return `Summarise this source for my reading list.

<source_details>
${describeSource(meta)}
</source_details>

${materialText}

${notesBlock(notes)}

${researchContextBlock(researchContext)}

${SOURCE_OUTPUT}`;
}

/** Prompt for one part of a PDF that is too large to send whole. */
export function chunkPrompt(input: { meta: SourceMeta; part: number; parts: number; firstPage: number; lastPage: number; text: string }): string {
  return `This is part ${input.part} of ${input.parts} of a long source (pages ${input.firstPage}-${input.lastPage}), extracted from its PDF. Page breaks are marked like [Page 12].

<source_details>
${describeSource(input.meta)}
</source_details>

<pages>
${input.text}
</pages>

Write detailed notes on this part only, for later combining: the argument it makes, key concepts and methods, and specific claims worth citing with their page numbers (p. 12) taken from the page markers. Use bullet points. Do not write an introduction or conclusion.`;
}

export type GroupSourceInput = {
  meta: SourceMeta;
  groupNote: string;
  notes: string;
  aiSummary?: string;
};

/** The prompt for a reading-group summary (no PDFs, to keep cost and time down). */
export function groupPrompt(input: {
  title: string;
  overview: string;
  researchContext: string;
  sources: GroupSourceInput[];
}): string {
  const sources = input.sources
    .map(
      (s, i) => `<source number="${i + 1}">
${describeSource(s.meta)}
${s.groupNote.trim() ? `Why it is in this group: ${s.groupNote.trim()}` : ""}
${notesBlock(s.notes)}
${s.aiSummary?.trim() ? `<earlier_ai_summary>\n${s.aiSummary.trim()}\n</earlier_ai_summary>` : "<earlier_ai_summary>(none)</earlier_ai_summary>"}
</source>`,
    )
    .join("\n\n");
  return `Summarise this reading group of ${input.sources.length} sources. You have each source's details, my notes and an earlier AI summary where one exists, but not the full texts; say so if that limits a point.

<group title="${input.title.replace(/"/g, "'")}">
<my_overview>
${input.overview.trim() || "(No overview yet.)"}
</my_overview>
${sources}
</group>

${researchContextBlock(input.researchContext)}

Write the summary with these sections:

### Main themes
The main themes running across the group, naming which sources contribute to each.

### Agreements and disagreements
Where the sources agree, and where they disagree or talk past each other.

### Gaps
What the group doesn't cover that my research question needs, including perspectives, methods or kinds of source that are missing.

### Relation to my research question
How the group as a whole bears on the research context.`;
}
