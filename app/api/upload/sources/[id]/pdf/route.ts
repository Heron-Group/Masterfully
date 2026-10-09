import { errorResponse } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { assertPdf, parseUpload } from "@/lib/uploads";

/** Attach or replace a source's PDF (multipart field `pdf`). */
export async function POST(request: Request, ctx: RouteContext<"/api/upload/sources/[id]/pdf">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const store = await getContentStore();
    const upload = await parseUpload(request, store, { maxFiles: 1 });
    try {
      const pdf = upload.files.find((f) => f.field === "pdf");
      if (!pdf) throw new ContentError("Choose a PDF to upload", 400);
      await assertPdf(pdf);
      await store.setSourcePdf(id, pdf);
      return Response.json({ ok: true });
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
