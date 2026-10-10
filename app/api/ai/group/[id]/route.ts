import type { NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { backendFor, ndjsonResponse, summariseGroup } from "@/lib/ai/summarise";

/** Generate (or regenerate) a reading group's AI summary, streaming the text. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/group/[id]">) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
  const backend = await backendFor(account.id);
  const { id } = await ctx.params;
  return ndjsonResponse(summariseGroup(await getContentStore(), id, { backend, signal: request.signal }));
}
