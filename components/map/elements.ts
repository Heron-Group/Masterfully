import type { Core, ElementDefinition, NodeCollection, StylesheetJson } from "cytoscape";
import { UNGROUPED_COLOUR } from "@/lib/map/colours";
import type { MapGraph } from "@/lib/map/graph";

// Turning the map's graph into Cytoscape elements, and how they look.
// Node ids are prefixed ("s:" source, "g:" group) so the two kinds can't clash.

export type MapViewName = "network" | "groups";
export type Pins = Record<string, { x: number; y: number }>;

export const sourceNodeId = (id: string) => `s:${id}`;
export const groupNodeId = (id: string) => `g:${id}`;
export const linkEdgeId = (from: string, to: string) => `l:${from}>${to}`;
/** Group-to-group crossover line; `a` and `b` as in GroupPair (a < b). */
export const crossoverEdgeId = (a: string, b: string) => `x:${a}>${b}`;

const MAX_SLICES = 8;

/** Width of a group-to-group line for a crossover strength (bolder in the group overview). */
const crossoverWidth = (strength: number, scale: number) => scale * (1.5 + 1.8 * Math.sqrt(strength));

function crossoverEdges(graph: MapGraph, scale: number): ElementDefinition[] {
  return graph.crossover.pairs.map((p) => ({
    group: "edges",
    data: {
      id: crossoverEdgeId(p.a, p.b),
      kind: "crossover",
      a: p.a,
      b: p.b,
      source: groupNodeId(p.a),
      target: groupNodeId(p.b),
      strength: p.strength,
      width: crossoverWidth(p.strength, scale),
    },
    classes: "crossover",
  }));
}

/** The source network: every source and group, membership, links and crossover lines. */
export function networkElements(graph: MapGraph): ElementDefinition[] {
  const colour = new Map(graph.groups.map((g) => [g.id, g.colour]));
  const maxDegree = Math.max(1, ...graph.sources.map((s) => s.degree));
  const bridges = new Set(graph.crossover.bridges.map((b) => `${b.a}>${b.b}`));
  const els: ElementDefinition[] = [];

  for (const g of graph.groups) {
    els.push({
      group: "nodes",
      data: { id: groupNodeId(g.id), kind: "group", ref: g.id, label: g.title, colour: g.colour, size: 44 + 6 * Math.sqrt(g.sources.length) },
      classes: "group",
    });
  }
  for (const s of graph.sources) {
    const groupColours = s.groups.map((g) => colour.get(g) ?? UNGROUPED_COLOUR);
    const data: Record<string, unknown> = {
      id: sourceNodeId(s.id),
      kind: "source",
      ref: s.id,
      label: s.shortTitle,
      title: s.title,
      colour: groupColours[0] ?? UNGROUPED_COLOUR,
      // Grows with the number of sources it's linked with.
      size: 16 + 26 * Math.sqrt(s.degree / maxDegree),
    };
    const classes = ["source"];
    if (s.groups.length >= 2) {
      // A shared source: one pie slice per group colour.
      classes.push("multi");
      for (let i = 0; i < MAX_SLICES; i++) {
        data[`p${i + 1}c`] = groupColours[i] ?? "transparent";
        data[`p${i + 1}s`] = i < groupColours.length ? 100 / Math.min(groupColours.length, MAX_SLICES) : 0;
      }
    }
    if (!s.groups.length) classes.push("ungrouped");
    if (s.hub) classes.push("hub");
    if (s.isolated) classes.push("isolated");
    if (s.unlinked) classes.push("unlinked");
    els.push({ group: "nodes", data, classes: classes.join(" ") });
  }
  for (const m of graph.memberships) {
    els.push({
      group: "edges",
      data: { id: `m:${m.source}>${m.group}`, kind: "member", source: sourceNodeId(m.source), target: groupNodeId(m.group) },
      classes: "member",
    });
  }
  for (const l of graph.links) {
    const bridge = bridges.has(l.from < l.to ? `${l.from}>${l.to}` : `${l.to}>${l.from}`);
    els.push({
      group: "edges",
      data: {
        id: linkEdgeId(l.from, l.to),
        kind: "link",
        from: l.from,
        to: l.to,
        source: sourceNodeId(l.from),
        target: sourceNodeId(l.to),
        // A little thicker for each extra link between the same two sources.
        width: 1.4 + 0.7 * (Math.min(l.count, 5) - 1),
      },
      classes: bridge ? "link bridge" : "link",
    });
  }
  els.push(...crossoverEdges(graph, 1));
  return els;
}

/** The group overview: one node per group, sized by its sources, and the crossover lines. */
export function groupElements(graph: MapGraph): ElementDefinition[] {
  const unlinked = new Set(graph.sources.filter((s) => s.unlinked).map((s) => s.id));
  return [
    ...graph.groups.map(
      (g): ElementDefinition => ({
        group: "nodes",
        data: {
          id: groupNodeId(g.id),
          kind: "group",
          ref: g.id,
          label: g.title,
          colour: g.colour,
          size: 30 + 12 * Math.sqrt(g.sources.length),
        },
        classes: g.sources.some((s) => unlinked.has(s)) ? "group overview has-gaps" : "group overview",
      }),
    ),
    ...crossoverEdges(graph, 2).map((e) => ({ ...e, classes: "crossover labelled" })),
  ];
}

/** Colours and fonts from the page, so the map follows the light/dark theme. */
export function themeTokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v("--ink", "#1f1e1b"),
    muted: v("--muted", "#6c675e"),
    faint: v("--faint", "#9d978c"),
    rule: v("--rule", "#e7e3da"),
    paper: v("--paper", "#fbfaf7"),
    surface: v("--surface", "#ffffff"),
    accent: v("--accent", "#ff4a00"),
    font: getComputedStyle(document.body).fontFamily || "Inter, sans-serif",
  };
}

export type ThemeTokens = ReturnType<typeof themeTokens>;

export function mapStyle(t: ThemeTokens): StylesheetJson {
  const slices: Record<string, string> = {};
  for (let i = 1; i <= MAX_SLICES; i++) {
    slices[`pie-${i}-background-color`] = `data(p${i}c)`;
    slices[`pie-${i}-background-size`] = `data(p${i}s)`;
  }
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-family": t.font,
        color: t.ink,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-outline-color": t.paper,
        "text-outline-width": 2,
        "min-zoomed-font-size": 7,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "node.source",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(colour)",
        "border-width": 1.5,
        "border-color": t.surface,
        "font-size": 10,
        "text-max-width": "140px",
        "text-wrap": "ellipsis",
      },
    },
    { selector: "node.multi", style: { "pie-size": "100%", ...slices } as never },
    { selector: "node.hub", style: { "border-width": 3, "border-color": t.ink, "font-weight": 600 } },
    {
      selector: "node.group",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(colour)",
        "background-opacity": 0.92,
        "border-width": 3,
        "border-color": t.surface,
        "font-size": 13,
        "font-weight": 600,
        "text-margin-y": 6,
        "text-max-width": "200px",
        "text-wrap": "wrap",
      },
    },
    { selector: "node.overview", style: { "font-size": 14 } },
    {
      selector: "edge.member",
      style: { width: 1, "line-color": t.rule, "curve-style": "haystack", opacity: 0.9 },
    },
    {
      selector: "edge.link",
      style: {
        width: "data(width)",
        "line-color": t.muted,
        "target-arrow-shape": "triangle",
        "target-arrow-color": t.muted,
        "arrow-scale": 0.8,
        "curve-style": "bezier",
        opacity: 0.85,
      },
    },
    {
      selector: "edge.crossover",
      style: {
        width: "data(width)",
        "line-color": t.faint,
        "curve-style": "straight",
        opacity: 0.35,
        "line-cap": "round",
      },
    },
    {
      selector: "edge.crossover.labelled",
      style: {
        opacity: 0.7,
        label: "data(strength)",
        "font-family": t.font,
        "font-size": 11,
        "font-weight": 600,
        color: t.muted,
        "text-background-color": t.paper,
        "text-background-opacity": 1,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
      },
    },
    // Crossover and Gaps modes: what's highlighted keeps its colour, the rest fades.
    { selector: ".dim", style: { opacity: 0.1, "text-opacity": 0.15 } },
    { selector: "node.xhl", style: { "border-width": 4, "border-color": t.accent } },
    {
      selector: "edge.xhl",
      style: { "line-color": t.accent, "target-arrow-color": t.accent, opacity: 1, "z-index": 10 },
    },
    // In the network, group-to-group lines are context; the sources are the point.
    { selector: "edge.crossover.xhl", style: { opacity: 0.45 } },
    { selector: "edge.crossover.labelled.xhl", style: { opacity: 1 } },
    { selector: "node.gap", style: { "border-width": 3, "border-color": t.accent, "border-style": "solid" } },
    { selector: "node.gap.isolated", style: { "border-style": "dashed" } },
    // Hover: the node's neighbours stand out, everything else fades.
    { selector: ".faded", style: { opacity: 0.12, "text-opacity": 0.15 } },
    { selector: ".near", style: { opacity: 1, "text-opacity": 1 } },
    { selector: "edge.lit", style: { "line-color": t.ink, "target-arrow-color": t.ink, opacity: 1 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": t.accent } },
    { selector: "edge:selected", style: { "line-color": t.accent, "target-arrow-color": t.accent, opacity: 1 } },
    { selector: ".found", style: { "border-width": 4, "border-color": t.accent } },
    { selector: ".hidden, .unfocused", style: { display: "none" } },
  ];
}

type Edge = { data: (k: string) => unknown };

/**
 * Layout options for a view. Pinned nodes stay where they were put.
 * `quality` "draft" is the fast first pass for large maps (see useLayout
 * in map-view); "default" is the full layout.
 */
export function layoutFor(view: MapViewName, pins: Pins, nodeIds: Set<string>, quality: "draft" | "default" = "default") {
  const fixed = Object.entries(pins)
    .filter(([id]) => nodeIds.has(id))
    .map(([nodeId, position]) => ({ nodeId, position }));
  const common = {
    name: "fcose",
    randomize: true,
    animate: false,
    fit: true,
    padding: 40,
    nodeDimensionsIncludeLabels: false,
    fixedNodeConstraint: fixed.length ? fixed : undefined,
  };
  if (view === "groups") {
    return {
      ...common,
      quality: "proof",
      nodeRepulsion: () => 30000,
      // Stronger crossover pulls groups closer together.
      idealEdgeLength: (e: Edge) => 260 - 18 * Math.min(Number(e.data("strength")), 8),
      edgeElasticity: () => 0.3,
      gravity: 0.4,
    };
  }
  return {
    ...common,
    // Membership edges are short and stiff, so each group's sources gather
    // round it (a soft clustering force); source links are longer and looser,
    // and crossover lines pull related groups gently together.
    quality,
    nodeRepulsion: () => 7000,
    idealEdgeLength: (e: Edge) => ({ member: 60, link: 130 })[e.data("kind") as string] ?? 280,
    edgeElasticity: (e: Edge) => ({ member: 0.6, link: 0.15 })[e.data("kind") as string] ?? 0.04,
    gravity: 0.3,
  };
}

/** Above this many nodes, the full layout runs in a worker after a fast first pass. */
export const LARGE_MAP = 300;

/** The node sizes the layout needs, for a headless Cytoscape (the worker). */
export const LAYOUT_STYLE: StylesheetJson = [{ selector: "node", style: { width: "data(size)", height: "data(size)" } }];

/** Run `fn` with a fixed Math.random, so the same data gives the same layout every time. */
export function withSeed<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/**
 * What focus mode shows: the node and its neighbours `steps` away. A source's
 * neighbours are the sources it links with; a group's are its sources and
 * the groups it crosses over with. The groups of every source shown are
 * kept for context.
 */
export function focusSet(cy: Core, id: string, steps: 1 | 2): NodeCollection {
  const start = cy.$id(id);
  let shown = start.nodes();
  let frontier = shown;
  for (let i = 0; i < steps; i++) {
    let next = cy.collection().nodes();
    frontier.forEach((n) => {
      const via = n.data("kind") === "group" ? n.connectedEdges(".member, .crossover") : n.connectedEdges(".link");
      next = next.union(via.connectedNodes());
    });
    next = next.difference(shown);
    shown = shown.union(next);
    frontier = next;
  }
  // Context: the groups of the sources shown.
  return shown.union(shown.filter(".source").connectedEdges(".member").connectedNodes(".group"));
}
