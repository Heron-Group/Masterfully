import { errorResponse, entryToDto } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { field, fieldList, parseUpload } from "@/lib/uploads";

/**
 * Edit an entry: multipart fields `body`, `remove` (attachment file paths,
 * repeatable) and new `files`.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/upload/journal/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const store = await getContentStore();
    const upload = await parseUpload(request, store);
    try {
      const entry = await store.updateJournalEntry(id, {
        body: field(upload, "body"),
        removeAttachments: fieldList(upload, "remove"),
        addAttachments: upload.files,
      });
      return Response.json(entryToDto(entry));
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
