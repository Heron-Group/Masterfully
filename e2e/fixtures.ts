import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

export const CONTENT_DIR = path.resolve(process.env.E2E_CONTENT_DIR ?? ".dev-content");

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

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: CONTENT_DIR, encoding: "utf8" }).trim();
}

/** Write a file into the content folder as if edited by hand. */
export function handWrite(rel: string, text: string) {
  mkdirSync(path.dirname(path.join(CONTENT_DIR, rel)), { recursive: true });
  writeFileSync(path.join(CONTENT_DIR, rel), text);
}

export function handRemove(rel: string) {
  rmSync(path.join(CONTENT_DIR, rel), { force: true });
}
