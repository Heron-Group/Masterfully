"use client";

import { Check, Plus, SquareStack, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupRefDto } from "@/lib/dto";
import { ui } from "./ui";

function fold(text: string) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Reading groups as tags. Each tag links to its group and has a × to leave
 * it; "+ Add to group" opens a search list where several groups can be
 * ticked in one go, or a new group created by typing its name.
 */
export function GroupTags({
  selected,
  all,
  onAdd,
  onRemove,
  onCreate,
  linkTags = true,
}: {
  selected: GroupRefDto[];
  all: GroupRefDto[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Create a group with this title and add to it. */
  onCreate?: (title: string) => void;
  /** Tags link to their group pages (off on the blank new-source page). */
  linkTags?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selectedIds = new Set(selected.map((g) => g.id));

  const matches = useMemo(() => {
    const q = fold(query.trim());
    return all.filter((g) => !q || fold(g.title).includes(q));
  }, [all, query]);
  const exact = all.some((g) => fold(g.title) === fold(query.trim()));
  const canCreate = !!onCreate && !!query.trim() && !exact;
  const options = matches.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(g: GroupRefDto) {
    if (selectedIds.has(g.id)) onRemove(g.id);
    else onAdd(g.id);
    search.current?.focus(); // keep typing to find the next group
  }

  function choose(index: number) {
    if (index < matches.length) toggle(matches[index]);
    else if (canCreate) {
      onCreate!(query.trim());
      setQuery("");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Reading groups" role="group">
      {selected.map((g) => (
        <span key={g.id} className="group/tag inline-flex items-center rounded-md bg-accent-soft/70 text-[13px] text-ink">
          {linkTags ? (
            <Link href={`/groups/${g.id}`} className="flex items-center gap-1.5 py-1 pl-2 pr-1 hover:underline hover:decoration-rule hover:underline-offset-2">
              <SquareStack size={13} strokeWidth={1.7} className="text-muted" aria-hidden="true" />
              {g.title}
            </Link>
          ) : (
            <span className="flex items-center gap-1.5 py-1 pl-2 pr-1">
              <SquareStack size={13} strokeWidth={1.7} className="text-muted" aria-hidden="true" />
              {g.title}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(g.id)}
            aria-label={`Remove from ${g.title}`}
            title={`Remove from ${g.title}`}
            className="self-stretch rounded-r-md px-1 text-faint hover:text-danger"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      ))}

      <div ref={box} className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setQuery("");
            setActive(0);
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={ui.btnAction}
        >
          <Plus size={14} strokeWidth={1.7} aria-hidden="true" />
          Add to group
        </button>
        {open && (
          <div
            className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg bg-surface p-1.5 shadow-lg shadow-black/10 ring-1 ring-rule"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <input
              ref={search}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, options - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (options) choose(active);
                }
              }}
              placeholder={onCreate ? "Find or create a group…" : "Find a group…"}
              aria-label="Find a group"
              className="w-full rounded-md bg-accent-soft/60 px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none"
            />
            <ul role="listbox" aria-label="Reading groups" aria-multiselectable="true" className="mt-1 max-h-64 overflow-y-auto">
              {matches.map((g, i) => {
                const isIn = selectedIds.has(g.id);
                return (
                  <li key={g.id} role="option" aria-selected={isIn}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => toggle(g)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? "bg-accent-soft/70" : ""}`}
                    >
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded-sm ${isIn ? "bg-ink text-paper" : "ring-1 ring-rule"}`}>
                        {isIn && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{g.title}</span>
                    </button>
                  </li>
                );
              })}
              {canCreate && (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(matches.length)}
                    onClick={() => choose(matches.length)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active === matches.length ? "bg-accent-soft/70" : ""}`}
                  >
                    <Plus size={14} className="shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      Create “{query.trim()}”
                    </span>
                  </button>
                </li>
              )}
              {!matches.length && !canCreate && (
                <li className="px-2 py-2 text-sm text-faint">{all.length ? "No matching groups." : "No reading groups yet."}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
