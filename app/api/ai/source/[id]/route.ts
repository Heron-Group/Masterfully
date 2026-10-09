import type { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { ndjsonResponse, summariseSource } from "@/lib/ai/summarise";

/** Generate (or regenerate) a source's AI summary, streaming the text. ?mode=metadata skips the PDF/link. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/source/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  const mode = request.nextUrl.searchParams.get("mode") === "metadata" ? "metadata" : undefined;
  return ndjsonResponse(summariseSource(await getContentStore(), id, { mode, signal: request.signal }));
}
