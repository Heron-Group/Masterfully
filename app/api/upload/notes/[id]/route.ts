import { errorResponse, noteToDto } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { fieldList, parseUpload } from "@/lib/uploads";

/** Change a note's attachments: multipart `remove` (attachment file paths, repeatable) and new `files`. */
export async function POST(request: Request, ctx: RouteContext<"/api/upload/notes/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const store = await getContentStore();
    const upload = await parseUpload(request, store);
    try {
      const note = await store.updateNoteAttachments(id, { add: upload.files, remove: fieldList(upload, "remove") });
      return Response.json(noteToDto(note));
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
