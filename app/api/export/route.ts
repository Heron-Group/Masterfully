import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { errorResponse } from "@/lib/api";
import { currentAccount } from "@/lib/auth";
import { getWorkspaceStore } from "@/lib/content";

/** Every file in a folder, depth first, skipping hidden files and folders. */
async function* walk(dir: string, rel = ""): AsyncGenerator<{ abs: string; rel: string; mtime: Date }> {
  const items = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory()) yield* walk(dir, child);
    else if (item.isFile()) {
      const abs = path.join(dir, child);
      yield { abs, rel: child, mtime: (await fs.stat(abs)).mtime };
    }
  }
}

/**
 * Download everything the signed-in user has created, as a zip of their
 * Markdown files and attachments. Streamed, so large PDFs never sit in memory.
 */
export async function GET() {
  try {
    const account = await currentAccount();
    if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
    const store = await getWorkspaceStore(account);
    const folder = `research-${new Date().toISOString().slice(0, 10)}`;

    const out: Uint8Array[] = [];
    let finished = false;
    let failure: unknown = null;
    const zip = new Zip((err, chunk, final) => {
      if (err) failure = err;
      else out.push(chunk);
      if (final) finished = true;
    });

    // Feed the zip one piece at a time, only when the browser wants more.
    async function* pieces() {
      for await (const f of walk(store.dir)) {
        // Markdown compresses well; PDFs and images are already compressed.
        const entry = f.rel.endsWith(".md") ? new ZipDeflate(`${folder}/${f.rel}`, { level: 6 }) : new ZipPassThrough(`${folder}/${f.rel}`);
        entry.mtime = f.mtime;
        zip.add(entry);
        let empty = true;
        for await (const chunk of createReadStream(f.abs, { highWaterMark: 256 * 1024 })) {
          empty = false;
          entry.push(new Uint8Array(chunk as Buffer));
          yield;
        }
        entry.push(new Uint8Array(0), true);
        if (empty) yield;
      }
      zip.end();
      yield;
    }
    const feed = pieces();

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!out.length && !finished && !failure) {
          if ((await feed.next()).done) break;
        }
        if (failure) return controller.error(failure);
        while (out.length) controller.enqueue(out.shift()!);
        if (finished) controller.close();
      },
      async cancel() {
        await feed.return(undefined);
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${folder}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
