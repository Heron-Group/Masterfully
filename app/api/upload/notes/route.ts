import { errorResponse, noteToDto } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { field, parseUpload } from "@/lib/uploads";

// Upload routes are excluded from proxy.ts (it would truncate large bodies),
// so the session is checked here before the body is read.

/** Create a note: multipart fields `title`, `text` and any number of `files`. */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const store = await getContentStore();
    const upload = await parseUpload(request, store);
    try {
      const note = await store.createNote({
        title: field(upload, "title") ?? "",
        text: field(upload, "text") ?? "",
        attachments: upload.files,
      });
      return Response.json(noteToDto(note), { status: 201 });
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
