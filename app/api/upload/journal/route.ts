import { errorResponse, entryToDto } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { field, parseUpload } from "@/lib/uploads";

// Upload routes are excluded from proxy.ts (it would truncate large bodies),
// so the session is checked here before the body is read.

/** Create a journal entry: multipart fields `body` and any number of `files`. */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const store = await getContentStore();
    const upload = await parseUpload(request, store);
    try {
      const entry = await store.createJournalEntry({
        body: field(upload, "body") ?? "",
        attachments: upload.files,
      });
      return Response.json(entryToDto(entry), { status: 201 });
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
