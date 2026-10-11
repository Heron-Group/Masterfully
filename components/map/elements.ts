import type { ElementDefinition, StylesheetJson } from "cytoscape";
import { UNGROUPED_COLOUR } from "@/lib/map/colours";
import type { MapGraph } from "@/lib/map/graph";

// Turning the map's graph into Cytoscape elements, and how they look.
// Node ids are prefixed ("s:" source, "g:" group) so the two kinds can't clash.

export const sourceNodeId = (id: string) => `s:${id}`;
export const groupNodeId = (id: string) => `g:${id}`;
export const linkEdgeId = (from: string, to: string) => `l:${from}>${to}`;

const MAX_SLICES = 8;

export function networkElements(graph: MapGraph): ElementDefinition[] {
  const colour = new Map(graph.groups.map((g) => [g.id, g.colour]));
  const maxDegree = Math.max(1, ...graph.sources.map((s) => s.degree));
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
      // A source in several groups: one pie slice per group colour.
      classes.push("multi");
      for (let i = 0; i < MAX_SLICES; i++) {
        data[`p${i + 1}c`] = groupColours[i] ?? "transparent";
        data[`p${i + 1}s`] = i < groupColours.length ? 100 / Math.min(groupColours.length, MAX_SLICES) : 0;
      }
    }
    if (!s.groups.length) classes.push("ungrouped");
    if (s.hub) classes.push("hub");
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
      classes: "link",
    });
  }
  return els;
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

export function mapStyle(t: ReturnType<typeof themeTokens>): StylesheetJson {
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
      },
    },
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
    // Hover: the node's neighbours stand out, everything else fades.
    { selector: ".faded", style: { opacity: 0.12, "text-opacity": 0.15 } },
    { selector: "edge.lit", style: { "line-color": t.ink, "target-arrow-color": t.ink, opacity: 1 } },
    { selector: "node:selected", style: { "border-width": 4, "border-color": t.accent } },
    { selector: ".found", style: { "border-width": 4, "border-color": t.accent } },
    { selector: ".hidden", style: { display: "none" } },
  ];
}

/**
 * fcose layout for the source network. Membership edges are short and
 * stiff, so each group's sources gather round it (a soft clustering
 * force); source links are longer and looser.
 */
export function networkLayout() {
  return {
    name: "fcose",
    quality: "default",
    randomize: true,
    animate: false,
    fit: true,
    padding: 40,
    nodeDimensionsIncludeLabels: false,
    packComponents: true,
    nodeRepulsion: () => 7000,
    idealEdgeLength: (e: { data: (k: string) => string }) => (e.data("kind") === "member" ? 60 : 130),
    edgeElasticity: (e: { data: (k: string) => string }) => (e.data("kind") === "member" ? 0.6 : 0.15),
    gravity: 0.3,
    numIter: 2500,
  };
}
