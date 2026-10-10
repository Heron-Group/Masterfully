import "server-only";
import { ContentError } from "./content";
import type { Attachment, Group, JournalEntry, Note, Source } from "./content";
import {
  fileUrl,
  IMAGE_TYPES,
  type AttachmentDto,
  type EntryDto,
  type GroupDto,
  type NoteDto,
  type NoteListItemDto,
  type SourceDto,
} from "./dto";
import type { ContentStore } from "./content/store";

export function entryToDto(e: JournalEntry): EntryDto {
  return {
    id: e.id,
    created: e.created,
    updated: e.updated,
    body: e.body,
    problem: e.problem,
    attachments: e.attachments.map(attachmentToDto),
  };
}

function attachmentToDto(a: Attachment): AttachmentDto {
  const isImage = IMAGE_TYPES.includes(a.type);
  return {
    ...a,
    url: fileUrl(a.file),
    thumbUrl: isImage && a.type !== "image/gif" ? fileUrl(a.file, { thumb: true }) : undefined,
    isImage,
  };
}

export function noteToDto(n: Note): NoteDto {
  return {
    id: n.id,
    title: n.title,
    created: n.created,
    updated: n.updated,
    text: n.text,
    attachments: n.attachments.map(attachmentToDto),
    aiSummary: n.aiSummary,
    problem: n.problem,
  };
}

export function noteToListItem(n: Note): NoteListItemDto {
  return { id: n.id, title: n.title, updated: n.updated, text: n.text, attachments: n.attachments.length };
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

export async function groupToDto(g: Group, store: ContentStore): Promise<GroupDto> {
  const sources = await Promise.all(
    g.sources.map(async (ref) => {
      const s = await store.getSource(ref.id);
      return {
        id: ref.id,
        note: ref.note,
        source: s
          ? { id: s.id, title: s.title, authors: s.authors, year: s.year, type: s.type, notes: s.notes, aiSummary: s.aiSummary }
          : null,
      };
    }),
  );
  return {
    id: g.id,
    title: g.title,
    created: g.created,
    updated: g.updated,
    overview: g.overview,
    aiSummary: g.aiSummary,
    summaryStale: store.isGroupSummaryStale(g),
    sources,
    problem: g.problem,
  };
}
