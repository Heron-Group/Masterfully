import { errorResponse } from "@/lib/api";
import { currentAccount } from "@/lib/auth";
import { getWorkspaceStore } from "@/lib/content";
import { loadMap } from "@/lib/map/server";

/**
 * The Source Map for the signed-in user: sources, groups, links,
 * memberships and crossover figures, rebuilt from their own files on every
 * request (so it always matches the data, with nothing to keep in sync).
 */
export async function GET() {
  try {
    const account = await currentAccount();
    if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
    const map = await loadMap(account.id, await getWorkspaceStore(account));
    return Response.json(map, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
