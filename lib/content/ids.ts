import { toIso } from "./frontmatter";

/** Journal IDs are the UTC creation time with colons swapped for hyphens. */
export function journalIdFor(date: Date): string {
  return toIso(date).replace(/:/g, "-");
}

const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of",
  "on", "or", "the", "to", "with",
]);

export function slugify(text: string, maxWords = 8): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.slice(0, maxWords).join("-");
}

/** "Surname, Firstname" → surname; "Firstname Surname" → surname. */
export function authorSurname(author: string): string {
  const a = author.trim();
  if (a.includes(",")) return a.split(",")[0];
  const parts = a.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/** brody-2025-graphic-language: first author's surname, year, first title words. */
export function sourceSlug(input: { title: string; authors: string[]; year?: number }): string {
  const titleWords = slugify(input.title, 20)
    .split("-")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .slice(0, 3);
  const parts = [
    input.authors[0] ? slugify(authorSurname(input.authors[0]), 2) : "",
    input.year ? String(input.year) : "",
    ...titleWords,
  ].filter(Boolean);
  return parts.join("-").slice(0, 80).replace(/-+$/, "") || "source";
}

/** Append -2, -3, … until `taken` says the id is free. */
export function uniqueId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken(id)) return id;
  }
}

/** IDs become filenames, so only allow a safe character set. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id);
}

export function assertSafeId(id: string): void {
  if (!isSafeId(id)) throw new ContentError(`Invalid id: ${JSON.stringify(id)}`, 400);
}

export class ContentError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ContentError";
  }
}
