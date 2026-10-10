#!/usr/bin/env node
// Copy pdf.js's worker into public/ so the browser can load it. Runs after
// `npm install` so it always matches the installed pdfjs-dist version.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
if (existsSync(src)) {
  mkdirSync("public/pdfjs", { recursive: true });
  copyFileSync(src, "public/pdfjs/pdf.worker.min.mjs");
}
