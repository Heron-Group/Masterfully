import { errorResponse } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { ContentError, getContentStore } from "@/lib/content";
import { SOURCE_DETAIL_FIELDS, toSourceType } from "@/lib/content/schemas";
import { assertPdf, field, fieldList, parseUpload, sourceFields } from "@/lib/uploads";

/**
 * Add a source: fields title, authors (one per line), year, type, url,
 * notes, groups (repeatable), set_by_hand (comma-separated details the user
 * typed), and an optional `pdf` file.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const store = await getContentStore();
    const upload = await parseUpload(request, store, { maxFiles: 1 });
    try {
      const pdf = upload.files.find((f) => f.field === "pdf");
      if (pdf) await assertPdf(pdf);
      const fields = sourceFields((n) => field(upload, n));
      if (!fields.title) throw new ContentError("A source needs a title", 400);
      const source = await store.createSource(
        {
          ...fields,
          type: toSourceType(fields.type),
          notes: field(upload, "notes") ?? "",
          // Details the user typed (sent by the new-source page); otherwise all given ones count.
          setByHand: (() => {
            const sent = field(upload, "set_by_hand");
            if (sent === undefined) return SOURCE_DETAIL_FIELDS.filter((f) => f === "type" ? !!fields.type : f === "authors" ? fields.authors.length > 0 : f === "year" ? fields.year !== undefined : true);
            return SOURCE_DETAIL_FIELDS.filter((f) => sent.split(",").includes(f));
          })(),
        },
        { pdf, groups: fieldList(upload, "groups") },
      );
      return Response.json({ id: source.id }, { status: 201 });
    } catch (err) {
      await Promise.all(upload.files.map((f) => store.discardUpload(f.tempPath)));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
