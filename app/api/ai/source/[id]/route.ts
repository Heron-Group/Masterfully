import type { NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { backendFor, ndjsonResponse, summariseSource } from "@/lib/ai/summarise";

/** Generate (or regenerate) a source's AI summary, streaming the text. ?mode=metadata skips the PDF/link. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/source/[id]">) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
  const backend = await backendFor(account.id);
  const { id } = await ctx.params;
  const mode = request.nextUrl.searchParams.get("mode") === "metadata" ? "metadata" : undefined;
  return ndjsonResponse(summariseSource(await getContentStore(), id, { backend, mode, signal: request.signal }));
}
