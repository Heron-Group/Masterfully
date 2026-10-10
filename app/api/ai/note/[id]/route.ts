import type { NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { backendFor, ndjsonResponse, summariseNote } from "@/lib/ai/summarise";

/** Generate (or regenerate) a note's AI summary, streaming the text. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/note/[id]">) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
  const backend = await backendFor(account.id);
  const { id } = await ctx.params;
  return ndjsonResponse(summariseNote(await getContentStore(), id, { backend, signal: request.signal }));
}
