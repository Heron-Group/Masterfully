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

export type Source = {
  id: string;
  path: string;
  title: string;
  authors: string[];
  year?: number;
  type: SourceType;
  url?: string;
  pdf?: string;
  added: string;
  updated: string;
  notes: string;
  aiSummary: AiSummary | null;
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
  "added",
  "updated",
] as const;

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
  return {
    id: meta.id,
    path: meta.path,
    title: str(data.title).trim() || meta.id,
    authors: strList(data.authors),
    year: num(data.year),
    type: toSourceType(data.type),
    url: optStr(data.url),
    pdf: optStr(data.pdf),
    added,
    updated: isoDate(data.updated, added),
    notes: getSection(body, "Notes", SOURCE_SECTIONS, { preambleFallback: true }),
    aiSummary: getAiSummary(body, SOURCE_SECTIONS),
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
      url: source.url,
      pdf: source.pdf,
      added: source.added,
      updated: source.updated,
      ...source.extra,
    },
    source.body,
    { flow: ["authors"] },
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
      ...group.extra,
    },
    group.body,
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
