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
import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { Markdown } from "@/components/markdown";
import { AutoTextarea } from "@/components/auto-textarea";
import { ui } from "@/components/ui";
import { formatAuthors, type GroupDto, type GroupSourceDto } from "@/lib/dto";
import { addSourcesToGroup, removeSourceFromGroup, reorderGroupSources, saveGroupSourceNote } from "../actions";
import { fold } from "../../library/library-view";
import { changed } from "./group-view";

export type LibraryItem = { id: string; title: string; authors: string[]; year?: number };

export function GroupSources({ group, library }: { group: GroupDto; library: LibraryItem[] }) {
  // Local copy for instant reordering; reset whenever the server sends new data.
  const [items, setItems] = useState(group.sources);
  const [prev, setPrev] = useState(group.sources);
  if (prev !== group.sources) {
    setPrev(group.sources);
    setItems(group.sources);
  }
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A stable id keeps dnd-kit's accessibility ids the same on server and client.
  const dndId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const before = items;
    const next = arrayMove(items, items.findIndex((i) => i.id === active.id), items.findIndex((i) => i.id === over.id));
    setItems(next);
    const r = await reorderGroupSources(group.id, next.map(({ id, note }) => ({ id, note })));
    if (r.ok) {
      setError(null);
      changed();
    } else {
      setItems(before);
      setError(r.error);
    }
  }

  return (
    <section aria-labelledby="sources-heading">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h2 id="sources-heading" className={ui.h2}>
          Sources <span className="tabular-nums">({items.length})</span>
        </h2>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setPicking((p) => !p)} aria-expanded={picking} className={ui.btnSecondary}>
            Add from library
          </button>
          <Link href={`/library/new?group=${encodeURIComponent(group.id)}`} className={ui.btnSecondary}>
            New source
          </Link>
        </div>
      </div>

      {picking && (
        <SourcePicker
          groupId={group.id}
          library={library.filter((s) => !items.some((i) => i.id === s.id))}
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
                <SortableSource key={item.id} groupId={group.id} item={item} index={index} />
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

function SortableSource({ groupId, item, index }: { groupId: string; item: GroupSourceDto; index: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(item.note);
  const [savedNote, setSavedNote] = useState(item.note);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const s = item.source;

  async function saveNote() {
    if (note.trim() === savedNote.trim()) return;
    setNoteState("saving");
    const r = await saveGroupSourceNote(groupId, item.id, note);
    if (r.ok) {
      setSavedNote(note);
      setNoteState("saved");
      changed();
    } else {
      setNoteState("error");
      setError(r.error);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex gap-2 bg-paper py-4 ${isDragging ? "z-10 shadow-lg shadow-black/10" : ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${s?.title ?? item.id} (position ${index + 1})`}
        className="mt-0.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-faint hover:text-ink active:cursor-grabbing"
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

      <div className="min-w-0 flex-1">
        {s ? (
          <>
            <Link href={`/library/${s.id}`} className="font-serif text-[17px] leading-snug hover:underline hover:decoration-rule hover:underline-offset-4">
              {s.title}
            </Link>
            <p className="mt-0.5 text-sm text-muted">
              {[formatAuthors(s.authors), s.year].filter(Boolean).join(" · ")}
            </p>
          </>
        ) : (
          <p className="text-sm text-warn">
            Missing source <code>{item.id}</code> — its file was removed outside the app.
          </p>
        )}

        <div className="mt-2">
          <AutoTextarea
            value={note}
            onChange={(v) => {
              setNote(v);
              setNoteState("idle");
            }}
            onBlur={() => void saveNote()}
            onSubmit={() => void saveNote()}
            placeholder="Why this source matters to this group…"
            aria-label={`Group note for ${s?.title ?? item.id}`}
            className="block w-full resize-none rounded border border-transparent bg-transparent px-2 py-1 -mx-2 text-[15px] italic text-ink placeholder:text-faint hover:border-rule focus:border-accent focus:bg-surface focus:not-italic focus:outline-none"
          />
          <span className="text-xs text-faint">
            {noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : ""}
          </span>
        </div>

        {s && (
          <div className="mt-1">
            <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="text-xs text-muted hover:text-ink">
              {expanded ? "Hide my notes" : "Show my notes"}
            </button>
            {expanded && (
              <div className="mt-2 border-l-2 border-rule pl-4">
                {s.notes ? <Markdown className="text-[16px]">{s.notes}</Markdown> : <p className="text-sm text-faint">No notes on this source yet.</p>}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
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
        className="h-7 shrink-0 rounded px-2 text-muted hover:text-danger"
      >
        ×
      </button>
    </li>
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
