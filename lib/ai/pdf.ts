import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

// Request limit is 32 MB and base64 adds a third, so PDFs above ~22 MB (or
// over the 600-page limit) are summarised from extracted text in parts.
export const MAX_DIRECT_PDF_BYTES = 22 * 1024 * 1024;
export const MAX_DIRECT_PDF_PAGES = 590;
const CHUNK_CHARS = 250_000;

export async function pdfPageCount(data: Buffer): Promise<number | null> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(data));
    return doc.numPages;
  } catch {
    return null;
  }
}

export type PdfChunk = { firstPage: number; lastPage: number; text: string };

/** Extract text page by page and group pages into chunks of roughly CHUNK_CHARS. */
export async function pdfTextChunks(data: Buffer): Promise<PdfChunk[]> {
  const { text } = await extractText(new Uint8Array(data), { mergePages: false });
  const chunks: PdfChunk[] = [];
  let current: PdfChunk | null = null;
  text.forEach((pageText, i) => {
    const page = i + 1;
    const marked = `[Page ${page}]\n${pageText.trim()}\n`;
    if (!current || current.text.length + marked.length > CHUNK_CHARS) {
      current = { firstPage: page, lastPage: page, text: "" };
      chunks.push(current);
    }
    current.text += marked;
    current.lastPage = page;
  });
  return chunks.filter((c) => c.text.replace(/\[Page \d+\]/g, "").trim().length > 0);
}
