"use client";

import {
  BookOpen,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Strikethrough,
  Bold,
  Italic,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatAuthors } from "@/lib/dto";
import type { SlashCommand } from "./slash";

/** Where to show a pop-up: under the cursor, or above it when there isn't room below. */
export type Anchor = { left: number; top: number; bottom: number };

function place(at: Anchor, height: number): CSSProperties {
  const left = Math.min(Math.max(at.left, 8), window.innerWidth - 300);
  return at.bottom + height + 8 > window.innerHeight
    ? { left, bottom: window.innerHeight - at.top + 4 }
    : { left, top: at.bottom + 4 };
}

/** Close a pop-up when the pointer goes down anywhere outside it. */
function useClickOutside(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [ref, onClose]);
}

const card = "fixed z-50 w-72 overflow-hidden rounded-lg bg-surface text-sm shadow-lg shadow-black/10 ring-1 ring-rule";

const ICONS: Record<string, LucideIcon> = {
  paragraph: Pilcrow,
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  inlinecode: Code,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  source: BookOpen,
  link: Link2,
  bullet: List,
  number: ListOrdered,
  todo: ListTodo,
  quote: Quote,
  divider: Minus,
  code: Code,
};

/**
 * The "/" menu. Keys typed in the editor are passed in
 * (↑ ↓ Enter Tab Escape) via `keysRef`, so typing carries on filtering the list.
 */
export function SlashMenu({
  at,
  commands,
  onPick,
  onClose,
  keysRef,
  label = "Insert",
}: {
  at: Anchor;
  commands: SlashCommand[];
  label?: string;
  onPick: (command: SlashCommand) => void;
  onClose: () => void;
  keysRef: RefObject<((key: string) => boolean) | null>;
}) {
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState(commands);
  if (prev !== commands) {
    setPrev(commands);
    setActive(0);
  }
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useClickOutside(box, onClose);

  useEffect(() => {
    keysRef.current = (key) => {
      if (key === "Escape") return onClose(), true;
      if (!commands.length) return false;
      if (key === "ArrowDown") setActive((i) => (i + 1) % commands.length);
      else if (key === "ArrowUp") setActive((i) => (i - 1 + commands.length) % commands.length);
      else if (key === "Enter" || key === "Tab") onPick(commands[Math.min(active, commands.length - 1)]);
      else return false;
      return true;
    };
    return () => {
      keysRef.current = null;
    };
  }, [keysRef, commands, active, onPick, onClose]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div ref={box} className={card} style={place(at, 320)} role="dialog" aria-label={label}>
      {commands.length ? (
        <ul ref={list} role="listbox" aria-label={label} className="max-h-80 overflow-y-auto p-1">
          {commands.map((c, i) => {
            const Icon = ICONS[c.id] ?? Plus;
            const heading = c.group && c.group !== commands[i - 1]?.group ? c.group : null;
            return (
              <li key={c.id} data-index={i} role="option" aria-selected={i === active}>
                {heading && (
                  <p aria-hidden="true" className={`px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint ${i ? "pt-2" : "pt-1"}`}>
                    {heading}
                  </p>
                )}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep the editor focused
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onPick(c)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${i === active ? "bg-accent-soft/80" : ""}`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface ring-1 ring-rule">
                    <Icon size={16} strokeWidth={1.7} aria-hidden="true" className={c.id === "source" ? "text-accent" : "text-muted"} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ink">{c.label}</span>
                    <span className="block truncate text-xs text-muted">{c.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 py-2.5 text-muted">No matches</p>
      )}
    </div>
  );
}

type SourceItem = { id: string; title: string; authors: string[]; year?: number };
export type LinkTarget = { href: string; title: string };

let sourcesCache: Promise<SourceItem[]> | null = null;
function loadSources(fresh = false): Promise<SourceItem[]> {
  if (!sourcesCache || fresh) {
    sourcesCache = fetch("/api/sources", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<SourceItem[]>) : []))
      .catch(() => []);
  }
  return sourcesCache;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isUrl = (s: string) => /^(https?:\/\/|www\.)\S+\.\S+/i.test(s.trim());

type Option =
  | { kind: "url"; url: string }
  | { kind: "source"; source: SourceItem }
  | { kind: "create"; title: string };

/**
 * Choose what to link to: one of your sources (search by title or author),
 * a new source (created on the spot), or a web address pasted in.
 */
export function LinkPicker({
  at,
  initialQuery = "",
  mode,
  onPick,
  onClose,
}: {
  at: Anchor;
  initialQuery?: string;
  mode: "source" | "link";
  onPick: (target: LinkTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sources, setSources] = useState<SourceItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useClickOutside(box, onClose);

  useEffect(() => {
    void loadSources(true).then(setSources);
    input.current?.focus();
  }, []);

  const options = useMemo<Option[]>(() => {
    const q = query.trim();
    if (isUrl(q)) return [{ kind: "url", url: /^www\./i.test(q) ? `https://${q}` : q }];
    const words = fold(q).split(/\s+/).filter(Boolean);
    const matches = (sources ?? [])
      .filter((s) => words.every((w) => fold(`${s.title} ${s.authors.join(" ")} ${s.year ?? ""}`).includes(w)))
      .slice(0, 8)
      .map((source): Option => ({ kind: "source", source }));
    return q ? [...matches, { kind: "create", title: q }] : matches;
  }, [query, sources]);

  const [prev, setPrev] = useState(options);
  if (prev !== options) {
    setPrev(options);
    setActive(0);
  }

  async function choose(o: Option) {
    setError(null);
    if (o.kind === "url") return onPick({ href: o.url, title: o.url });
    if (o.kind === "source") return onPick({ href: `/library/${o.source.id}`, title: o.source.title });
    setBusy(true);
    try {
      const form = new FormData();
      form.set("title", o.title);
      const res = await fetch("/api/upload/sources", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { id?: string; title?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Couldn't create the source.");
      void loadSources(true);
      onPick({ href: `/library/${data.id}`, title: data.title ?? o.title });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the source.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className={card} style={place(at, 360)} role="dialog" aria-label={mode === "source" ? "Link to source" : "Add a link"}>
      <div className="border-b border-rule p-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown" && options.length) {
              e.preventDefault();
              setActive((i) => (i + 1) % options.length);
            } else if (e.key === "ArrowUp" && options.length) {
              e.preventDefault();
              setActive((i) => (i - 1 + options.length) % options.length);
            } else if (e.key === "Enter" && options[active] && !busy) {
              e.preventDefault();
              void choose(options[active]);
            }
          }}
          placeholder={mode === "source" ? "Search your sources…" : "Search sources or paste a link…"}
          aria-label={mode === "source" ? "Search your sources" : "Search sources or paste a link"}
          className="w-full rounded-md bg-accent-soft/60 px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
      </div>
      <ul role="listbox" aria-label="Link to" className="max-h-72 overflow-y-auto p-1">
        {sources === null && <li className="px-2.5 py-2 text-muted">Loading…</li>}
        {sources !== null && !options.length && (
          <li className="px-2.5 py-2 text-muted">{sources.length ? "Type to search" : "Type a title to add a source"}</li>
        )}
        {options.map((o, i) => (
          <li key={o.kind === "source" ? o.source.id : o.kind} role="option" aria-selected={i === active}>
            <button
              type="button"
              disabled={busy}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(o)}
              className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left disabled:opacity-60 ${i === active ? "bg-accent-soft/80" : ""}`}
            >
              {o.kind === "source" ? (
                <>
                  <BookOpen size={15} strokeWidth={1.7} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{o.source.title}</span>
                    {(o.source.authors.length > 0 || o.source.year) && (
                      <span className="block truncate text-xs text-muted">
                        {[formatAuthors(o.source.authors), o.source.year].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </>
              ) : o.kind === "create" ? (
                <>
                  <Plus size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 truncate text-ink">
                    {busy ? "Creating…" : <>New source “{o.title}”</>}
                  </span>
                </>
              ) : (
                <>
                  <Link2 size={15} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 truncate text-ink">Link to {o.url}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="border-t border-rule px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
