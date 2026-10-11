// The Source Map's graph, built from sources and reading groups as they are
// stored (nothing here is saved): sources and groups as nodes, the links
// written in source notes and group membership as edges, and the crossover
// figures derived from them. Pure functions, so they can be unit-tested.

export type MapSourceInput = { id: string; title: string; authors: string[]; year?: number; notes: string };
export type MapGroupInput = { id: string; title: string; overview: string; sources: Array<{ id: string; note: string }> };

/** Where links come from. Only source notes for now; Notes pages could be added as another origin. */
export type LinkOrigin = "source-notes";

export type MapSource = {
  id: string;
  title: string;
  shortTitle: string;
  authors: string[];
  year?: number;
  /** Reading groups it belongs to, in the order the groups are listed. */
  groups: string[];
  /** Distinct sources it links to or is linked from. */
  degree: number;
  notesPreview: string;
  hub: boolean;
  /** No links and no group. */
  isolated: boolean;
  /** In a group, but no links to or from other sources. */
  unlinked: boolean;
};

export type MapGroup = { id: string; title: string; colour: string; overviewPreview: string; sources: string[] };

/** One line per ordered pair: `from`'s notes link to `to`, `count` times, with these linked words. */
export type MapLink = { from: string; to: string; count: number; labels: string[]; origin: LinkOrigin };

export type MapMembership = { source: string; group: string; note: string };

/** A link between two grouped sources that share no group (counted once per pair of sources). */
export type BridgeLink = { a: string; b: string; aGroups: string[]; bGroups: string[] };

export type GroupPair = {
  a: string;
  b: string;
  /** Sources in both groups. */
  shared: string[];
  /** Bridge links with one end in each group. */
  bridges: BridgeLink[];
  /** shared + bridges: sets the thickness of the line between the groups. */
  strength: number;
};

export type MapStats = {
  sources: number;
  links: number;
  groups: number;
  shared: number;
  bridges: number;
  isolated: number;
  unlinked: number;
};

export type MapGraph = {
  sources: MapSource[];
  groups: MapGroup[];
  links: MapLink[];
  memberships: MapMembership[];
  crossover: {
    /** Sources in 2+ groups, most groups first. */
    shared: Array<{ source: string; groups: string[] }>;
    bridges: BridgeLink[];
    /** Pairs of groups with any crossover, strongest first. */
    pairs: GroupPair[];
  };
  stats: MapStats;
};

/** [linked words](/library/<id>) */
const SOURCE_LINK = /\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*\/library\/([^\s)#?]+)[^)]*\)/g;

/** Plain text of a link's words (no Markdown emphasis or code marks). */
function plain(text: string): string {
  return text.replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
}

/** The source links in some Markdown: the linked words and the target source's id. */
export function extractSourceLinks(markdown: string): Array<{ to: string; label: string }> {
  const out: Array<{ to: string; label: string }> = [];
  for (const m of markdown.matchAll(SOURCE_LINK)) {
    let to = m[2];
    try {
      to = decodeURIComponent(to);
    } catch {}
    out.push({ to, label: plain(m[1]) });
  }
  return out;
}

export function shortTitle(title: string, max = 32): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.:;–—-]+$/, "")}…`;
}

function preview(markdown: string, max = 280): string {
  // Line by line, so a heading or list item doesn't run into the next line.
  const text = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+|^>\s?|^\s*[-*+]\s+(\[[ xX]\]\s+)?|^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;…]$/.test(line) ? line : `${line}.`))
    .join(" ");
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Build the map. `colours` gives each group's colour (see colours.ts).
 * Links to sources that no longer exist, links from a source to itself and
 * group entries for deleted sources are skipped.
 */
export function buildGraph(input: {
  sources: MapSourceInput[];
  groups: MapGroupInput[];
  colours: Record<string, string>;
}): MapGraph {
  const sourceIds = new Set(input.sources.map((s) => s.id));

  // Memberships (only for sources that exist).
  const groupsOf = new Map<string, string[]>();
  const memberships: MapMembership[] = [];
  const groups: MapGroup[] = input.groups.map((g) => {
    const members: string[] = [];
    for (const ref of g.sources) {
      if (!sourceIds.has(ref.id) || members.includes(ref.id)) continue;
      members.push(ref.id);
      memberships.push({ source: ref.id, group: g.id, note: ref.note });
      groupsOf.set(ref.id, [...(groupsOf.get(ref.id) ?? []), g.id]);
    }
    return { id: g.id, title: g.title, colour: input.colours[g.id] ?? "", overviewPreview: preview(g.overview), sources: members };
  });

  // Links: one per ordered pair, with every linked phrase.
  const byPair = new Map<string, MapLink>();
  for (const s of input.sources) {
    for (const { to, label } of extractSourceLinks(s.notes)) {
      if (to === s.id || !sourceIds.has(to)) continue;
      const key = `${s.id}\u0000${to}`;
      const link = byPair.get(key) ?? { from: s.id, to, count: 0, labels: [], origin: "source-notes" as const };
      link.count += 1;
      if (label && !link.labels.includes(label)) link.labels.push(label);
      byPair.set(key, link);
    }
  }
  const links = [...byPair.values()];

  // Degree: distinct sources linked with, in either direction.
  const neighbours = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neighbours.has(l.from)) neighbours.set(l.from, new Set());
    if (!neighbours.has(l.to)) neighbours.set(l.to, new Set());
    neighbours.get(l.from)!.add(l.to);
    neighbours.get(l.to)!.add(l.from);
  }
  const degree = (id: string) => neighbours.get(id)?.size ?? 0;

  // Hubs: the top 10% by degree, with at least 3 links.
  const degrees = input.sources.map((s) => degree(s.id)).sort((a, b) => b - a);
  const cutoff = degrees[Math.max(0, Math.ceil(degrees.length * 0.1) - 1)] ?? Infinity;
  const hubThreshold = Math.max(3, cutoff);

  const sources: MapSource[] = input.sources.map((s) => {
    const g = groupsOf.get(s.id) ?? [];
    const d = degree(s.id);
    return {
      id: s.id,
      title: s.title,
      shortTitle: shortTitle(s.title),
      authors: s.authors,
      year: s.year,
      groups: g,
      degree: d,
      notesPreview: preview(s.notes),
      hub: d >= hubThreshold,
      isolated: d === 0 && g.length === 0,
      unlinked: d === 0 && g.length > 0,
    };
  });

  // Crossover.
  const shared = sources
    .filter((s) => s.groups.length >= 2)
    .map((s) => ({ source: s.id, groups: s.groups }))
    .sort((a, b) => b.groups.length - a.groups.length || a.source.localeCompare(b.source));

  const bridgesByPair = new Map<string, BridgeLink>();
  for (const l of links) {
    const ga = groupsOf.get(l.from) ?? [];
    const gb = groupsOf.get(l.to) ?? [];
    if (!ga.length || !gb.length || ga.some((g) => gb.includes(g))) continue;
    const key = pairKey(l.from, l.to);
    if (bridgesByPair.has(key)) continue; // A→B and B→A are one bridge
    const [a, b] = l.from < l.to ? [l.from, l.to] : [l.to, l.from];
    bridgesByPair.set(key, { a, b, aGroups: groupsOf.get(a)!, bGroups: groupsOf.get(b)! });
  }
  const bridges = [...bridgesByPair.values()];

  const pairs = new Map<string, GroupPair>();
  const pairFor = (x: string, y: string) => {
    const key = pairKey(x, y);
    let p = pairs.get(key);
    if (!p) {
      const [a, b] = x < y ? [x, y] : [y, x];
      p = { a, b, shared: [], bridges: [], strength: 0 };
      pairs.set(key, p);
    }
    return p;
  };
  for (const { source, groups: gs } of shared) {
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) pairFor(gs[i], gs[j]).shared.push(source);
  }
  for (const bridge of bridges) {
    for (const x of bridge.aGroups) for (const y of bridge.bGroups) pairFor(x, y).bridges.push(bridge);
  }
  const rankedPairs = [...pairs.values()]
    .map((p) => ({ ...p, strength: p.shared.length + p.bridges.length }))
    .sort((p, q) => q.strength - p.strength || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));

  return {
    sources,
    groups,
    links,
    memberships,
    crossover: { shared, bridges, pairs: rankedPairs },
    stats: {
      sources: sources.length,
      links: links.length,
      groups: groups.length,
      shared: shared.length,
      bridges: bridges.length,
      isolated: sources.filter((s) => s.isolated).length,
      unlinked: sources.filter((s) => s.unlinked).length,
    },
  };
}
