"use client";

import { BookOpen, ChevronDown, Search, SquareStack } from "lucide-react";
import { useMemo, useState } from "react";
import { formatAuthors } from "@/lib/dto";
import { UNGROUPED_COLOUR } from "@/lib/map/colours";
import type { MapGraph } from "@/lib/map/graph";

// The map's search box and its legend (which is also the group filter).

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Find a source or group by name and zoom to it. */
export function MapSearch({ graph, onPick }: { graph: MapGraph; onPick: (kind: "source" | "group", id: string) => void }) {
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
export function Legend({
  graph,
  hidden,
  showUngrouped,
  ungroupedRow,
  onToggle,
  onToggleUngrouped,
}: {
  graph: MapGraph;
  hidden: Set<string>;
  showUngrouped: boolean;
  /** The group overview has no ungrouped sources to show or hide. */
  ungroupedRow: boolean;
  onToggle: (id: string) => void;
  onToggleUngrouped: () => void;
}) {
  // Open on larger screens; folded away on phones, where room is short.
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const ungrouped = graph.sources.filter((s) => !s.groups.length).length;
  const row = "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent-soft/60";
  return (
    <div className="absolute bottom-3 left-3 z-10 max-h-[45%] w-60 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg bg-surface/95 p-1.5 text-[13px] shadow-sm ring-1 ring-rule backdrop-blur" role="group" aria-label="Reading groups">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium uppercase tracking-wider text-faint hover:text-ink"
      >
        Reading groups
        <ChevronDown size={13} className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      {open && (
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
          {ungroupedRow && (
            <li>
              <label className={`${row} cursor-pointer ${showUngrouped ? "" : "opacity-50"}`}>
                <input type="checkbox" checked={showUngrouped} onChange={onToggleUngrouped} className="accent-[var(--accent)]" />
                <span className="size-3 shrink-0 rounded-full" style={{ background: UNGROUPED_COLOUR }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Not in a group</span>
                <span className="tabular-nums text-faint">{ungrouped}</span>
              </label>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
