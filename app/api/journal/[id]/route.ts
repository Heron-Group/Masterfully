import { errorResponse } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";

/** Delete an entry and its attachments. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/journal/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    await (await getContentStore()).deleteJournalEntry(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
