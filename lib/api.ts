import "server-only";
import { ContentError } from "./content";
import type { JournalEntry } from "./content";
import { fileUrl, IMAGE_TYPES, type EntryDto } from "./dto";

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
