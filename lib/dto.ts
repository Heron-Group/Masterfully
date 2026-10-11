// Shapes sent to the browser. Safe to import from client components.

export type AttachmentDto = {
  file: string;
  name: string;
  type: string;
  size: number;
  url: string;
  /** Present for images that get a server-side thumbnail. */
  thumbUrl?: string;
  isImage: boolean;
};

export type EntryDto = {
  id: string;
  created: string;
  updated: string;
  body: string;
  attachments: AttachmentDto[];
  problem?: string;
};

export type JournalPage = { entries: EntryDto[]; hasMore: boolean; targetId?: string };

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function fileUrl(file: string, opts: { thumb?: boolean; download?: boolean } = {}): string {
  const path = file.split("/").map(encodeURIComponent).join("/");
  const q = opts.thumb ? "?thumb=1" : opts.download ? "?download=1" : "";
  return `/api/files/${path}${q}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type SourceType = "book" | "chapter" | "article" | "report" | "web" | "thesis" | "other";
export const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "book", label: "Book" },
  { value: "chapter", label: "Chapter" },
  { value: "article", label: "Article" },
  { value: "report", label: "Report" },
  { value: "web", label: "Web page" },
  { value: "thesis", label: "Thesis" },
  { value: "other", label: "Other" },
];

export type AiSummaryDto = { text: string; generated?: string; model?: string };

export type SourcePdfDto = { file: string; url: string; downloadUrl: string; name: string };

export type SourceDto = {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  type: SourceType;
  /** The first link and PDF (used for summaries and the library's icons). */
  url?: string;
  pdf?: SourcePdfDto;
  links: string[];
  pdfs: SourcePdfDto[];
  added: string;
  updated: string;
  notes: string;
  aiSummary: AiSummaryDto | null;
  problem?: string;
  /** Groups this source belongs to. */
  groups: { id: string; title: string }[];
};

export type GroupRefDto = { id: string; title: string };

/** A source or note that links to a source. */
export type ReferenceDto = { kind: "source" | "note"; id: string; title: string };

export function formatAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join("; ");
  return `${authors.slice(0, 3).join("; ")} et al.`;
}

export type GroupSourceDto = {
  id: string;
  note: string;
  /** Null when the referenced source file no longer exists. */
  source: Pick<SourceDto, "id" | "title" | "authors" | "year" | "type" | "notes" | "aiSummary"> | null;
};

export type GroupDto = {
  id: string;
  title: string;
  created: string;
  updated: string;
  overview: string;
  aiSummary: AiSummaryDto | null;
  /** Sources changed or were re-summarised after the AI summary was generated. */
  summaryStale: boolean;
  sources: GroupSourceDto[];
  problem?: string;
};

export type NoteDto = {
  id: string;
  title: string;
  created: string;
  updated: string;
  text: string;
  attachments: AttachmentDto[];
  aiSummary: AiSummaryDto | null;
  problem?: string;
};

export type NoteListItemDto = {
  id: string;
  title: string;
  updated: string;
  /** The note's text, for searching and a one-line preview. */
  text: string;
  attachments: number;
};

export type GroupListItemDto = { id: string; title: string; updated: string; count: number };

/** Events streamed (as NDJSON) while an AI summary is generated. */
export type AiEvent =
  | { type: "notice"; message: string }
  | { type: "delta"; text: string }
  /** Discard text streamed so far (a fallback model took over). */
  | { type: "reset"; message: string }
  | { type: "done"; summary: AiSummaryDto; warning?: string }
  | { type: "error"; message: string; code?: "url_unavailable" | "not_configured" | "refusal" | "api" | "not_found" };
