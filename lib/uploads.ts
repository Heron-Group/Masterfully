import "server-only";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import Busboy from "busboy";
import { ContentError } from "./content";
import type { StagedFile } from "./content";
import type { ContentStore } from "./content/store";
import { MAX_UPLOAD_BYTES } from "./dto";
import { mimeFromName } from "./mime";

export type ParsedUpload = {
  fields: Map<string, string[]>;
  files: (StagedFile & { field: string })[];
};

/**
 * Stream a multipart request to staged temp files without buffering it in
 * memory. Each file may be up to 50 MB. HEIC/HEIF images are converted to
 * JPEG. On any error the staged files are removed.
 */
export async function parseUpload(
  request: Request,
  store: ContentStore,
  opts: { maxFiles?: number; maxFileBytes?: number } = {},
): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data") || !request.body) {
    throw new ContentError("Expected a multipart form upload", 400);
  }
  const maxFileBytes = opts.maxFileBytes ?? MAX_UPLOAD_BYTES;
  const fields = new Map<string, string[]>();
  const files: ParsedUpload["files"] = [];
  const pending: Promise<void>[] = [];
  let failure: unknown = null;

  await new Promise<void>((resolve, reject) => {
    const bb = Busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
      // One byte over the limit so stageUpload notices and rejects the file.
      limits: { fileSize: maxFileBytes + 1, files: opts.maxFiles ?? 20, fields: 200 },
    });
    bb.on("field", (name, value) => {
      fields.set(name, [...(fields.get(name) ?? []), value]);
    });
    bb.on("file", (field, stream, info) => {
      const name = info.filename || "file";
      pending.push(
        store
          .stageUpload(stream, { maxBytes: maxFileBytes })
          .then(({ tempPath, size }) => {
            const type =
              info.mimeType && info.mimeType !== "application/octet-stream"
                ? info.mimeType
                : mimeFromName(name);
            files.push({ field, tempPath, size, name, type });
          })
          .catch((err) => {
            failure ??=
              err instanceof ContentError && err.status === 413
                ? new ContentError(`"${name}" is larger than 50 MB`, 413)
                : err;
            stream.resume();
          }),
      );
    });
    bb.on("filesLimit", () => {
      failure ??= new ContentError("Too many files in one upload", 413);
    });
    bb.on("error", reject);
    bb.on("close", resolve);
    Readable.fromWeb(request.body as unknown as NodeWebStream<Uint8Array>).on("error", reject).pipe(bb);
  }).catch((err) => {
    failure ??= err;
  });
  await Promise.all(pending);

  if (failure) {
    await Promise.all(files.map((f) => store.discardUpload(f.tempPath)));
    throw failure;
  }
  for (const f of files) await convertHeic(store, f);
  // Keep the order the files were sent in.
  return { fields, files };
}

function isHeic(f: StagedFile): boolean {
  return /^image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/** Convert HEIC/HEIF to JPEG in place (browsers other than Safari can't show HEIC). */
async function convertHeic(store: ContentStore, f: StagedFile): Promise<void> {
  if (!isHeic(f)) return;
  try {
    const { default: convert } = await import("heic-convert");
    const input = await fs.readFile(f.tempPath);
    const output = Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.9 }));
    const staged = await store.stageUpload(output);
    await store.discardUpload(f.tempPath);
    f.tempPath = staged.tempPath;
    f.size = staged.size;
    f.name = f.name.replace(/\.hei[cf]$/i, "") + ".jpg";
    f.type = "image/jpeg";
  } catch (err) {
    // Keep the original if conversion fails; it can still be downloaded.
    console.warn(`[upload] HEIC conversion failed for ${f.name}:`, err);
  }
}

export function field(upload: ParsedUpload, name: string): string | undefined {
  return upload.fields.get(name)?.[0];
}

export function fieldList(upload: ParsedUpload, name: string): string[] {
  return upload.fields.get(name) ?? [];
}

/** Check a staged file really is a PDF (by its first bytes, not just its name). */
export async function assertPdf(f: StagedFile): Promise<void> {
  const handle = await fs.open(f.tempPath, "r");
  try {
    const head = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(head, 0, 1024, 0);
    if (!head.subarray(0, bytesRead).includes("%PDF-")) {
      throw new ContentError(`"${f.name}" doesn't look like a PDF`, 400);
    }
  } finally {
    await handle.close();
  }
}

/** Parse the source metadata fields shared by the add and edit forms. */
export function sourceFields(get: (name: string) => string | undefined) {
  const yearText = get("year")?.trim();
  const year = yearText ? Number(yearText) : undefined;
  if (yearText && (!Number.isInteger(year) || year! < 0 || year! > 3000)) {
    throw new ContentError("Year should be a number like 2025", 400);
  }
  const url = get("url")?.trim() || undefined;
  if (url && !/^https?:\/\//i.test(url)) {
    throw new ContentError("The link should start with http:// or https://", 400);
  }
  return {
    title: get("title")?.trim() ?? "",
    authors: (get("authors") ?? "")
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean),
    year,
    type: get("type") as never,
    url,
  };
}
