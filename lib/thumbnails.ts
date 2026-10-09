import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { serverConfig } from "./config";

/**
 * Return the path of a cached WebP thumbnail for an image, generating it with
 * sharp on first request. Thumbnails live in CACHE_DIR, outside the content
 * repo, and can be deleted at any time.
 */
export async function thumbnailFor(
  absPath: string,
  stat: { mtimeMs: number; size: number },
): Promise<string | null> {
  const key = createHash("sha1").update(`${absPath}:${stat.mtimeMs}:${stat.size}`).digest("hex");
  const dir = path.join(serverConfig().cacheDir, "thumbs", key.slice(0, 2));
  const out = path.join(dir, `${key}.webp`);
  try {
    await fs.access(out);
    return out;
  } catch {}
  try {
    const { default: sharp } = await import("sharp");
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    await sharp(absPath, { failOn: "none" })
      .rotate()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(tmp);
    await fs.rename(tmp, out);
    return out;
  } catch (err) {
    console.warn(`[thumbnails] could not create thumbnail for ${absPath}:`, err);
    return null;
  }
}
