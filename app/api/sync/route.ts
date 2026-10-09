import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";

/** Current sync status (synced / pending / syncing / error / local). */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  const store = await getContentStore();
  return Response.json(store.syncStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** "Sync now": pull with rebase, then push. */
export async function POST() {
  const denied = await requireApiSession();
  if (denied) return denied;
  const store = await getContentStore();
  return Response.json(await store.syncNow());
}
