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

/** The signed-in user's map, rebuilt from their sources and groups. */
export async function loadMap(userId: string, store: ContentStore): Promise<MapResponse> {
  const [sources, groups] = await Promise.all([store.listSources(), store.listGroups()]);
  const colours = await groupColours(userId, groups);
  const graph = buildGraph({
    sources: sources.map((s) => ({ id: s.id, title: s.title, authors: s.authors, year: s.year, notes: s.notes })),
    groups: groups.map((g) => ({ id: g.id, title: g.title, overview: g.overview, sources: g.sources })),
    colours,
  });
  const layout = await readMapLayout(userId);
  return { ...graph, lastView: layout.lastView ?? "network", pins: layout.pins ?? {} };
}
