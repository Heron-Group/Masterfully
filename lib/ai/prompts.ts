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

When the researcher's own notes are provided, treat them as context only. Do not repeat them back.`;

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

/** The heading of the short overview at the end of a source summary; split off and kept separately (see splitOverview). */
export const OVERVIEW_HEADING = "### In brief";

const SOURCE_OUTPUT = `Give a comprehensive overview of what the source is about, in exactly these sections:

### Abstract
If the source contains its own abstract (often headed "Abstract" or "Summary", near the start), reproduce it exactly as written: word for word, without shortening, correcting or rewording it, and keep its paragraph breaks. Put this line in italics directly above it: *The source's own abstract.*
If it has no abstract, write one in the style of a journal article's abstract: one paragraph of about 150 to 250 words in the third person, covering the topic and its context, the aims or questions, the approach or methods, the main arguments or findings, and the conclusions. Put this line in italics directly above it: *No abstract in the source; written for this summary.*

### What it explores
A bulleted list of what the text explores: its main themes, questions, concepts, methods, cases and examples. Give each bullet a short bold label followed by one or two sentences. Aim for six to ten bullets, in the order they matter to the source.

### Key findings and citable claims
A bulleted list of the source's key findings and specific claims worth citing, each in one or two sentences. Add the page number in the form (p. 12) wherever the material shows it; leave it out where it doesn't, and never guess one. Quote only text that appears in the material.

${OVERVIEW_HEADING}
Three to five lines (about 50 to 90 words) of plain prose saying what the source is about, for a list of sources. No heading other than this one, no bullets.

Describe the source itself, not my notes, and don't say how it relates to anyone else's research. Write nothing before the first heading.`;

/**
 * A source summary with its short overview taken off the end: the summary
 * is saved as the AI summary, the overview separately (for group pages).
 */
export function splitOverview(text: string): { summary: string; overview?: string } {
  const at = text.search(/^###\s*In brief\s*$/im);
  if (at < 0) return { summary: text.trim() };
  const overview = text.slice(at).replace(/^###\s*In brief\s*$/im, "").trim();
  return { summary: text.slice(0, at).trim(), overview: overview || undefined };
}

/**
 * The text part of a source-summary request: an overview of the source
 * itself (an abstract and what it explores). The research context isn't
 * sent, as the summary doesn't relate the source to the research.
 */
export function sourcePrompt(input: { meta: SourceMeta; notes: string; material: SourceMaterial }): string {
  const { meta, notes, material } = input;
  let materialText: string;
  switch (material.kind) {
    case "pdf":
      materialText = "The full text of the source is attached as a PDF.";
      break;
    case "web":
      materialText = `The readable text of the web page${material.pageTitle ? ` "${material.pageTitle}"` : ""}:\n<page_text>\n${material.text}\n</page_text>`;
      break;
    case "chunk-summaries":
      materialText = `The PDF was too large to read in one go, so it was summarised in ${material.summaries.length} parts. Combine these into one summary. Keep page numbers that the part summaries give. If a part gives the "Source abstract (verbatim)", that is the source's own abstract: use it exactly as given.\n${material.summaries
        .map((s, i) => `<part number="${i + 1}">\n${s}\n</part>`)
        .join("\n")}`;
      break;
    case "metadata-only":
      materialText =
        "The full text is not available. Work only from the details and the researcher's notes below. There is no abstract to reproduce: begin the abstract by saying that it is based on the source's details and the researcher's notes, not the source itself. Keep every section short, and leave out the findings section if there is nothing to list.";
      break;
  }
  return `Summarise this source for my reading list.

<source_details>
${describeSource(meta)}
</source_details>

${materialText}

${notesBlock(notes)}

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

Write detailed notes on this part only, for later combining into an overview of the whole source: what it covers, its aims or questions, its arguments and findings, specific claims worth citing with their page numbers (p. 12) taken from the page markers, and the concepts, methods, cases and examples it uses. Use bullet points. Do not write an introduction or conclusion.

If this part contains the source's own abstract, first copy it exactly, word for word, under the line "Source abstract (verbatim):".`;
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

/** The text part of a note-summary request. Attached PDFs, if any, are sent as documents alongside it. */
export function notePrompt(input: {
  title: string;
  text: string;
  pdfNames: string[];
  otherAttachments: string[];
  researchContext: string;
}): string {
  const attached = [
    input.pdfNames.length
      ? `Attached to the note, and included here as PDF documents: ${input.pdfNames.join(", ")}.`
      : null,
    input.otherAttachments.length
      ? `Also attached, but not included here: ${input.otherAttachments.join(", ")}.`
      : null,
  ].filter(Boolean);
  return `Summarise this note from my research notes. It is my own writing, so summarise and develop it rather than repeating it back.

<note title="${input.title.replace(/"/g, "'")}">
${input.text.trim() || "(The note has no text yet.)"}
</note>
${attached.length ? `\n${attached.join("\n")}\n` : ""}
${researchContextBlock(input.researchContext)}

Write the summary with these sections:

### Summary
The main points of the note${input.pdfNames.length ? " and its attachments" : ""} in a short paragraph or two.

### Key ideas
A bulleted list of the key ideas, questions and claims.

### Connections and next steps
How this relates to the research context, open questions it raises, and what might be worth reading, making or writing next. Be specific and brief.`;
}
