import type { NextRequest } from "next/server";
import { errorResponse, entryToDto } from "@/lib/api";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import type { JournalPage } from "@/lib/dto";
import { londonDayStartUtc } from "@/lib/time";

/**
 * ?before=<id>&limit=50 → the page of entries just older than <id>
 * ?from=YYYY-MM-DD      → the first entry on or after that London date, through the newest
 */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  try {
    const store = await getContentStore();
    const q = request.nextUrl.searchParams;
    const from = q.get("from");
    if (from) {
      const iso = londonDayStartUtc(from);
      if (!iso) return Response.json({ error: "Invalid date" }, { status: 400 });
      const { entries, hasMore } = await store.journalFrom(iso);
      const target = entries.find((e) => e.created >= iso) ?? entries[entries.length - 1];
      const body: JournalPage = { entries: entries.map(entryToDto), hasMore, targetId: target?.id };
      return Response.json(body);
    }
    const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
    const { entries, hasMore } = await store.listJournal({ before: q.get("before") ?? undefined, limit });
    const body: JournalPage = { entries: entries.map(entryToDto), hasMore };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
