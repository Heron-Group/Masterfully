import { describe, expect, it } from "vitest";
import { assignColours, GROUP_PALETTE } from "@/lib/map/colours";
import { buildGraph, extractSourceLinks, shortTitle, type MapSourceInput } from "@/lib/map/graph";

// Fixture with known answers:
//   G1 = a, b, c    G2 = c, d    G3 = e, u     (G1 also lists a deleted source)
//   a → b (twice, two phrases), a → d, d → a, b → e, c → d, f → a,
//   plus a link to a deleted source and a self-link (both ignored).
//   f is in no group but links; g has nothing; u is grouped with no links.
const src = (id: string, notes = ""): MapSourceInput => ({ id, title: `Source ${id.toUpperCase()}`, authors: [], notes });
const fixture = {
  sources: [
    src("a", "Builds on [the primer](/library/b) and [**its sequel**](/library/b). Contrast [D](/library/d). [me](/library/a)"),
    src("b", "Extends [E's idea](/library/e). [gone](/library/zzz)"),
    src("c", "See [d](/library/d)"),
    src("d", "Answers [a](/library/a)"),
    src("e"),
    src("f", "Cites [a](/library/a)"),
    src("g"),
    src("u"),
  ],
  groups: [
    { id: "g1", title: "Group one", overview: "", sources: [{ id: "a", note: "" }, { id: "b", note: "" }, { id: "c", note: "Bridges both" }, { id: "deleted", note: "" }] },
    { id: "g2", title: "Group two", overview: "", sources: [{ id: "c", note: "" }, { id: "d", note: "" }] },
    { id: "g3", title: "Group three", overview: "", sources: [{ id: "e", note: "" }, { id: "u", note: "" }] },
  ],
  colours: { g1: "#4e79a7", g2: "#f28e2b", g3: "#59a14f" },
};

describe("Source Map graph", () => {
  const graph = buildGraph(fixture);
  const source = (id: string) => graph.sources.find((s) => s.id === id)!;

  it("finds source links in notes, with the linked words", () => {
    expect(extractSourceLinks("See [the *primer*](/library/sanders-2008) and [x](https://example.org)")).toEqual([
      { to: "sanders-2008", label: "the primer" },
    ]);
  });

  it("has one line per ordered pair, counting repeats and keeping every phrase", () => {
    const ab = graph.links.find((l) => l.from === "a" && l.to === "b")!;
    expect(ab).toMatchObject({ count: 2, labels: ["the primer", "its sequel"] });
    expect(graph.links.map((l) => `${l.from}→${l.to}`).sort()).toEqual(["a→b", "a→d", "b→e", "c→d", "d→a", "f→a"]);
  });

  it("skips links to deleted sources, self-links, and group entries for deleted sources", () => {
    expect(graph.links.some((l) => l.to === "zzz" || l.from === l.to)).toBe(false);
    expect(graph.groups.find((g) => g.id === "g1")!.sources).toEqual(["a", "b", "c"]);
    expect(graph.memberships).toHaveLength(7);
    expect(graph.memberships.find((m) => m.source === "c" && m.group === "g1")!.note).toBe("Bridges both");
  });

  it("lists shared sources (2+ groups)", () => {
    expect(graph.crossover.shared).toEqual([{ source: "c", groups: ["g1", "g2"] }]);
    expect(source("c").groups).toEqual(["g1", "g2"]);
  });

  it("finds bridge links between sources with no group in common, once per pair", () => {
    // a→d and d→a are one bridge; c→d share g2; f has no group.
    expect(graph.crossover.bridges).toEqual([
      { a: "a", b: "d", aGroups: ["g1"], bGroups: ["g2"] },
      { a: "b", b: "e", aGroups: ["g1"], bGroups: ["g3"] },
    ]);
  });

  it("measures group crossover as shared sources plus bridge links, strongest first", () => {
    expect(graph.crossover.pairs.map((p) => ({ a: p.a, b: p.b, shared: p.shared, bridges: p.bridges.length, strength: p.strength }))).toEqual([
      { a: "g1", b: "g2", shared: ["c"], bridges: 1, strength: 2 },
      { a: "g1", b: "g3", shared: [], bridges: 1, strength: 1 },
    ]);
  });

  it("marks hubs, isolated and unlinked sources", () => {
    expect(graph.sources.filter((s) => s.hub).map((s) => s.id)).toEqual(["a"]); // degree 3: b, d, f
    expect(source("a").degree).toBe(3);
    expect(graph.sources.filter((s) => s.isolated).map((s) => s.id)).toEqual(["g"]);
    expect(graph.sources.filter((s) => s.unlinked).map((s) => s.id)).toEqual(["u"]);
    expect(source("f")).toMatchObject({ isolated: false, unlinked: false, groups: [] });
  });

  it("totals everything for the summary bar", () => {
    expect(graph.stats).toEqual({ sources: 8, links: 6, groups: 3, shared: 1, bridges: 2, isolated: 1, unlinked: 1 });
  });

  it("shortens long titles at a word", () => {
    expect(shortTitle("Making: Anthropology, Archaeology, Art and Architecture")).toBe("Making: Anthropology…");
    expect(shortTitle("Short")).toBe("Short");
  });
});

describe("group colours", () => {
  const groups = [
    { id: "late", created: "2026-03-01T00:00:00Z" },
    { id: "early", created: "2026-01-01T00:00:00Z" },
    { id: "mid", created: "2026-02-01T00:00:00Z" },
  ];

  it("keeps saved colours and gives new groups the least-used colour, oldest first", () => {
    const { colours, changed } = assignColours(groups, { mid: GROUP_PALETTE[0].hex });
    expect(changed).toBe(true);
    expect(colours).toEqual({ mid: GROUP_PALETTE[0].hex, early: GROUP_PALETTE[1].hex, late: GROUP_PALETTE[2].hex });
    expect(assignColours(groups, colours).changed).toBe(false);
  });

  it("ignores a saved colour that isn't in the palette", () => {
    expect(assignColours([groups[1]], { early: "#123456" }).colours.early).toBe(GROUP_PALETTE[0].hex);
  });
});

describe("previews", () => {
  it("keeps headings and list items apart", () => {
    const graph = buildGraph({ sources: [src("p", "## Making and thinking\nIngold argues that making is thinking\n- Growth")], groups: [], colours: {} });
    expect(graph.sources[0].notesPreview).toBe("Making and thinking. Ingold argues that making is thinking. Growth.");
  });
});
