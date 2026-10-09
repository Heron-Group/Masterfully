import matter from "gray-matter";
import YAML from "yaml";

/**
 * Frontmatter is parsed with YAML 1.2 (the `yaml` package) rather than
 * gray-matter's default js-yaml engine. YAML 1.2 has no timestamp type, so
 * `created: 2026-10-09T14:32:05Z` stays a plain string instead of becoming
 * a Date, and it round-trips unquoted when written back.
 */
const engines = {
  yaml: {
    parse: (input: string) => (YAML.parse(input) ?? {}) as object,
    stringify: (data: object) => YAML.stringify(data),
  },
};

export type ParsedFile = {
  data: Record<string, unknown>;
  body: string;
  /** Set when the frontmatter could not be parsed; `body` is then the raw file. */
  error?: string;
};

export function parseFile(raw: string): ParsedFile {
  try {
    // Passing options also bypasses gray-matter's shared result cache,
    // which would otherwise hand out mutable objects between callers.
    const file = matter(raw, { engines });
    const data =
      file.data && typeof file.data === "object" && !Array.isArray(file.data)
        ? (file.data as Record<string, unknown>)
        : {};
    return { data, body: file.content.replace(/^\r?\n/, "") };
  } catch (err) {
    return { data: {}, body: raw, error: errorMessage(err) };
  }
}

/** Keys listed in `flow` are written as inline lists, e.g. `authors: ["A", "B"]`. */
export function stringifyFile(
  data: Record<string, unknown>,
  body: string,
  options: { flow?: string[] } = {},
): string {
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  );
  const doc = new YAML.Document(clean);
  for (const key of options.flow ?? []) {
    const node = doc.get(key, true);
    if (YAML.isSeq(node)) node.flow = true;
  }
  const yaml = Object.keys(clean).length ? doc.toString({ lineWidth: 0 }) : "";
  const text = body.replace(/^\s*\n/, "").replace(/\s+$/, "");
  return `---\n${yaml}---\n${text ? `${text}\n` : ""}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Tolerant field readers -------------------------------------------------
// Hand-edited files may have missing or wrongly-typed fields. These never
// throw; they return a fallback instead.

export function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return fallback;
}

export function optStr(value: unknown): string | undefined {
  const s = str(value).trim();
  return s ? s : undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function strList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => str(v).trim()).filter(Boolean);
  const single = str(value).trim();
  return single ? [single] : [];
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Returns an ISO 8601 UTC string, or `fallback` if the value is not a valid date. */
export function isoDate(value: unknown, fallback: string): string {
  const s = str(value).trim();
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : toIso(d);
}

/** ISO 8601 in UTC without milliseconds: 2026-10-09T14:32:05Z */
export function toIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Fields not in `known`, so hand-added frontmatter survives a rewrite. */
export function extraFields(
  data: Record<string, unknown>,
  known: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !known.includes(k)));
}
