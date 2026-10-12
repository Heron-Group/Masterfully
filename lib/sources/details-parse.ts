import { parseHTML } from "linkedom";
import type { SourceType } from "../dto";

// Reading a source's details (title, authors, year, type) from what it
// already contains: a DOI's record, a page's scholarly metadata, or a PDF's
// own properties. Pure functions, so they can be unit-tested; fetching is in
// details.ts.

export type FoundDetails = { title?: string; authors?: string[]; year?: number; type?: SourceType; doi?: string };

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** The first DOI in some text or a URL, e.g. "10.1080/15710880701875068". */
export function findDoi(text: string): string | undefined {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {}
  const m = decoded.match(/\b(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (!m) return undefined;
  const doi = m[1];
  // Trailing punctuation from the sentence, and publishers' ".pdf"/"/full" suffixes.
  return doi.replace(/[.,;:)\]}]+$/, "").replace(/\/(full|abstract|pdf|epdf)$/i, "").replace(/\.pdf$/i, "");
}

/** A year between 1500 and next year, from a date string or number. */
export function yearFrom(value: unknown): number | undefined {
  const m = String(value ?? "").match(/\b(1[5-9]\d\d|20\d\d)\b/);
  const year = m ? Number(m[1]) : NaN;
  return year >= 1500 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

/** "Tim Ingold" → "Ingold, Tim"; "Ingold, Tim" stays. The library's author format. */
export function normaliseAuthor(name: string): string {
  const n = clean(name).replace(/^by\s+/i, "");
  if (!n || n.includes(",")) return n;
  const parts = n.split(" ");
  if (parts.length < 2) return n;
  // Keep particles with the surname: "Ludwig van Beethoven" → "van Beethoven, Ludwig".
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|de|der|den|da|di|du|la|le|del|dos|ter)$/i.test(parts[i - 1])) i--;
  return `${parts.slice(i).join(" ")}, ${parts.slice(0, i).join(" ")}`;
}

/** Several names in one field: "A; B", "A and B", "A & B". */
export function splitAuthors(value: string): string[] {
  return clean(value)
    .split(/\s*(?:;|\band\b|&)\s*/i)
    .map(normaliseAuthor)
    .filter(Boolean);
}

/** A DOI record (CSL JSON, from doi.org). Crossref's own type names are handled too. */
export function detailsFromCsl(csl: Record<string, unknown>): FoundDetails {
  const title = clean(Array.isArray(csl.title) ? csl.title[0] : csl.title);
  type Person = { family?: string; given?: string; literal?: string; name?: string };
  const people = ((csl.author as Person[] | undefined)?.length ? csl.author : csl.editor) as Person[] | undefined;
  const authors = (people ?? [])
    .map((p) => (p.family ? (p.given ? `${clean(p.family)}, ${clean(p.given)}` : clean(p.family)) : normaliseAuthor(p.literal ?? p.name ?? "")))
    .filter(Boolean);
  const dateOf = (k: string) => (csl[k] as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]?.[0]?.[0];
  const year = yearFrom(dateOf("issued") ?? dateOf("published-print") ?? dateOf("published-online") ?? dateOf("created"));
  return { title: title || undefined, authors: authors.length ? authors : undefined, year, type: cslType(String(csl.type ?? "")), doi: clean(csl.DOI) || undefined };
}

function cslType(type: string): SourceType {
  const t = type.toLowerCase();
  if (/^(article|article-journal|journal-article|article-magazine|article-newspaper|paper-conference|proceedings-article|review|review-book|posted-content|preprint)$/.test(t)) return "article";
  if (/^(book|monograph|edited-book|reference-book|book-set|book-series)$/.test(t)) return "book";
  if (/^(chapter|book-chapter|book-section|book-part|entry|entry-encyclopedia|entry-dictionary|reference-entry)$/.test(t)) return "chapter";
  if (/^(thesis|dissertation)$/.test(t)) return "thesis";
  if (/^(report|report-component|standard)$/.test(t)) return "report";
  if (/^(webpage|post|post-weblog)$/.test(t)) return "web";
  return "other";
}

/** Fields in priority order: the first one present wins. */
function first<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((v) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
}

/**
 * A web page: Highwire/Google Scholar "citation_*" tags (most publishers and
 * repositories), Dublin Core, JSON-LD, Open Graph, then the page <title>.
 */
export function detailsFromHtml(html: string, url = ""): FoundDetails {
  const { document } = parseHTML(html);
  const metas = [...document.querySelectorAll("meta")];
  const all = (...names: string[]) =>
    metas
      .filter((m) => names.includes((m.getAttribute("name") ?? m.getAttribute("property") ?? "").toLowerCase()))
      .map((m) => clean(m.getAttribute("content")))
      .filter(Boolean);
  const one = (...names: string[]) => all(...names)[0];

  // JSON-LD: the first thing with a name or headline.
  type Ld = { "@type"?: string | string[]; name?: string; headline?: string; author?: unknown; datePublished?: string; "@graph"?: Ld[] };
  let ld: Ld | undefined;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? "") as Ld | Ld[];
      const items = (Array.isArray(data) ? data : data["@graph"] ?? [data]).flat();
      ld = items.find((x) => x && (x.headline || x.name) && x["@type"] && !/^(WebSite|Organization|BreadcrumbList|Person|WebPage)$/.test(String(x["@type"])));
      if (ld) break;
    } catch {}
  }
  const ldAuthors = (() => {
    const a = ld?.author;
    const list = Array.isArray(a) ? a : a ? [a] : [];
    return list.map((x) => normaliseAuthor(typeof x === "string" ? x : clean((x as { name?: string }).name))).filter(Boolean);
  })();

  const citationTitle = one("citation_title", "dc.title", "dcterms.title");
  const title = first(citationTitle, one("og:title", "twitter:title"), clean(ld?.headline ?? ld?.name), clean(document.querySelector("title")?.textContent));
  const authorTags = all("citation_author", "dc.creator", "dcterms.creator");
  const authors = first(
    authorTags.length ? authorTags.flatMap((a) => (a.includes(";") ? splitAuthors(a) : [normaliseAuthor(a)])) : undefined,
    ldAuthors,
    all("author", "article:author").filter((a) => !/^https?:/.test(a)).flatMap(splitAuthors),
  );
  const year = yearFrom(
    first(
      one("citation_publication_date", "citation_date", "citation_online_date", "citation_year", "dc.date", "dcterms.issued", "dcterms.date"),
      ld?.datePublished,
      one("article:published_time", "og:published_time", "date"),
    ),
  );

  let type: SourceType = "web";
  const ldType = String([ld?.["@type"]].flat()[0] ?? "");
  if (one("citation_dissertation_institution") || /Thesis/i.test(ldType)) type = "thesis";
  else if (one("citation_technical_report_institution", "citation_technical_report_number") || /^Report$/i.test(ldType)) type = "report";
  else if (one("citation_inbook_title", "citation_book_title") || /^Chapter$/i.test(ldType)) type = "chapter";
  else if (one("citation_journal_title", "citation_conference_title", "citation_volume") || /^ScholarlyArticle$/i.test(ldType)) type = "article";
  else if (/^Book$/i.test(ldType) || one("og:type") === "book" || (one("citation_isbn") && citationTitle)) type = "book";
  else if (citationTitle) type = "article";

  const doi = [...all("citation_doi", "dc.identifier", "dcterms.identifier", "prism.doi", "bepress_citation_doi"), url].map((v) => findDoi(v)).find(Boolean);
  return { title, authors, year, type, doi };
}

/** Titles PDFs often carry that aren't the work's title. */
const JUNK_TITLE = /(\.(docx?|pdf|tex|indd|odt|rtf|pages)$)|^(untitled|microsoft word\b|title$|document\d*$|slide \d+)/i;

/**
 * A PDF: its document properties (Title, Author) and its first pages' text
 * (for a DOI, a copyright year, and theses). Creation dates are left out:
 * they say when the file was made, not when the work was published.
 */
export function detailsFromPdf(info: Record<string, unknown>, firstPages: string): FoundDetails {
  const rawTitle = clean(info.Title);
  const title = rawTitle.length > 3 && !JUNK_TITLE.test(rawTitle) ? rawTitle : undefined;
  const rawAuthor = clean(info.Author);
  const authors = rawAuthor && !/^(admin|user|owner|unknown|author)$/i.test(rawAuthor) ? splitAuthors(rawAuthor) : undefined;
  const text = firstPages.slice(0, 20_000);
  const year = yearFrom(text.match(/(?:©|\(c\)|copyright)\s*(\d{4})/i)?.[1]);
  const type: SourceType | undefined = /\b(thesis|dissertation)\s+(submitted|presented)\b|\bdoctor of philosophy\b/i.test(text) ? "thesis" : undefined;
  return { title, authors: authors?.length ? authors : undefined, year, type, doi: findDoi(text) };
}

/** Combine sources of details: for each field, the first that has it. */
export function mergeDetails(...parts: Array<FoundDetails | null | undefined>): FoundDetails {
  const out: FoundDetails = {};
  for (const p of parts) {
    if (!p) continue;
    out.title ??= p.title;
    if (!out.authors?.length && p.authors?.length) out.authors = p.authors;
    out.year ??= p.year;
    out.type ??= p.type;
    out.doi ??= p.doi;
  }
  return out;
}
