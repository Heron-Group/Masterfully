"use client";

import { FileText, Globe } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ui } from "@/components/ui";
import { formatAuthors, SOURCE_TYPE_OPTIONS, type GroupRefDto, type SourceDto } from "@/lib/dto";

/** Lower-case and strip accents so "muller" finds "Müller". */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function typeLabel(type: string): string {
  return SOURCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function LibraryView({ sources, groups }: { sources: SourceDto[]; groups: GroupRefDto[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState("");

  const visible = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return sources.filter((s) => {
      if (group && !s.groups.some((g) => g.id === group)) return false;
      if (type && s.type !== type) return false;
      if (!words.length) return true;
      const haystack = fold(`${s.title} ${s.authors.join(" ")}`);
      return words.every((w) => haystack.includes(w));
    });
  }, [sources, query, group, type]);

  if (!sources.length) {
    return (
      <div className="py-16 text-center">
        <p className="font-serif text-xl">Your library is empty.</p>
        <p className="mt-2 text-sm text-muted">Add a book, article or web page with a link, a PDF, or both.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or author"
          aria-label="Search sources"
          className={ui.input}
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by group" className={ui.input}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className={ui.input}>
            <option value="">All types</option>
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-2 text-xs text-faint">
        {visible.length === sources.length ? `${sources.length} sources` : `${visible.length} of ${sources.length} sources`}
      </p>
      <ul className="divide-y divide-rule border-y border-rule">
        {visible.map((s) => (
          <li key={s.id}>
            <SourceRow source={s} />
          </li>
        ))}
      </ul>
      {!visible.length && <p className="py-8 text-center text-sm text-muted">No sources match.</p>}
    </>
  );
}

export function SourceRow({ source: s }: { source: SourceDto }) {
  return (
    <div className="group flex items-start gap-3 py-3.5">
      <Link href={`/library/${s.id}`} className="min-w-0 flex-1">
        <span className="block font-serif text-[17px] leading-snug text-ink group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">
          {s.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {s.authors.length > 0 && <span>{formatAuthors(s.authors)}</span>}
          {s.year && <span className="tabular-nums">{s.year}</span>}
          <span className={ui.badge}>{typeLabel(s.type)}</span>
          {s.aiSummary && <span className={ui.badge}>Summary</span>}
        </span>
      </Link>
      {/* Open straight into the reading panel, beside the notes. */}
      <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
        {s.pdf && (
          <Link
            href={`/library/${s.id}?read=pdf`}
            title="Read the PDF beside your notes"
            aria-label={`Read the PDF of ${s.title}`}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink"
          >
            <FileText size={17} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        )}
        {s.url && (
          <Link
            href={`/library/${s.id}?read=link`}
            title="Read the web page beside your notes"
            aria-label={`Read the web page for ${s.title}`}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink"
          >
            <Globe size={17} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
