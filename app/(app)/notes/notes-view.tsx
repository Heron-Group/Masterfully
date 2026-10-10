"use client";

import { Paperclip } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ui } from "@/components/ui";
import type { NoteListItemDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";
import { fold } from "../library/library-view";

/** First line of a note's text, without Markdown markers, for the list. */
function preview(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^\s*(#+|[-*+]|\d+\.|>)\s+/, "").replace(/[*_`~]|\[(.*?)\]\(.*?\)/g, (m, link) => link ?? "").trim();
}

export function NotesView({ notes }: { notes: NoteListItemDto[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return notes;
    return notes.filter((n) => {
      const haystack = fold(`${n.title} ${n.text}`);
      return words.every((w) => haystack.includes(w));
    });
  }, [notes, query]);

  if (!notes.length) {
    return (
      <div className="py-16 text-center">
        <p className="font-serif text-xl">No notes yet.</p>
        <p className="mt-2 text-sm text-muted">Notes are for longer pieces of writing, with attachments and an optional AI summary.</p>
      </div>
    );
  }

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notes"
        aria-label="Search notes"
        className={`${ui.input} mb-6`}
      />
      <p className="mb-2 text-xs text-faint">
        {visible.length === notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : `${visible.length} of ${notes.length} notes`}
      </p>
      <ul className="divide-y divide-rule border-y border-rule">
        {visible.map((n) => (
          <li key={n.id}>
            <Link href={`/notes/${n.id}`} className="group block py-3.5">
              <span className="block font-serif text-[17px] leading-snug text-ink group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">
                {n.title}
              </span>
              <span className="mt-1 flex items-center gap-2 text-sm text-muted">
                <span className="shrink-0 tabular-nums text-faint">{formatShortDate(n.updated)}</span>
                {preview(n.text) && <span className="min-w-0 truncate">{preview(n.text)}</span>}
                {n.attachments > 0 && (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-faint" title={`${n.attachments} attachment${n.attachments === 1 ? "" : "s"}`}>
                    <Paperclip size={13} strokeWidth={1.7} aria-hidden="true" />
                    <span className="sr-only">Attachments:</span>
                    {n.attachments}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!visible.length && <p className="py-8 text-center text-sm text-muted">No notes match.</p>}
    </>
  );
}
