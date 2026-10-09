import type { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { ndjsonResponse, summariseGroup } from "@/lib/ai/summarise";

/** Generate (or regenerate) a reading group's AI summary, streaming the text. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/ai/group/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  return ndjsonResponse(summariseGroup(await getContentStore(), id, { signal: request.signal }));
}
