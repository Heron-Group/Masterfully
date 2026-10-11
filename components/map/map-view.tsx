"use client";

import type { Core, EventObject, NodeSingular } from "cytoscape";
import { ArrowLeft, ArrowRight, BookOpen, Search, SquareStack, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { formatAuthors } from "@/lib/dto";
import { UNGROUPED_COLOUR } from "@/lib/map/colours";
import type { MapGraph } from "@/lib/map/graph";
import { groupNodeId, mapStyle, networkElements, networkLayout, sourceNodeId, themeTokens } from "./elements";

type Selected = { kind: "source" | "group"; id: string } | null;
type Tooltip = { x: number; y: number; title: string; lines: string[] } | null;

let registered = false;

/** The Source Map: the source network, with a legend and filters, search and a side panel. */
export function MapView() {
  const [graph, setGraph] = useState<MapGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showUngrouped, setShowUngrouped] = useState(true);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    fetch("/api/map", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't load the map.");
        return r.json() as Promise<MapGraph>;
      })
      .then(setGraph)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the map."));
  }, []);

  const lookup = useMemo(() => {
    if (!graph) return null;
    return {
      source: new Map(graph.sources.map((s) => [s.id, s])),
      group: new Map(graph.groups.map((g) => [g.id, g])),
    };
  }, [graph]);

  // Draw the network once the data has arrived.
  useEffect(() => {
    if (!graph || !container.current || !graph.sources.length) return;
    let cy: Core | null = null;
    let cancelled = false;
    let observer: MutationObserver | null = null;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const fcose = (await import("cytoscape-fcose")).default;
      if (!registered) {
        cytoscape.use(fcose);
        registered = true;
      }
      if (cancelled || !container.current) return;
      const big = graph.sources.length > 300 || graph.links.length > 1200;
      cy = cytoscape({
        container: container.current,
        elements: networkElements(graph),
        style: mapStyle(themeTokens()),
        layout: networkLayout() as never,
        minZoom: 0.05,
        maxZoom: 4,
        // Smooth panning on large maps: draw a snapshot while moving.
        textureOnViewport: big,
        hideEdgesOnViewport: big,
        boxSelectionEnabled: false,
      });
      cyRef.current = cy;
      // A small map shouldn't be blown up to fill the screen.
      cy.ready(() => {
        if (cy && cy.zoom() > 1.2) {
          cy.zoom(1.2);
          cy.center();
        }
      });

      const lightUp = (node: NodeSingular) =>
        cy!.batch(() => {
          cy!.elements().addClass("faded");
          const near = node.closedNeighborhood();
          near.removeClass("faded");
          near.edges(".link").addClass("lit");
        });
      const clear = () => cy!.batch(() => cy!.elements().removeClass("faded lit"));
      const place = (e: EventObject) => {
        const box = container.current!.getBoundingClientRect();
        const p = e.renderedPosition ?? { x: 0, y: 0 };
        return { x: box.left + p.x, y: box.top + p.y };
      };

      cy.on("mouseover", "node", (e) => {
        const n = e.target as NodeSingular;
        lightUp(n);
        const at = place(e);
        if (n.data("kind") === "group") {
          const g = graph.groups.find((x) => x.id === n.data("ref"));
          setTooltip({ ...at, title: n.data("label"), lines: [`${g?.sources.length ?? 0} sources`] });
        } else setTooltip({ ...at, title: n.data("title"), lines: [] });
      });
      cy.on("mouseout", "node", () => {
        clear();
        setTooltip(null);
      });
      cy.on("mouseover", "edge.link", (e) => {
        const l = graph.links.find((x) => x.from === e.target.data("from") && x.to === e.target.data("to"));
        if (!l) return;
        const from = graph.sources.find((s) => s.id === l.from)?.shortTitle ?? l.from;
        const to = graph.sources.find((s) => s.id === l.to)?.shortTitle ?? l.to;
        setTooltip({
          ...place(e),
          title: `${from} → ${to}`,
          lines: [...l.labels.map((x) => `“${x}”`), ...(l.count > 1 ? [`${l.count} links`] : [])],
        });
      });
      cy.on("mouseout", "edge", () => setTooltip(null));
      cy.on("tap", "node", (e) => setSelected({ kind: e.target.data("kind"), id: e.target.data("ref") }));
      cy.on("tap", (e) => {
        if (e.target === cy) setSelected(null);
      });
      cy.on("viewport", () => setTooltip(null));

      // Follow the light/dark theme.
      observer = new MutationObserver(() => cy?.style(mapStyle(themeTokens())));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      cy?.destroy();
      cyRef.current = null;
    };
  }, [graph]);

  // Filters: a source stays visible if any of its groups is shown.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) return;
    cy.batch(() => {
      for (const g of graph.groups) cy.$id(groupNodeId(g.id)).toggleClass("hidden", hidden.has(g.id));
      for (const s of graph.sources) {
        const show = s.groups.length ? s.groups.some((g) => !hidden.has(g)) : showUngrouped;
        cy.$id(sourceNodeId(s.id)).toggleClass("hidden", !show);
      }
    });
  }, [graph, hidden, showUngrouped]);

  // Keep the map's selection in step with the side panel.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.$(":selected").unselect();
    if (selected) cy.$id(selected.kind === "source" ? sourceNodeId(selected.id) : groupNodeId(selected.id)).select();
  }, [selected]);

  /** Select something and bring it into view (from search or the side panel). */
  function focusOn(kind: "source" | "group", id: string) {
    setSelected({ kind, id });
    const cy = cyRef.current;
    const node = cy?.$id(kind === "source" ? sourceNodeId(id) : groupNodeId(id));
    if (!cy || !node?.length) return;
    if (node.hasClass("hidden")) {
      // Show it again if a filter had hidden it.
      if (kind === "group") setHidden((h) => new Set([...h].filter((g) => g !== id)));
      else {
        const s = lookup?.source.get(id);
        if (s?.groups.length) setHidden((h) => new Set([...h].filter((g) => !s.groups.includes(g))));
        else setShowUngrouped(true);
      }
    }
    cy.animate(
      { fit: { eles: node.closedNeighborhood(), padding: 90 } },
      {
        duration: 350,
        // On a phone the details sheet covers the lower part: move it up into view.
        complete: () => {
          if (window.matchMedia("(max-width: 767px)").matches) cy.panBy({ x: 0, y: -cy.height() * 0.3 });
        },
      },
    );
    node.addClass("found");
    setTimeout(() => node.removeClass("found"), 1600);
  }

  if (error) {
    return (
      <p role="alert" className="p-8 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (graph && !graph.sources.length) return <EmptyState label="Your map is empty. Add sources to see how they connect." />;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5 md:px-6">
        <h1 className="mr-auto font-serif text-2xl tracking-tight">Source map</h1>
        {graph && <MapSearch graph={graph} onPick={focusOn} />}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">
          <div ref={container} className="h-full w-full" aria-label="Source network" role="img" data-testid="map-canvas" />
          {!graph && <p className="absolute inset-0 flex items-center justify-center text-sm text-faint">Drawing your map…</p>}
          {graph && (
            <Legend
              graph={graph}
              hidden={hidden}
              showUngrouped={showUngrouped}
              onToggle={(id) =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onToggleUngrouped={() => setShowUngrouped((v) => !v)}
            />
          )}
        </div>
        {graph && lookup && selected && (
          <SidePanel graph={graph} lookup={lookup} selected={selected} onClose={() => setSelected(null)} onPick={focusOn} />
        )}
      </div>
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lg"
          style={{ left: Math.min(tooltip.x + 12, window.innerWidth - 300), top: tooltip.y + 14 }}
        >
          <p className="font-medium">{tooltip.title}</p>
          {tooltip.lines.map((l, i) => (
            <p key={i} className="opacity-80">
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Find a source or group by name and zoom to it. */
function MapSearch({ graph, onPick }: { graph: MapGraph; onPick: (kind: "source" | "group", id: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const groups = graph.groups
      .filter((g) => words.every((w) => fold(g.title).includes(w)))
      .map((g) => ({ kind: "group" as const, id: g.id, title: g.title, detail: `${g.sources.length} sources` }));
    const sources = graph.sources
      .filter((s) => words.every((w) => fold(`${s.title} ${s.authors.join(" ")} ${s.year ?? ""}`).includes(w)))
      .map((s) => ({ kind: "source" as const, id: s.id, title: s.title, detail: [formatAuthors(s.authors), s.year].filter(Boolean).join(" · ") }));
    return [...groups, ...sources].slice(0, 8);
  }, [graph, query]);

  const pick = (r: (typeof results)[number]) => {
    onPick(r.kind, r.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative w-full sm:w-72">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Find a source or group"
        aria-label="Find a source or group"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="map-search-results"
        className="w-full rounded-md bg-accent-soft/60 py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-faint focus:outline-none"
      />
      {open && results.length > 0 && (
        <ul id="map-search-results" role="listbox" className="absolute right-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg bg-surface p-1 text-sm shadow-lg shadow-black/10 ring-1 ring-rule">
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${i === active ? "bg-accent-soft/80" : ""}`}
              >
                {r.kind === "group" ? (
                  <SquareStack size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                ) : (
                  <BookOpen size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-ink">{r.title}</span>
                  {r.detail && <span className="block truncate text-xs text-muted">{r.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every group with its colour and source count; untick to hide it. */
function Legend({
  graph,
  hidden,
  showUngrouped,
  onToggle,
  onToggleUngrouped,
}: {
  graph: MapGraph;
  hidden: Set<string>;
  showUngrouped: boolean;
  onToggle: (id: string) => void;
  onToggleUngrouped: () => void;
}) {
  const ungrouped = graph.sources.filter((s) => !s.groups.length).length;
  const row = "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent-soft/60";
  return (
    <div className="absolute bottom-3 left-3 z-10 max-h-[45%] w-60 overflow-y-auto rounded-lg bg-surface/95 p-2 text-[13px] shadow-sm ring-1 ring-rule backdrop-blur" role="group" aria-label="Reading groups">
      <p className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Reading groups</p>
      <ul>
        {graph.groups.map((g) => (
          <li key={g.id}>
            <label className={`${row} cursor-pointer ${hidden.has(g.id) ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={!hidden.has(g.id)} onChange={() => onToggle(g.id)} className="accent-[var(--accent)]" />
              <span className="size-3 shrink-0 rounded-full" style={{ background: g.colour }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span className="tabular-nums text-faint">{g.sources.length}</span>
            </label>
          </li>
        ))}
        <li>
          <label className={`${row} cursor-pointer ${showUngrouped ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={showUngrouped} onChange={onToggleUngrouped} className="accent-[var(--accent)]" />
            <span className="size-3 shrink-0 rounded-full" style={{ background: UNGROUPED_COLOUR }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Not in a group</span>
            <span className="tabular-nums text-faint">{ungrouped}</span>
          </label>
        </li>
      </ul>
    </div>
  );
}

type Lookup = { source: Map<string, MapGraph["sources"][number]>; group: Map<string, MapGraph["groups"][number]> };

/** Details of the selected source or group, with links into the app. */
function SidePanel({
  graph,
  lookup,
  selected,
  onClose,
  onPick,
}: {
  graph: MapGraph;
  lookup: Lookup;
  selected: NonNullable<Selected>;
  onClose: () => void;
  onPick: (kind: "source" | "group", id: string) => void;
}) {
  const chip = (id: string) => {
    const g = lookup.group.get(id);
    if (!g) return null;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onPick("group", id)}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft/70 px-2 py-0.5 text-[13px] hover:bg-accent-soft"
      >
        <span className="size-2.5 rounded-full" style={{ background: g.colour }} aria-hidden="true" />
        {g.title}
      </button>
    );
  };
  const sourceItem = (id: string, phrases: string[], dir: "out" | "in") => {
    const s = lookup.source.get(id);
    if (!s) return null;
    const Arrow = dir === "out" ? ArrowRight : ArrowLeft;
    return (
      <li key={`${dir}:${id}`}>
        <button type="button" onClick={() => onPick("source", id)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent-soft/60">
          <Arrow size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-ink">{s.title}</span>
            {phrases.length > 0 && <span className="block truncate text-xs text-muted">{phrases.map((p) => `“${p}”`).join(", ")}</span>}
          </span>
        </button>
      </li>
    );
  };

  let body: React.ReactNode;
  if (selected.kind === "source") {
    const s = lookup.source.get(selected.id);
    if (!s) return null;
    const out = graph.links.filter((l) => l.from === s.id);
    const into = graph.links.filter((l) => l.to === s.id);
    body = (
      <>
        <p className="text-[11px] font-medium uppercase tracking-wider text-faint">Source</p>
        <h2 className="mt-1 font-serif text-xl leading-snug">{s.title}</h2>
        {(s.authors.length > 0 || s.year) && (
          <p className="mt-1 text-sm text-muted">{[formatAuthors(s.authors), s.year].filter(Boolean).join(" · ")}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">{s.groups.length ? s.groups.map(chip) : <span className="text-sm text-faint">Not in a group</span>}</div>
        {s.notesPreview && <p className="mt-4 text-sm leading-relaxed text-ink">{s.notesPreview}</p>}
        {out.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Links to</h3>
            <ul>{out.map((l) => sourceItem(l.to, l.labels, "out"))}</ul>
          </section>
        )}
        {into.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Linked from</h3>
            <ul>{into.map((l) => sourceItem(l.from, l.labels, "in"))}</ul>
          </section>
        )}
        {!out.length && !into.length && <p className="mt-5 text-sm text-faint">No links to or from other sources yet.</p>}
        <Link href={`/library/${s.id}`} className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent-text underline underline-offset-2">
          Open source
        </Link>
      </>
    );
  } else {
    const g = lookup.group.get(selected.id);
    if (!g) return null;
    const crossings = graph.crossover.pairs
      .filter((p) => p.a === g.id || p.b === g.id)
      .map((p) => ({ other: p.a === g.id ? p.b : p.a, p }));
    body = (
      <>
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
          <span className="size-2.5 rounded-full" style={{ background: g.colour }} aria-hidden="true" />
          Reading group
        </p>
        <h2 className="mt-1 font-serif text-xl leading-snug">{g.title}</h2>
        <p className="mt-1 text-sm text-muted">
          {g.sources.length} source{g.sources.length === 1 ? "" : "s"}
        </p>
        {g.overviewPreview && <p className="mt-4 text-sm leading-relaxed text-ink">{g.overviewPreview}</p>}
        <section className="mt-5">
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Crosses over with</h3>
          {crossings.length ? (
            <ul className="space-y-1">
              {crossings.map(({ other, p }) => (
                <li key={other} className="flex items-center justify-between gap-2">
                  {chip(other)}
                  <span className="text-xs text-muted">
                    {p.shared.length} shared · {p.bridges.length} bridge{p.bridges.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-faint">No shared sources or bridge links yet.</p>
          )}
        </section>
        <Link href={`/groups/${g.id}`} className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent-text underline underline-offset-2">
          Open group
        </Link>
      </>
    );
  }

  return (
    <aside
      aria-label="Details"
      className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto border-t border-rule bg-surface p-5 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] md:static md:max-h-none md:w-80 md:shrink-0 md:border-l md:border-t-0 md:shadow-none"
    >
      <button type="button" onClick={onClose} aria-label="Close details" className="float-right -mr-2 -mt-2 rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-ink">
        <X size={16} aria-hidden="true" />
      </button>
      {body}
    </aside>
  );
}
