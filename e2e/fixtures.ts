import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER_EMAIL } from "./helpers";

/** The content folder (one folder per user in users/). */
export const REPO_DIR = path.resolve(process.env.E2E_CONTENT_DIR ?? ".dev-content");

/** Account id for an email address (the owner by default; see global-setup). */
export function ownerId(email = OWNER_EMAIL): string {
  const users = path.join(REPO_DIR, "users");
  const id = readdirSync(users).find((u) => {
    const file = path.join(users, u, "account.md");
    return existsSync(file) && readFileSync(file, "utf8").toLowerCase().includes(`email: ${email.toLowerCase()}`);
  });
  if (!id) throw new Error(`No account for ${email} yet: sign in first.`);
  return id;
}

/** Whether a file exists in the owner's folder. */
export const ownerHas = (rel: string) => existsSync(workspace(rel));

/** The owner's workspace folder, where the specs read and write. */
export const workspace = (rel = "") => path.join(REPO_DIR, "users", ownerId(), rel);

/** A real one-page PDF, padded with an unused stream to roughly `bytes` long. */
export function makePdf(bytes = 2000, text = "Test PDF", info?: { Title?: string; Author?: string }): Buffer {
  const objects: string[] = [];
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const padLength = Math.max(0, bytes - 1200);
  objects.push(`<< /Length ${padLength} >>\nstream\n${"0".repeat(padLength)}\nendstream`);
  // Document properties, as a PDF's Title and Author fields.
  if (info) objects.push(`<< ${Object.entries(info).map(([k, v]) => `/${k} (${v})`).join(" ")} >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info ? ` /Info ${objects.length} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

/** Write a file into the content folder as if edited by hand. */
export function handWrite(rel: string, text: string) {
  mkdirSync(path.dirname(workspace(rel)), { recursive: true });
  writeFileSync(workspace(rel), text);
}

/** Remove a hand-written file. */
export function handRemove(rel: string) {
  rmSync(workspace(rel), { force: true });
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
