import "server-only";
import type { ContentStore } from "../content/store";
import { assignColours } from "./colours";
import { buildGraph, type MapGraph } from "./graph";
import { readMapLayout, updateMapLayout, type MapLayout, type MapView } from "./layout";

/** Each group's colour, assigning (and saving) colours for groups that don't have one yet. */
export async function groupColours(userId: string, groups: Array<{ id: string; created: string }>): Promise<Record<string, string>> {
  const layout = await readMapLayout(userId);
  const { colours, changed } = assignColours(groups, layout.colours);
  if (changed) {
    await updateMapLayout(userId, (l) => {
      for (const [id, hex] of Object.entries(colours)) l.colours[id] ??= hex;
    });
  }
  return colours;
}

export type MapResponse = MapGraph & { lastView: MapView; pins: NonNullable<MapLayout["pins"]> };

/**
 * The signed-in user's map, rebuilt from their sources and groups. Archived
 * ones are left out (so every figure is about what's shown) unless asked for.
 */
export async function loadMap(userId: string, store: ContentStore, opts: { includeArchived?: boolean } = {}): Promise<MapResponse> {
  const [allSources, allGroups] = await Promise.all([store.listSources(), store.listGroups()]);
  const colours = await groupColours(userId, allGroups);
  const sources = opts.includeArchived ? allSources : allSources.filter((s) => !s.archived);
  const groups = opts.includeArchived ? allGroups : allGroups.filter((g) => !g.archived);
  const graph = buildGraph({
    sources: sources.map((s) => ({ id: s.id, title: s.title, authors: s.authors, year: s.year, notes: s.notes, archived: !!s.archived })),
    groups: groups.map((g) => ({ id: g.id, title: g.title, overview: g.overview, sources: g.sources, archived: !!g.archived })),
    colours,
  });
  const layout = await readMapLayout(userId);
  return { ...graph, lastView: layout.lastView ?? "network", pins: layout.pins ?? {} };
}
