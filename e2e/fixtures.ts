import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The content repository. */
export const REPO_DIR = path.resolve(process.env.E2E_CONTENT_DIR ?? ".dev-content");

/** Account id of whoever signs in with the dev password (the owner; see global-setup). */
export function ownerId(): string {
  const dir = path.join(REPO_DIR, "accounts");
  const file = readdirSync(dir).find((f) => readFileSync(path.join(dir, f), "utf8").includes("subject: owner"));
  if (!file) throw new Error("No owner account yet: sign in with the password first.");
  return file.slice(0, -3);
}

/** The owner's workspace folder, where the specs signed in with the password read and write. */
export const workspace = (rel = "") => path.join(REPO_DIR, "users", ownerId(), rel);

/** A real one-page PDF, padded with an unused stream to roughly `bytes` long. */
export function makePdf(bytes = 2000, text = "Test PDF"): Buffer {
  const objects: string[] = [];
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const padLength = Math.max(0, bytes - 1200);
  objects.push(`<< /Length ${padLength} >>\nstream\n${"0".repeat(padLength)}\nendstream`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

/** Git in the content repo, with the owner's `users/<id>/` prefix removed from paths in the output. */
export function git(...args: string[]): string {
  const out = execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8" }).trim();
  return out.split(`users/${ownerId()}/`).join("");
}

/** Write a file into the content folder as if edited by hand. */
export function handWrite(rel: string, text: string) {
  mkdirSync(path.dirname(workspace(rel)), { recursive: true });
  writeFileSync(workspace(rel), text);
}

/** Remove a hand-written file and commit, leaving the content repo clean. */
export function handRemove(rel: string) {
  rmSync(workspace(rel), { force: true });
  try {
    git("rm", "-q", "--cached", "--ignore-unmatch", "--", `users/${ownerId()}/${rel}`);
    git("-c", "user.name=E2E", "-c", "user.email=e2e@localhost", "commit", "-q", "-m", `e2e: remove ${rel}`);
  } catch {
    // Nothing to commit (the file was never committed).
  }
}

/**
 * Write a test PDF to disk. Passing a path (not a buffer) lets Playwright
 * stream it to the browser; a 40 MB buffer can exhaust memory in WebKit.
 */
export function pdfFile(bytes: number, text: string): string {
  const file = path.join(os.tmpdir(), `e2e-${process.pid}-${bytes}.pdf`);
  writeFileSync(file, makePdf(bytes, text));
  return file;
}
