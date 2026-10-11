import { errorResponse } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";

/** The signed-in user's sources, briefly, for linking to them from notes. */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const sources = await (await getContentStore()).listSources();
    return Response.json(
      sources.map((s) => ({ id: s.id, title: s.title, authors: s.authors, year: s.year })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
