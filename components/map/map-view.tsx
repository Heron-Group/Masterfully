"use client";

import type { Core, EventObject, NodeSingular } from "cytoscape";
import { Download, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pinMapNodes, resetMapLayout, saveMapView } from "@/app/(app)/map/actions";
import { EmptyState } from "@/components/empty-state";
import { UNGROUPED_COLOUR } from "@/lib/map/colours";
import type { MapResponse } from "@/lib/map/server";
import { Legend, MapSearch } from "./controls";
import {
  crossoverEdgeId,
  focusSet,
  groupElements,
  groupNodeId,
  LARGE_MAP,
  layoutFor,
  linkEdgeId,
  mapStyle,
  networkElements,
  sourceNodeId,
  themeTokens,
  withSeed,
  type MapViewName,
  type Pins,
} from "./elements";
import { download, mapToPng, mapToSvg, type ExportInfo } from "./export";
import type { LayoutRequest, LayoutResult } from "./layout.worker";
import { SidePanel, type Lookup, type Selected } from "./panels";

type Mode = "crossover" | "gaps" | null;
/** Focus mode: only this node (a Cytoscape id) and its neighbours, 1 or 2 steps away. */
type Focus = { id: string; steps: 1 | 2 } | null;
type Tooltip = { x: number; y: number; title: string; lines: string[] } | null;

const VIEW_NAMES: Record<MapViewName, string> = { network: "Source network", groups: "Group overview" };
const PIN_SAVE_DELAY = 400;
const LAYOUT_SEED = 7;
const CACHE_PREFIX = "masterfully:map-layout:";

/** A small map shouldn't be blown up to fill the screen. */
function fitSmall(c: Core) {
  c.fit(undefined, 40);
  if (c.zoom() > 1.2) {
    c.zoom(1.2);
    c.center();
  }
}

/** What a layout depends on: the nodes, edges and pins (FNV-1a hash). */
function layoutSignature(view: MapViewName, c: Core, viewPins: Pins): string {
  const text = [view, ...c.elements().map((e) => e.id()).sort(), JSON.stringify(viewPins)].join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** The last full layout for this view, if it was for the same map. Browser storage may be unavailable. */
function readCachedLayout(view: MapViewName, key: string, ids: Set<string>): Pins | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_PREFIX + view) ?? "null") as { key: string; positions: Pins } | null;
    if (saved?.key !== key || ![...ids].every((id) => saved.positions[id])) return null;
    return saved.positions;
  } catch {
    return null;
  }
}

function writeCachedLayout(view: MapViewName, key: string, positions: Pins) {
  try {
    localStorage.setItem(CACHE_PREFIX + view, JSON.stringify({ key, positions }));
  } catch {
    // Storage full or blocked: the layout is just worked out again next time.
  }
}

let registered = false;

/**
 * The Source Map: the source network and the group overview, with Crossover
 * and Gaps modes, a summary bar, search, the legend as a filter, focus mode,
 * pinned layouts and export. Everything comes from /api/map; the only thing
 * saved from here is the map's own layout (map-layout.json).
 */
export function MapView() {
  const [graph, setGraph] = useState<MapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<MapViewName>("network");
  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showUngrouped, setShowUngrouped] = useState(true);
  const [focus, setFocus] = useState<Focus>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [cy, setCy] = useState<Core | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  const [pinCount, setPinCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pins = useRef<Record<MapViewName, Pins>>({ network: {}, groups: {} });
  /** Something to do once the next map has been drawn (after switching view). */
  const pending = useRef<((cy: Core) => void) | null>(null);
  const wasFocused = useRef(false);

  const [showArchived, setShowArchived] = useState(false);
  const firstLoad = useRef(true);

  // Archived sources and groups are left out unless asked for (a fresh graph, so the figures match).
  useEffect(() => {
    fetch(`/api/map${showArchived ? "?archived=1" : ""}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't load the map.");
        return r.json() as Promise<MapResponse>;
      })
      .then((data) => {
        pins.current = { network: data.pins.network ?? {}, groups: data.pins.groups ?? {} };
        if (firstLoad.current) setView(data.lastView);
        firstLoad.current = false;
        setGraph(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load the map."));
  }, [showArchived]);

  const lookup = useMemo<Lookup | null>(() => {
    if (!graph) return null;
    return { source: new Map(graph.sources.map((s) => [s.id, s])), group: new Map(graph.groups.map((g) => [g.id, g])) };
  }, [graph]);

  // Draw the current view (again when the view changes or the layout is reset).
  useEffect(() => {
    if (!graph || !container.current || !graph.sources.length) return;
    let instance: Core | null = null;
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let resizer: ResizeObserver | null = null;
    let worker: Worker | null = null;
    let queue: Pins = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flushPins = () => {
      clearTimeout(timer);
      if (!Object.keys(queue).length) return;
      const batch = queue;
      queue = {};
      void pinMapNodes(view, batch).then((r) => {
        if (!r.ok) setNotice(r.error);
      });
    };

    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const fcose = (await import("cytoscape-fcose")).default;
      if (!registered) {
        cytoscape.use(fcose);
        registered = true;
      }
      if (cancelled || !container.current) return;
      const big = graph.sources.length > 300 || graph.links.length > 1200;
      const elements = view === "groups" ? groupElements(graph) : networkElements(graph);
      const c = cytoscape({
        container: container.current,
        elements,
        style: mapStyle(themeTokens()),
        minZoom: 0.05,
        maxZoom: 4,
        // Smooth panning on large maps: draw a snapshot while moving.
        textureOnViewport: big,
        hideEdgesOnViewport: big,
        boxSelectionEnabled: false,
      });
      instance = c;
      const viewPins = pins.current[view];
      const ids = new Set(c.nodes().map((n) => n.id()));
      // Large maps: a fast first pass now, the full layout in a worker, and
      // the result kept in this browser so it's instant next time.
      const large = ids.size > LARGE_MAP;
      const key = large ? layoutSignature(view, c, viewPins) : "";
      const cached = large ? readCachedLayout(view, key, ids) : null;
      const started = performance.now();
      if (cached) c.layout({ name: "preset", positions: (n: NodeSingular) => cached[n.id()], fit: true, padding: 40 } as never).run();
      // Seeded, so the same data and pins give the same picture every time.
      else withSeed(LAYOUT_SEED, () => c.layout(layoutFor(view, viewPins, ids, large ? "draft" : "default") as never).run());
      fitSmall(c);
      const box = container.current;
      box.dataset.layoutMs = String(Math.round(performance.now() - started));
      box.dataset.layoutDone = String(!large || !!cached);
      let touched = false;
      const touch = () => (touched = true);
      box.addEventListener("pointerdown", touch);
      box.addEventListener("wheel", touch, { passive: true });
      const draggedNow = new Set<string>();
      if (large && !cached) {
        worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<LayoutResult>) => {
          worker?.terminate();
          worker = null;
          if (cancelled || c.destroyed()) return;
          writeCachedLayout(view, key, e.data.positions);
          c.layout({
            name: "preset",
            // Anything dragged in the meantime stays where it was put.
            positions: (n: NodeSingular) => (draggedNow.has(n.id()) ? n.position() : (e.data.positions[n.id()] ?? n.position())),
            animate: true,
            animationDuration: 600,
            fit: !touched,
            padding: 40,
            stop: () => (box.dataset.layoutDone = "true"),
          } as never).run();
        };
        worker.postMessage({ elements, view, pins: viewPins, seed: LAYOUT_SEED } satisfies LayoutRequest);
      }

      const lightUp = (node: NodeSingular) =>
        c.batch(() => {
          c.elements().addClass("faded");
          const near = node.closedNeighborhood();
          near.removeClass("faded").addClass("near");
          near.edges(".link").addClass("lit");
        });
      const clear = () => c.batch(() => c.elements().removeClass("faded lit near"));
      const place = (e: EventObject) => {
        const box = container.current!.getBoundingClientRect();
        const p = e.renderedPosition ?? { x: 0, y: 0 };
        return { x: box.left + p.x, y: box.top + p.y };
      };
      const title = (id: string) => lookup?.source.get(id)?.shortTitle ?? id;
      const groupTitle = (id: string) => lookup?.group.get(id)?.title ?? id;

      c.on("mouseover", "node", (e) => {
        const n = e.target as NodeSingular;
        lightUp(n);
        if (n.data("kind") === "group") {
          const g = lookup?.group.get(n.data("ref"));
          const crossings = graph.crossover.pairs.filter((p) => p.a === g?.id || p.b === g?.id).length;
          const lines = [`${g?.sources.length ?? 0} sources`];
          if (view === "groups") lines.push(crossings ? `Crosses over with ${crossings} group${crossings === 1 ? "" : "s"}` : "No crossover yet");
          setTooltip({ ...place(e), title: n.data("label"), lines });
        } else setTooltip({ ...place(e), title: n.data("title"), lines: [] });
      });
      c.on("mouseout", "node", () => {
        clear();
        setTooltip(null);
      });
      c.on("mouseover", "edge.link", (e) => {
        const l = graph.links.find((x) => x.from === e.target.data("from") && x.to === e.target.data("to"));
        if (!l) return;
        setTooltip({
          ...place(e),
          title: `${title(l.from)} → ${title(l.to)}`,
          lines: [...l.labels.map((x) => `“${x}”`), ...(l.count > 1 ? [`${l.count} links`] : [])],
        });
      });
      c.on("mouseover", "edge.crossover", (e) => {
        const p = graph.crossover.pairs.find((x) => x.a === e.target.data("a") && x.b === e.target.data("b"));
        if (!p) return;
        setTooltip({
          ...place(e),
          title: `${groupTitle(p.a)} ↔ ${groupTitle(p.b)}`,
          lines: [`${p.shared.length} shared · ${p.bridges.length} bridge link${p.bridges.length === 1 ? "" : "s"}`, "Click for the list"],
        });
      });
      c.on("mouseout", "edge", () => setTooltip(null));
      c.on("tap", "node", (e) => setSelected({ kind: e.target.data("kind"), id: e.target.data("ref") }));
      c.on("tap", "edge.link", (e) => setSelected({ kind: "link", from: e.target.data("from"), to: e.target.data("to") }));
      c.on("tap", "edge.crossover", (e) => setSelected({ kind: "pair", a: e.target.data("a"), b: e.target.data("b") }));
      c.on("tap", (e) => {
        if (e.target === c) setSelected(null);
      });
      c.on("dbltap", "node", (e) => {
        const id = e.target.id();
        setFocus({ id, steps: 1 });
        if (view === "groups") {
          // Open the source network focused on this group and its neighbours.
          setView("network");
          void saveMapView("network");
        }
      });
      c.on("viewport", () => setTooltip(null));
      // Dragged nodes stay where they're put, in this view.
      c.on("dragfree", "node", (e) => {
        const p = e.target.position();
        const at = { x: p.x, y: p.y };
        pins.current[view] = { ...pins.current[view], [e.target.id()]: at };
        queue[e.target.id()] = at;
        draggedNow.add(e.target.id());
        setPinCount(Object.keys(pins.current[view]).length);
        clearTimeout(timer);
        timer = setTimeout(flushPins, PIN_SAVE_DELAY);
      });

      // Follow the light/dark theme.
      observer = new MutationObserver(() => c.style(mapStyle(themeTokens())));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      // Keep the picture centred when the side panel opens or closes.
      let size = { w: c.width(), h: c.height() };
      resizer = new ResizeObserver(() => {
        c.resize();
        const now = { w: c.width(), h: c.height() };
        c.panBy({ x: (now.w - size.w) / 2, y: (now.h - size.h) / 2 });
        size = now;
      });
      resizer.observe(container.current);

      setPinCount(Object.keys(viewPins).filter((id) => c.$id(id).length).length);
      setCy(c);
      const next = pending.current;
      pending.current = null;
      next?.(c);
    })();
    return () => {
      cancelled = true;
      flushPins();
      observer?.disconnect();
      resizer?.disconnect();
      worker?.terminate();
      instance?.destroy();
      setCy(null);
    };
  }, [graph, view, layoutKey, lookup]);

  const live = cy && !cy.destroyed() ? cy : null;

  // Filters: a source stays visible if any of its groups is shown.
  useEffect(() => {
    if (!live || live.destroyed() || !graph) return;
    live.batch(() => {
      for (const g of graph.groups) live.$id(groupNodeId(g.id)).toggleClass("hidden", hidden.has(g.id));
      for (const s of graph.sources) {
        const show = s.groups.length ? s.groups.some((g) => !hidden.has(g)) : showUngrouped;
        live.$id(sourceNodeId(s.id)).toggleClass("hidden", !show);
      }
    });
  }, [live, graph, hidden, showUngrouped]);

  // Crossover and Gaps modes.
  useEffect(() => {
    if (!live || live.destroyed()) return;
    live.batch(() => {
      live.elements().removeClass("dim xhl gap");
      if (mode === "crossover") {
        live.elements().addClass("dim");
        const bridges = live.edges(".bridge");
        const lines = live.edges(".crossover");
        live.nodes(".multi").union(bridges).union(lines).removeClass("dim").addClass("xhl");
        bridges.connectedNodes().union(lines.connectedNodes()).removeClass("dim");
      } else if (mode === "gaps") {
        live.elements().addClass("dim");
        live.nodes(view === "groups" ? ".has-gaps" : ".isolated, .unlinked").removeClass("dim").addClass("gap");
      }
    });
  }, [live, mode, view]);

  // Focus mode (source network only).
  useEffect(() => {
    if (!live || live.destroyed()) return;
    live.batch(() => live.elements().removeClass("unfocused"));
    if (!focus || view !== "network" || !live.$id(focus.id).length) {
      if (wasFocused.current) live.animate({ fit: { eles: live.elements(":visible"), padding: 40 } }, { duration: 300 });
      wasFocused.current = false;
      return;
    }
    const shown = focusSet(live, focus.id, focus.steps);
    live.batch(() => {
      live.elements().addClass("unfocused");
      shown.removeClass("unfocused");
      shown.edgesWith(shown).removeClass("unfocused");
    });
    wasFocused.current = true;
    live.animate({ fit: { eles: shown, padding: 60 } }, { duration: 300 });
  }, [live, focus, view]);

  // Keep the map's selection in step with the side panel.
  useEffect(() => {
    if (!live || live.destroyed()) return;
    live.$(":selected").unselect();
    if (!selected) return;
    const id =
      selected.kind === "source"
        ? sourceNodeId(selected.id)
        : selected.kind === "group"
          ? groupNodeId(selected.id)
          : selected.kind === "pair"
            ? crossoverEdgeId(selected.a, selected.b)
            : linkEdgeId(selected.from, selected.to);
    live.$id(id).select();
  }, [live, selected]);

  // Escape leaves focus mode, then closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
      if (focus) setFocus(null);
      else if (selected) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, selected]);

  function changeView(next: MapViewName) {
    if (next === view) return;
    setTooltip(null);
    if (next === "groups") setFocus(null);
    if (selected?.kind === "source" || selected?.kind === "link") setSelected(null);
    setView(next);
    void saveMapView(next);
  }

  /** Bring a node into view and highlight it, showing it again if a filter or focus hid it. */
  function zoomTo(c: Core, kind: "source" | "group", id: string) {
    const node = c.$id(kind === "source" ? sourceNodeId(id) : groupNodeId(id));
    if (!node.length) return;
    if (node.hasClass("hidden")) {
      if (kind === "group") setHidden((h) => new Set([...h].filter((g) => g !== id)));
      else {
        const s = lookup?.source.get(id);
        if (s?.groups.length) setHidden((h) => new Set([...h].filter((g) => !s.groups.includes(g))));
        else setShowUngrouped(true);
      }
    }
    if (node.hasClass("unfocused")) setFocus(null);
    c.animate({ fit: { eles: node.closedNeighborhood(), padding: 90 } }, { duration: 350 });
    node.addClass("found");
    setTimeout(() => node.removeClass("found"), 1600);
  }

  /** Select something and bring it into view (from search or the side panel). */
  function focusOn(kind: "source" | "group", id: string) {
    setSelected({ kind, id });
    if (kind === "source" && view === "groups") {
      // Sources are only in the network.
      pending.current = (c) => zoomTo(c, kind, id);
      changeView("network");
      return;
    }
    if (live) zoomTo(live, kind, id);
  }

  async function resetLayout() {
    const result = await resetMapLayout(view);
    if (!result.ok) return setNotice(result.error);
    pins.current[view] = {};
    setLayoutKey((k) => k + 1);
  }

  async function exportAs(format: "svg" | "png") {
    if (!live || !graph || !lookup) return;
    live.elements().removeClass("faded lit near");
    setTooltip(null);
    const date = new Date();
    const extras = [
      mode === "crossover" ? "Crossover mode" : mode === "gaps" ? "Gaps mode" : "",
      focus && view === "network" ? `Focused on ${live.$id(focus.id).data("title") ?? live.$id(focus.id).data("label")}` : "",
    ].filter(Boolean);
    const legend = graph.groups.filter((g) => !hidden.has(g.id)).map((g) => ({ colour: g.colour, label: g.title }));
    if (view === "network" && showUngrouped && graph.sources.some((s) => !s.groups.length)) legend.push({ colour: UNGROUPED_COLOUR, label: "Not in a group" });
    const info: ExportInfo = {
      title: `Source map · ${VIEW_NAMES[view]}`,
      subtitle: [date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), ...extras].join(" · "),
      legend,
      theme: themeTokens(),
    };
    const name = `source-map-${view === "groups" ? "groups" : "network"}-${date.toISOString().slice(0, 10)}`;
    try {
      if (format === "svg") download(new Blob([mapToSvg(live, info)], { type: "image/svg+xml" }), `${name}.svg`);
      else download(await mapToPng(live, info), `${name}.png`);
    } catch (err) {
      console.error(err);
      setNotice("Couldn't export the map.");
    }
  }

  if (error) {
    return (
      <p role="alert" className="p-8 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (graph && !graph.sources.length) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState label="Your map is empty. Add sources to see how they connect." />
        {!showArchived && (
          <button type="button" onClick={() => setShowArchived(true)} className={toolButton}>
            Show archived sources
          </button>
        )}
      </div>
    );
  }

  const focusTitle = focus && live ? (live.$id(focus.id).data("title") ?? live.$id(focus.id).data("label")) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2.5 md:px-6">
        <h1 className="mr-auto font-serif text-2xl tracking-tight">Source map</h1>
        {graph && <MapSearch graph={graph} onPick={focusOn} />}
        <div className="flex w-full flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex rounded-md bg-accent-soft/60 p-0.5 text-[13px]">
            {(["network", "groups"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-label={VIEW_NAMES[v]}
                onClick={() => changeView(v)}
                className={`rounded px-2.5 py-1 ${view === v ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                <span className="sm:hidden">{v === "network" ? "Network" : "Groups"}</span>
                <span className="hidden sm:inline">{VIEW_NAMES[v]}</span>
              </button>
            ))}
          </div>
          <Toggle pressed={mode === "crossover"} onClick={() => setMode((m) => (m === "crossover" ? null : "crossover"))}>
            Crossover
          </Toggle>
          <Toggle pressed={mode === "gaps"} onClick={() => setMode((m) => (m === "gaps" ? null : "gaps"))}>
            Gaps
          </Toggle>
          <Toggle pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            Show archived
          </Toggle>
          <span className="ml-auto flex items-center gap-1">
            {pinCount > 0 && (
              <button type="button" onClick={resetLayout} className={toolButton} aria-label="Reset layout" title="Forget where nodes were dragged to in this view">
                <RotateCcw size={14} aria-hidden="true" />
                <span className="hidden sm:inline">Reset layout</span>
              </button>
            )}
            <ExportMenu disabled={!live} onExport={exportAs} />
          </span>
        </div>
      </div>
      {graph && <SummaryBar stats={graph.stats} />}
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div ref={container} className="h-full w-full" aria-label={VIEW_NAMES[view]} role="img" data-testid="map-canvas" data-view={view} />
          {!graph && <p className="absolute inset-0 flex items-center justify-center text-sm text-faint">Drawing your map…</p>}
          {graph && view === "groups" && !graph.groups.length && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-faint">No reading groups yet.</p>
          )}
          {focus && view === "network" && focusTitle && (
            <div className="absolute inset-x-3 top-3 z-10 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-lg bg-surface/95 px-3 py-1.5 text-[13px] shadow-sm ring-1 ring-rule backdrop-blur">
              <span className="min-w-0 truncate">
                Focused on <strong className="font-medium">{focusTitle}</strong>
              </span>
              <div role="group" aria-label="Steps" className="flex rounded bg-accent-soft/60 p-0.5">
                {([1, 2] as const).map((steps) => (
                  <button
                    key={steps}
                    type="button"
                    aria-pressed={focus.steps === steps}
                    onClick={() => setFocus({ ...focus, steps })}
                    className={`rounded px-2 py-0.5 ${focus.steps === steps ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {steps} step{steps === 2 ? "s" : ""}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setFocus(null)} className="text-muted underline underline-offset-2 hover:text-ink">
                Show all <span className="hidden text-faint md:inline">(Esc)</span>
              </button>
            </div>
          )}
          {graph && (
            <Legend
              graph={graph}
              hidden={hidden}
              showUngrouped={showUngrouped}
              ungroupedRow={view === "network"}
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
          {notice && (
            <p role="alert" className="absolute bottom-3 right-3 z-10 rounded-md bg-surface px-3 py-2 text-sm text-danger shadow-sm ring-1 ring-rule">
              {notice}
            </p>
          )}
        </div>
        {graph && lookup && (
          <SidePanel
            graph={graph}
            lookup={lookup}
            selected={selected}
            mode={mode}
            onClose={() => (selected ? setSelected(null) : setMode(null))}
            onPick={focusOn}
            onSelect={setSelected}
          />
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

const toolButton = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] text-muted hover:bg-accent-soft/60 hover:text-ink";

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[13px] ring-1 ${pressed ? "bg-accent text-white ring-accent" : "text-muted ring-rule hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/** Totals: sources, links, groups, shared sources, bridge links and isolated sources. */
function SummaryBar({ stats }: { stats: MapResponse["stats"] }) {
  const items: Array<[string, number]> = [
    ["Sources", stats.sources],
    ["Links", stats.links],
    ["Groups", stats.groups],
    ["Shared sources", stats.shared],
    ["Bridge links", stats.bridges],
    ["Isolated", stats.isolated],
  ];
  return (
    <dl aria-label="Summary" className="flex gap-x-5 overflow-x-auto whitespace-nowrap border-b border-rule px-4 py-1.5 text-xs md:px-6">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted">{label}</dt>
          <dd className="font-medium tabular-nums text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (format: "svg" | "png") => void }) {
  const [open, setOpen] = useState(false);
  const item = "block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft/80";
  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export"
        onClick={() => setOpen((o) => !o)}
        className={`${toolButton} disabled:opacity-50`}
      >
        <Download size={14} aria-hidden="true" />
        <span className="hidden sm:inline">Export</span>
      </button>
      {open && (
        <div role="menu" aria-label="Export" className="absolute right-0 top-full z-30 mt-1 w-60 rounded-lg bg-surface p-1 text-[13px] shadow-lg shadow-black/10 ring-1 ring-rule">
          {(
            [
              ["svg", "SVG", "Editable text, for Illustrator"],
              ["png", "PNG", "Image at twice screen size"],
            ] as const
          ).map(([format, label, hint]) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onExport(format);
              }}
            >
              <span className="block text-ink">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
