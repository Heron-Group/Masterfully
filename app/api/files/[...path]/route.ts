import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { isInlineSafe, mimeFromName } from "@/lib/mime";
import { thumbnailFor } from "@/lib/thumbnails";

/**
 * Serves attachments and PDFs, only to a signed-in session. Supports Range
 * requests (needed for video on Safari and for PDF viewers), ETags, image
 * thumbnails (?thumb=1) and forced downloads (?download=1).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[...path]">) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { path: parts } = await ctx.params;
  const rel = parts.map((p) => decodeURIComponent(p)).join("/");
  const store = await getContentStore();
  const abs = await store.attachmentPath(rel);
  if (!abs) return new Response("Not found", { status: 404 });

  let stat = await fs.stat(abs);
  let filePath = abs;
  const name = rel.split("/").pop() ?? "file";
  let type = mimeFromName(name);
  const search = request.nextUrl.searchParams;

  if (search.has("thumb") && type.startsWith("image/") && type !== "image/svg+xml") {
    const thumb = await thumbnailFor(abs, stat);
    if (thumb) {
      filePath = thumb;
      stat = await fs.stat(thumb);
      type = "image/webp";
    }
  }

  const etag = `"${Math.round(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}"`;
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  const inline = isInlineSafe(type) && !search.has("download");
  headers.set(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  // Belt and braces for anything that is not a PDF (Chrome's PDF viewer
  // refuses to run inside a sandboxed response).
  if (type !== "application/pdf") headers.set("Content-Security-Policy", "sandbox");

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      headers.set("Content-Range", `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(stat.size));
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
