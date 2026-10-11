import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";
import { focusSet, groupElements, networkElements } from "@/components/map/elements";
import { buildGraph } from "@/lib/map/graph";

// G1 = a, b    G2 = b, d    G3 = e    c in no group
// a → b, b → d, d → e (a bridge: G2/G3)
const src = (id: string, notes = "") => ({ id, title: `Source ${id}`, authors: [], notes });
const graph = buildGraph({
  sources: [src("a", "[b](/library/b)"), src("b", "[d](/library/d)"), src("c"), src("d", "[e](/library/e)"), src("e")],
  groups: [
    { id: "g1", title: "One", overview: "", sources: [{ id: "a", note: "" }, { id: "b", note: "" }] },
    { id: "g2", title: "Two", overview: "", sources: [{ id: "b", note: "" }, { id: "d", note: "" }] },
    { id: "g3", title: "Three", overview: "", sources: [{ id: "e", note: "" }] },
  ],
  colours: { g1: "#4e79a7", g2: "#f28e2b", g3: "#59a14f" },
});

describe("map elements", () => {
  const cy = cytoscape({ headless: true, elements: networkElements(graph) });
  const classes = (id: string) => cy.$id(id).classes();

  it("marks shared sources, bridge links and gaps for the modes", () => {
    expect(classes("s:b")).toContain("multi");
    expect(classes("l:d>e")).toContain("bridge");
    expect(classes("l:a>b")).not.toContain("bridge");
    expect(classes("s:c")).toEqual(expect.arrayContaining(["ungrouped", "isolated"]));
  });

  it("draws a group-to-group line for each crossing pair", () => {
    expect(cy.edges(".crossover").map((e) => e.id()).sort()).toEqual(["x:g1>g2", "x:g2>g3"]);
    const overview = cytoscape({ headless: true, elements: groupElements(graph) });
    expect(overview.nodes().length).toBe(3);
    expect(overview.$id("x:g1>g2").data("strength")).toBe(1);
  });

  it("focus shows a source's linked neighbours, 1 or 2 steps away, with their groups", () => {
    const ids = (steps: 1 | 2) => focusSet(cy, "s:a", steps).map((n) => n.id()).sort();
    expect(ids(1)).toEqual(["g:g1", "g:g2", "s:a", "s:b"]);
    expect(ids(2)).toEqual(["g:g1", "g:g2", "s:a", "s:b", "s:d"]);
  });

  it("focus on a group shows its sources and the groups it crosses over with", () => {
    expect(focusSet(cy, "g:g3", 1).map((n) => n.id()).sort()).toEqual(["g:g2", "g:g3", "s:e"]);
  });
});
