import { extractSourceLinks } from "../map/graph";

/** How many other sources a source links to (in its notes) and is linked from. */
export type LinkCounts = Record<string, { to: number; from: number }>;

/** Distinct sources each source links to and is linked from, read from source notes (as on the map). */
export function countLinks(sources: Array<{ id: string; notes: string }>): LinkCounts {
  const ids = new Set(sources.map((s) => s.id));
  const to = new Map<string, Set<string>>();
  const from = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, value: string) => m.set(key, (m.get(key) ?? new Set()).add(value));
  for (const s of sources) {
    for (const link of extractSourceLinks(s.notes)) {
      if (link.to === s.id || !ids.has(link.to)) continue;
      add(to, s.id, link.to);
      add(from, link.to, s.id);
    }
  }
  return Object.fromEntries(sources.map((s) => [s.id, { to: to.get(s.id)?.size ?? 0, from: from.get(s.id)?.size ?? 0 }]));
}
