import {
  extraFields,
  isoDate,
  num,
  optStr,
  parseFile,
  record,
  str,
  stringifyFile,
  strList,
} from "./frontmatter";
import {
  type AiSummary,
  getAiSummary,
  getSection,
  GROUP_SECTIONS,
  NOTE_SECTIONS,
  SOURCE_SECTIONS,
} from "./sections";

// Every reader here is tolerant: a missing or malformed field becomes a
// sensible default, and a file whose frontmatter cannot be parsed at all is
// still listed, with `problem` set, so it is never silently dropped.

export type Attachment = {
  /** Path relative to the content root, e.g. attachments/journal/<id>/sketch.jpg */
  file: string;
  name: string;
  type: string;
  size: number;
};

export type JournalEntry = {
  id: string;
  path: string;
  created: string;
  updated: string;
  attachments: Attachment[];
  body: string;
  problem?: string;
  extra: Record<string, unknown>;
};

export const SOURCE_TYPES = [
  "book",
  "chapter",
  "article",
  "report",
  "web",
  "thesis",
  "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** The details a source's PDF or link can fill in. */
export const SOURCE_DETAIL_FIELDS = ["title", "authors", "year", "type"] as const;
export type SourceDetailField = (typeof SOURCE_DETAIL_FIELDS)[number];

/**
 * The details the user set themselves. Sources saved before this was
 * recorded count everything already filled in (and the type) as theirs.
 */
export function setByHand(source: Pick<Source, "setByHand" | "authors" | "year">): SourceDetailField[] {
  if (source.setByHand) return source.setByHand;
  return SOURCE_DETAIL_FIELDS.filter((f) => (f === "authors" ? source.authors.length > 0 : f === "year" ? source.year !== undefined : true));
}

export type Source = {
  id: string;
  path: string;
  title: string;
  authors: string[];
  year?: number;
  type: SourceType;
  /** Web links, in order. */
  links: string[];
  /** PDF files (paths under attachments/), in order. */
  pdfs: string[];
  /** The first link and PDF: the ones AI summaries and the library icons use. */
  url?: string;
  pdf?: string;
  added: string;
  updated: string;
  notes: string;
  aiSummary: AiSummary | null;
  /**
   * Details the user set themselves, which reading a PDF or link never
   * changes. Undefined for sources saved before this was recorded.
   */
  setByHand?: SourceDetailField[];
  /** When it was archived (hidden from the library, groups and map by default). */
  archived?: string;
  /** The group whose archiving archived it; unarchiving that group brings it back. */
  archivedWith?: string;
  body: string;
  problem?: string;
  extra: Record<string, unknown>;
};

export type GroupSourceRef = { id: string; note: string };

export type Group = {
  id: string;
  path: string;
  title: string;
  created: string;
  updated: string;
  /** Ordered; the order is the reading order shown on the group page. */
  sources: GroupSourceRef[];
  /** Last time sources were added, removed or reordered; used for staleness. */
  sourcesChanged?: string;
  overview: string;
  aiSummary: AiSummary | null;
  /** When it was archived, with its sources (hidden by default). */
  archived?: string;
  body: string;
  problem?: string;
  extra: Record<string, unknown>;
};

export type Note = {
  id: string;
  path: string;
  title: string;
  created: string;
  updated: string;
  attachments: Attachment[];
  /** The note itself: the `## Notes` section (or the whole body of a hand-written file). */
  text: string;
  aiSummary: AiSummary | null;
  body: string;
  problem?: string;
  extra: Record<string, unknown>;
};

export type Settings = {
  researchContext: string;
  updated?: string;
  extra: Record<string, unknown>;
};

// --- Journal ----------------------------------------------------------------

const JOURNAL_KEYS = ["id", "created", "updated", "attachments"] as const;

/** 2026-10-09T14-32-05Z (optionally with a -2 suffix) → 2026-10-09T14:32:05Z */
export function journalIdToIso(id: string): string | undefined {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : undefined;
}

function readAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const r = record(item);
      const file = str(r.file).trim();
      if (!file) return null;
      return {
        file,
        name: str(r.name).trim() || file.split("/").pop() || file,
        type: str(r.type).trim() || "application/octet-stream",
        size: num(r.size) ?? 0,
      };
    })
    .filter((a): a is Attachment => a !== null);
}

export function parseJournalEntry(
  raw: string,
  meta: { id: string; path: string; fallbackDate: string },
): JournalEntry {
  const { data, body, error } = parseFile(raw);
  const created = isoDate(data.created, journalIdToIso(meta.id) ?? meta.fallbackDate);
  return {
    id: meta.id,
    path: meta.path,
    created,
    updated: isoDate(data.updated, created),
    attachments: readAttachments(data.attachments),
    body: body.trim(),
    problem: error,
    extra: extraFields(data, JOURNAL_KEYS),
  };
}

export function serializeJournalEntry(entry: JournalEntry): string {
  return stringifyFile(
    {
      id: entry.id,
      created: entry.created,
      updated: entry.updated,
      attachments: entry.attachments.length ? entry.attachments : undefined,
      ...entry.extra,
    },
    entry.body,
  );
}

// --- Sources ----------------------------------------------------------------

const SOURCE_KEYS = [
  "id",
  "title",
  "authors",
  "year",
  "type",
  "url",
  "pdf",
  "links",
  "pdfs",
  "added",
  "updated",
  "set_by_hand",
  "archived",
  "archived_with",
] as const;

/** Lists without blanks or repeats, in order. */
function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Keep `url` and `pdf` (the first of each) in step with the lists. */
export function withPrimary<T extends { links: string[]; pdfs: string[] }>(source: T): T & { url?: string; pdf?: string } {
  return { ...source, url: source.links[0], pdf: source.pdfs[0] };
}

export function toSourceType(value: unknown): SourceType {
  const s = str(value).trim().toLowerCase();
  return (SOURCE_TYPES as readonly string[]).includes(s) ? (s as SourceType) : "other";
}

export function parseSource(
  raw: string,
  meta: { id: string; path: string; fallbackDate: string },
): Source {
  const { data, body, error } = parseFile(raw);
  const added = isoDate(data.added, meta.fallbackDate);
  // Older files have one `url` and one `pdf`; newer ones have `links` and `pdfs` lists.
  const links = unique([optStr(data.url) ?? "", ...strList(data.links)]);
  const pdfs = unique([optStr(data.pdf) ?? "", ...strList(data.pdfs)]);
  return {
    id: meta.id,
    path: meta.path,
    title: str(data.title).trim() || meta.id,
    authors: strList(data.authors),
    year: num(data.year),
    type: toSourceType(data.type),
    links,
    pdfs,
    url: links[0],
    pdf: pdfs[0],
    added,
    updated: isoDate(data.updated, added),
    notes: getSection(body, "Notes", SOURCE_SECTIONS, { preambleFallback: true }),
    aiSummary: getAiSummary(body, SOURCE_SECTIONS),
    setByHand: Array.isArray(data.set_by_hand)
      ? SOURCE_DETAIL_FIELDS.filter((f) => strList(data.set_by_hand).includes(f))
      : undefined,
    archived: optStr(data.archived) ? isoDate(data.archived, added) : undefined,
    archivedWith: optStr(data.archived) ? optStr(data.archived_with) : undefined,
    body,
    problem: error,
    extra: extraFields(data, SOURCE_KEYS),
  };
}

export function serializeSource(source: Source): string {
  return stringifyFile(
    {
      id: source.id,
      title: source.title,
      authors: source.authors,
      year: source.year,
      type: source.type,
      links: source.links.length ? source.links : undefined,
      pdfs: source.pdfs.length ? source.pdfs : undefined,
      added: source.added,
      updated: source.updated,
      set_by_hand: source.setByHand,
      archived: source.archived,
      archived_with: source.archived ? source.archivedWith : undefined,
      ...source.extra,
    },
    source.body,
    { flow: ["authors", "set_by_hand"] },
  );
}

// --- Groups -----------------------------------------------------------------

const GROUP_KEYS = [
  "id",
  "title",
  "created",
  "updated",
  "sources",
  "sources_changed",
  "archived",
] as const;

function readGroupSources(value: unknown): GroupSourceRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: GroupSourceRef[] = [];
  for (const item of value) {
    // Accept both `- id: x` objects and bare `- x` strings from hand edits.
    const r = typeof item === "string" ? { id: item } : record(item);
    const id = str(r.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, note: str(r.note).trim() });
  }
  return refs;
}

export function parseGroup(
  raw: string,
  meta: { id: string; path: string; fallbackDate: string },
): Group {
  const { data, body, error } = parseFile(raw);
  const created = isoDate(data.created, meta.fallbackDate);
  const sourcesChanged = optStr(data.sources_changed);
  return {
    id: meta.id,
    path: meta.path,
    title: str(data.title).trim() || meta.id,
    created,
    updated: isoDate(data.updated, created),
    sources: readGroupSources(data.sources),
    sourcesChanged: sourcesChanged ? isoDate(sourcesChanged, created) : undefined,
    overview: getSection(body, "Overview", GROUP_SECTIONS, { preambleFallback: true }),
    aiSummary: getAiSummary(body, GROUP_SECTIONS),
    body,
    problem: error,
    archived: optStr(data.archived) ? isoDate(data.archived, created) : undefined,
    extra: extraFields(data, GROUP_KEYS),
  };
}

export function serializeGroup(group: Group): string {
  return stringifyFile(
    {
      id: group.id,
      title: group.title,
      created: group.created,
      updated: group.updated,
      sources: group.sources.map((s) => (s.note ? { id: s.id, note: s.note } : { id: s.id })),
      sources_changed: group.sourcesChanged,
      archived: group.archived,
      ...group.extra,
    },
    group.body,
  );
}

// --- Notes ------------------------------------------------------------------

const NOTE_KEYS = ["id", "title", "created", "updated", "attachments"] as const;

export function parseNote(raw: string, meta: { id: string; path: string; fallbackDate: string }): Note {
  const { data, body, error } = parseFile(raw);
  const created = isoDate(data.created, meta.fallbackDate);
  return {
    id: meta.id,
    path: meta.path,
    title: str(data.title).trim() || meta.id,
    created,
    updated: isoDate(data.updated, created),
    attachments: readAttachments(data.attachments),
    text: getSection(body, "Notes", NOTE_SECTIONS, { preambleFallback: true }),
    aiSummary: getAiSummary(body, NOTE_SECTIONS),
    body,
    problem: error,
    extra: extraFields(data, NOTE_KEYS),
  };
}

export function serializeNote(note: Note): string {
  return stringifyFile(
    {
      id: note.id,
      title: note.title,
      created: note.created,
      updated: note.updated,
      attachments: note.attachments.length ? note.attachments : undefined,
      ...note.extra,
    },
    note.body,
  );
}

// --- Settings ---------------------------------------------------------------

export function parseSettings(raw: string): Settings {
  const { data, body } = parseFile(raw);
  return {
    researchContext: body.trim(),
    updated: optStr(data.updated),
    extra: extraFields(data, ["updated"]),
  };
}

export function serializeSettings(settings: Settings): string {
  return stringifyFile(
    { updated: settings.updated, ...settings.extra },
    settings.researchContext,
  );
}
