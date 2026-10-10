import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Write a file so readers never see it half-written: a temporary file, then a rename. */
export async function writeAtomicFile(file: string, text: string, opts: { mode?: number } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, text, { mode: opts.mode });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
