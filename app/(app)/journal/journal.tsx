"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EntryDto, JournalPage } from "@/lib/dto";
import { formatDayHeading, londonDateKey } from "@/lib/time";
import { jsonFetch } from "@/lib/upload-client";
import { Composer, type ComposerHandle } from "./composer";
import { EntryItem } from "./entry-item";

/**
 * The journal timeline: oldest at the top, newest at the bottom.
 *
 * The scroll container uses `flex-direction: column-reverse` around a single
 * content wrapper. Browsers then start it scrolled to the bottom on first
 * paint (no JavaScript, so no visible jump), measure scrollTop from the
 * bottom, and keep the visible entries still when older ones are inserted
 * above.
 */
export function Journal({ initial }: { initial: JournalPage }) {
  const [entries, setEntries] = useState(initial.entries);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const pendingScroll = useRef<{ kind: "bottom" } | { kind: "entry"; id: string } | null>(null);
  const dragDepth = useRef(0);

  useVisualViewportHeight();

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !entries.length) return;
    setLoadingOlder(true);
    try {
      const page = await jsonFetch<JournalPage>(`/api/journal?before=${encodeURIComponent(entries[0].id)}&limit=50`);
      setEntries((current) => {
        const known = new Set(current.map((e) => e.id));
        return [...page.entries.filter((e) => !known.has(e.id)), ...current];
      });
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load older entries.");
    } finally {
      setLoadingOlder(false);
    }
  }, [entries, hasMore, loadingOlder]);

  // Load the previous batch when the top of the list comes near.
  useEffect(() => {
    const root = scroller.current;
    const target = sentinel.current;
    if (!root || !target || !hasMore) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) void loadOlder();
      },
      { root, rootMargin: "800px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadOlder]);

  useLayoutEffect(() => {
    const target = pendingScroll.current;
    const el = scroller.current;
    if (!target || !el) return;
    pendingScroll.current = null;
    if (target.kind === "bottom") {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.getElementById(`entry-${target.id}`)?.scrollIntoView({ block: "start" });
    }
  }, [entries]);

  function onScroll() {
    const el = scroller.current;
    if (el) setAwayFromBottom(-el.scrollTop > 400);
  }

  function scrollToLatest() {
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function jumpToDate(day: string) {
    if (!day) return;
    setError(null);
    try {
      const page = await jsonFetch<JournalPage>(`/api/journal?from=${day}`);
      if (!page.entries.length) {
        setError("There are no entries yet.");
        return;
      }
      pendingScroll.current = page.targetId ? { kind: "entry", id: page.targetId } : null;
      setEntries(page.entries);
      setHasMore(page.hasMore);
      if (page.targetId) {
        setHighlight(page.targetId);
        setTimeout(() => setHighlight(null), 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't jump to that date.");
    }
  }

  const onUpdated = useCallback((updated: EntryDto) => {
    setEntries((list) => list.map((e) => (e.id === updated.id ? updated : e)));
  }, []);
  const onDeleted = useCallback((id: string) => {
    setEntries((list) => list.filter((e) => e.id !== id));
  }, []);

  return (
    <div
      className="relative flex flex-col"
      style={{ height: "calc(var(--app-height, 100dvh) - var(--header-height))" }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composer.current?.addFiles(e.dataTransfer.files);
      }}
    >
      <JumpToDate onJump={jumpToDate} />

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain [overflow-anchor:none]"
        aria-label="Journal entries"
      >
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <div ref={sentinel} />
          {hasMore ? (
            <p className="py-4 text-center text-xs text-faint">{loadingOlder ? "Loading earlier entries…" : " "}</p>
          ) : entries.length > 0 ? (
            <p className="py-4 text-center text-xs text-faint">The beginning of your journal</p>
          ) : null}

          {entries.length === 0 && !hasMore && (
            <div className="py-24 text-center">
              <p className="font-serif text-xl">Nothing here yet.</p>
              <p className="mt-2 text-sm text-muted">Write your first note below. Paste or drop images and files to attach them.</p>
            </div>
          )}

          {groupByDay(entries).map(({ day, items }) => (
            // One section per day so each sticky heading scrolls away with its day.
            <section key={day} aria-label={formatDayHeading(items[0].created)}>
              <h2 className="sticky top-0 z-10 -mx-4 bg-paper px-4 pb-2 pt-5 text-center text-xs font-medium tracking-wide text-muted">
                {formatDayHeading(items[0].created)}
              </h2>
              {items.map((entry) => (
                <div
                  key={entry.id}
                  className={`-mx-3 rounded-lg px-3 transition-colors duration-700 ${highlight === entry.id ? "bg-accent-soft" : ""}`}
                >
                  <EntryItem entry={entry} onUpdated={onUpdated} onDeleted={onDeleted} />
                </div>
              ))}
            </section>
          ))}
          {error && (
            <p role="alert" className="mt-4 text-center text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      {awayFromBottom && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-rule bg-surface px-3.5 py-1.5 text-xs text-ink shadow-md shadow-black/5"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          ↓ Jump to latest
        </button>
      )}

      <Composer
        ref={composer}
        onPosted={(entry) => {
          pendingScroll.current = { kind: "bottom" };
          setEntries((list) => [...list.filter((e) => e.id !== entry.id), entry]);
        }}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-paper/80 text-sm text-ink">
          Drop files to attach them to a new entry
        </div>
      )}
    </div>
  );
}

function JumpToDate({ onJump }: { onJump: (day: string) => void }) {
  return (
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-3xl justify-end px-4 py-1.5">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span>Jump to</span>
          <input
            type="date"
            aria-label="Jump to date"
            onChange={(e) => onJump(e.target.value)}
            className="rounded bg-transparent px-1.5 py-0.5 text-ink transition-colors hover:bg-accent-soft focus:bg-accent-soft focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

function groupByDay(entries: EntryDto[]): { day: string; items: EntryDto[] }[] {
  const groups: { day: string; items: EntryDto[] }[] = [];
  for (const entry of entries) {
    const day = londonDateKey(entry.created);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }
  return groups;
}

/**
 * Track the visual viewport so the composer stays above the on-screen
 * keyboard in mobile Safari (which doesn't resize the layout viewport).
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--app-height", `${vv.height}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      root.style.removeProperty("--app-height");
    };
  }, []);
}
