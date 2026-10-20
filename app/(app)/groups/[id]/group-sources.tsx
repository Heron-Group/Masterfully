"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, FilePlus2, Library } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ui } from "@/components/ui";
import { formatAuthors, type GroupDto, type GroupSourceDto } from "@/lib/dto";
import type { LinkCounts } from "@/lib/sources/links";
import { colourName, GROUP_PALETTE } from "@/lib/map/colours";
import { addSourcesToGroup, removeSourceFromGroup, reorderGroupSources, setGroupOrder, setGroupSourceColour } from "../actions";
import { fold, SourceRow } from "../../library/library-view";
import { changed } from "./group-view";

export type LibraryItem = { id: string; title: string; authors: string[]; year?: number; archived?: boolean };

type Order = GroupDto["order"];
const ORDER_LABELS: Record<Order, string> = { newest: "Newest first", oldest: "Oldest first", manual: "Your order" };

/** The sources in the chosen order: by year published (undated ones last, then by title), or as saved. */
function ordered(sources: GroupSourceDto[], order: Order): GroupSourceDto[] {
  if (order === "manual") return sources;
  const dir = order === "newest" ? -1 : 1;
  return [...sources].sort((a, b) => {
    const ya = a.source?.year;
    const yb = b.source?.year;
    if (ya !== yb) {
      if (ya === undefined) return 1;
      if (yb === undefined) return -1;
      return (ya - yb) * dir;
    }
    return (a.source?.title ?? a.id).localeCompare(b.source?.title ?? b.id);
  });
}

export function GroupSources({ group, library, linkCounts }: { group: GroupDto; library: LibraryItem[]; linkCounts: LinkCounts }) {
  // Local copy for instant reordering; reset whenever the server sends new data.
  const [order, setOrder] = useState<Order>(group.order);
  const [items, setItems] = useState(() => ordered(group.sources, group.order));
  const [prev, setPrev] = useState({ sources: group.sources, order: group.order });
  if (prev.sources !== group.sources || prev.order !== group.order) {
    setPrev({ sources: group.sources, order: group.order });
    setOrder(group.order);
    setItems(ordered(group.sources, group.order));
  }
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A stable id keeps dnd-kit's accessibility ids the same on server and client.
  const dndId = useId();

  async function chooseOrder(next: Order) {
    const before = { order, items };
    setOrder(next);
    // "Your order" shows the order saved by dragging.
    setItems(ordered(group.sources, next));
    const r = await setGroupOrder(group.id, next);
    if (r.ok) changed();
    else {
      setOrder(before.order);
      setItems(before.items);
      setError(r.error);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const before = { order, items };
    const next = arrayMove(items, items.findIndex((i) => i.id === active.id), items.findIndex((i) => i.id === over.id));
    // Dragging keeps the order you make (from whichever order was showing).
    setItems(next);
    setOrder("manual");
    const r = await reorderGroupSources(group.id, next.map(({ id, note }) => ({ id, note })));
    if (r.ok) {
      setError(null);
      changed();
    } else {
      setOrder(before.order);
      setItems(before.items);
      setError(r.error);
    }
  }

  return (
    <section aria-labelledby="sources-heading">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="sources-heading" className={ui.h2}>
          Sources <span className="tabular-nums">({items.length})</span>
        </h2>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          Order
          <select
            value={order}
            onChange={(e) => void chooseOrder(e.target.value as Order)}
            aria-label="Order sources"
            className="rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-[13px] text-ink focus:outline-none"
          >
            {(Object.keys(ORDER_LABELS) as Order[]).map((o) => (
              <option key={o} value={o}>
                {ORDER_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setPicking((p) => !p)} aria-expanded={picking} className={ui.btnAction}>
            <Library size={14} strokeWidth={1.7} aria-hidden="true" />
            Add from library
          </button>
          <Link href={`/library/new?group=${encodeURIComponent(group.id)}`} className={ui.btnAction}>
            <FilePlus2 size={14} strokeWidth={1.7} aria-hidden="true" />
            New source
          </Link>
        </div>
      </div>

      {picking && (
        <SourcePicker
          groupId={group.id}
          library={library.filter((s) => !s.archived && !items.some((i) => i.id === s.id))}
          onClose={() => setPicking(false)}
        />
      )}

      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}

      {items.length ? (
        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol className="divide-y divide-rule border-y border-rule">
              {items.map((item, index) => (
                <SortableSource key={item.id} groupId={group.id} item={item} index={index} links={linkCounts[item.id]} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-sm text-muted">No sources in this group yet.</p>
      )}
    </section>
  );
}

/** One source, shown as in the library, with a drag handle and colour, its AI overview, and remove. */
function SortableSource({ groupId, item, index, links }: { groupId: string; item: GroupSourceDto; index: number; links?: LinkCounts[string] }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [colour, setColour] = useState(item.colour);
  const [prevColour, setPrevColour] = useState(item.colour);
  if (prevColour !== item.colour) {
    setPrevColour(item.colour);
    setColour(item.colour);
  }
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const s = item.source;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, boxShadow: colour ? `inset 3px 0 0 ${colour}` : undefined }}
      className={`relative bg-paper pl-1 ${isDragging ? "z-10 shadow-lg shadow-black/10" : ""}`}
    >
      <div className="flex items-start gap-1">
        <div className="mt-4 flex shrink-0 flex-col items-center gap-1.5">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${s?.title ?? item.id} (position ${index + 1})`}
            className="flex h-7 w-6 cursor-grab touch-none items-center justify-center rounded text-faint hover:text-ink active:cursor-grabbing"
          >
            <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
              {[3, 8, 13].map((y) => (
                <g key={y} fill="currentColor">
                  <circle cx="2.5" cy={y} r="1.3" />
                  <circle cx="7.5" cy={y} r="1.3" />
                </g>
              ))}
            </svg>
          </button>
          <SourceColourPicker
            title={s?.title ?? item.id}
            colour={colour}
            onPick={async (hex) => {
              const before = colour;
              setColour(hex ?? undefined);
              const r = await setGroupSourceColour(groupId, item.id, hex);
              if (r.ok) changed();
              else setColour(before);
              return r;
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          {s ? (
            <SourceRow source={s} links={links} />
          ) : (
            <p className="py-3.5 text-sm text-warn">
              Missing source <code>{item.id}</code> — its file was removed outside the app.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await removeSourceFromGroup(groupId, item.id);
              if (r.ok) changed();
              else setError(r.error);
            })
          }
          aria-label={`Remove ${s?.title ?? item.id} from this group`}
          title="Remove from group (the source stays in your library)"
          className="mt-4 h-7 shrink-0 rounded px-2 text-muted hover:text-danger"
        >
          ×
        </button>
      </div>
      {s && (
        <div className="-mt-2 pb-3.5 pl-7 pr-9">
          {s.aiOverview ? (
            <p className="text-sm leading-relaxed text-muted" aria-label={`AI overview of ${s.title}`}>
              <span className="mr-1.5 rounded border border-accent/40 px-1 text-[10px] font-medium uppercase tracking-wide text-accent-text">AI</span>
              {s.aiOverview}
            </p>
          ) : (
            <p className="text-xs text-faint">
              No AI overview yet.{" "}
              <Link href={`/library/${s.id}`} className="underline underline-offset-2 hover:text-ink">
                Summarise this source
              </Link>{" "}
              to add one.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="pb-2 pl-7 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** A dot under the drag handle: the source's highlight colour in this group (or none). */
function SourceColourPicker({
  title,
  colour,
  onPick,
}: {
  title: string;
  colour?: string;
  onPick: (hex: string | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (hex: string | null) =>
    start(async () => {
      setError(null);
      const r = await onPick(hex);
      if (r.ok) setOpen(false);
      else setError(r.error ?? "Couldn't save the colour.");
    });
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Colour for ${title}: ${colour ? colourName(colour) : "none"}`}
        title="Colour code this source"
        className="flex size-6 items-center justify-center rounded hover:bg-accent-soft/70"
      >
        <span
          className={`size-3 rounded-full ${colour ? "ring-1 ring-black/10" : "border border-dashed border-faint"}`}
          style={colour ? { background: colour } : undefined}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div role="dialog" aria-label="Colour code" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg bg-surface p-2 shadow-lg shadow-black/10 ring-1 ring-rule">
          <div role="radiogroup" aria-label="Colour" className="grid grid-cols-5 gap-1.5">
            {GROUP_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={colour === c.hex}
                aria-label={c.name}
                title={c.name}
                disabled={pending}
                onClick={() => pick(c.hex)}
                className="flex aspect-square items-center justify-center rounded-md ring-1 ring-black/10 transition-transform hover:scale-105"
                style={{ background: c.hex }}
              >
                {colour === c.hex && <Check size={14} strokeWidth={2.5} className="text-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button type="button" disabled={pending || !colour} onClick={() => pick(null)} className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-accent-soft/70 hover:text-ink disabled:opacity-50">
            No colour
          </button>
          {error && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourcePicker({ groupId, library, onClose }: { groupId: string; library: LibraryItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return library.filter((s) => {
      const hay = fold(`${s.title} ${s.authors.join(" ")}`);
      return words.every((w) => hay.includes(w));
    });
  }, [library, query]);

  return (
    <div className={`${ui.card} mb-4 p-3`} role="dialog" aria-label="Add sources from the library">
      <div className="flex gap-2">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library"
          aria-label="Search your library"
          className={ui.input}
        />
        <button type="button" onClick={onClose} className={ui.btnGhost}>
          Done
        </button>
      </div>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {matches.map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-b border-rule py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif">{s.title}</p>
              <p className="truncate text-xs text-muted">{[formatAuthors(s.authors), s.year].filter(Boolean).join(" · ")}</p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await addSourcesToGroup(groupId, [s.id]);
                  if (r.ok) changed();
                  else setError(r.error);
                })
              }
              className={ui.btnSecondary}
            >
              Add
            </button>
          </li>
        ))}
        {!matches.length && (
          <li className="py-3 text-sm text-muted">{library.length ? "No matches." : "Every library source is already in this group."}</li>
        )}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
