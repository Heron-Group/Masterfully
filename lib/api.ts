import "server-only";
import { ContentError } from "./content";
import type { Group, JournalEntry, Source } from "./content";
import { fileUrl, IMAGE_TYPES, type EntryDto, type SourceDto } from "./dto";

export function entryToDto(e: JournalEntry): EntryDto {
  return {
    id: e.id,
    created: e.created,
    updated: e.updated,
    body: e.body,
    problem: e.problem,
    attachments: e.attachments.map((a) => {
      const isImage = IMAGE_TYPES.includes(a.type);
      return {
        ...a,
        url: fileUrl(a.file),
        thumbUrl: isImage && a.type !== "image/gif" ? fileUrl(a.file, { thumb: true }) : undefined,
        isImage,
      };
    }),
  };
}

/** Turn a thrown error into a JSON response; ContentErrors carry their own status. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ContentError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong on the server. Nothing was saved." }, { status: 500 });
}

export function sourceToDto(s: Source, groups: Group[]): SourceDto {
  return {
    id: s.id,
    title: s.title,
    authors: s.authors,
    year: s.year,
    type: s.type,
    url: s.url,
    pdf: s.pdf
      ? {
          url: fileUrl(s.pdf),
          downloadUrl: fileUrl(s.pdf, { download: true }),
          name: s.pdf.split("/").pop() ?? "source.pdf",
        }
      : undefined,
    added: s.added,
    updated: s.updated,
    notes: s.notes,
    aiSummary: s.aiSummary,
    problem: s.problem,
    groups: groups
      .filter((g) => g.sources.some((ref) => ref.id === s.id))
      .map((g) => ({ id: g.id, title: g.title })),
  };
}
