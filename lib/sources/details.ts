import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchPublic, isPdf } from "../ai/fetch-url";
import { detailsFromCsl, detailsFromHtml, detailsFromPdf, findDoi, mergeDetails, type FoundDetails } from "./details-parse";

// Reading details from a source's PDF or link. A DOI, wherever it's found,
// is looked up at doi.org (Crossref, DataCite and others), whose record is
// the most reliable; otherwise the page's or PDF's own metadata is used.

const DOI_TIMEOUT_MS = 10_000;

/** The DOI's record from doi.org, as CSL JSON. Null if it can't be found. */
export async function lookupDoi(doi: string): Promise<FoundDetails | null> {
  try {
    const res = await fetch(`https://doi.org/${encodeURI(doi)}`, {
      headers: { Accept: "application/vnd.citationstyles.csl+json", "User-Agent": "Masterfully (https://masterfully.co.uk)" },
      signal: AbortSignal.timeout(DOI_TIMEOUT_MS),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return detailsFromCsl((await res.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** A DOI record (if any) first, then what was found locally. */
async function withDoi(found: FoundDetails): Promise<FoundDetails> {
  const record = found.doi ? await lookupDoi(found.doi) : null;
  return mergeDetails(record, found);
}

export async function detailsFromPdfBytes(data: Buffer): Promise<FoundDetails> {
  const doc = await getDocumentProxy(new Uint8Array(data));
  const meta = await doc.getMetadata().catch(() => null);
  const pages = Math.min(doc.numPages, 2);
  let text = "";
  try {
    const { text: perPage } = await extractText(doc, { mergePages: false });
    text = perPage.slice(0, pages).join("\n");
  } catch {}
  return withDoi(detailsFromPdf((meta?.info ?? {}) as Record<string, unknown>, text));
}

export type ReadDetails = { ok: true; details: FoundDetails } | { ok: false; reason: string };

export async function detailsFromLink(url: string): Promise<ReadDetails> {
  // A DOI link needs no page: its record says it all.
  const doiInUrl = /(^|\/\/)(dx\.)?doi\.org\//i.test(url) ? findDoi(url) : undefined;
  if (doiInUrl) {
    const record = await lookupDoi(doiInUrl);
    if (record) return { ok: true, details: record };
  }
  const raw = await fetchPublic(url);
  if (!raw.ok) {
    // Still worth trying a DOI in the address (publisher pages often refuse robots).
    const doi = findDoi(url);
    const record = doi ? await lookupDoi(doi) : null;
    return record ? { ok: true, details: record } : { ok: false, reason: raw.reason };
  }
  if (isPdf(raw)) return { ok: true, details: await detailsFromPdfBytes(raw.body) };
  return { ok: true, details: await withDoi(detailsFromHtml(raw.body.toString("utf8"), raw.finalUrl)) };
}
