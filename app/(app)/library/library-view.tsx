"use client";

import { ArrowLeft, ArrowRight, FileText, Globe } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArchiveFilter, ArchivedBadge, matchesArchive, type ArchiveView } from "@/components/archive";
import { isAnnotated, SourceBadges } from "@/components/source-badges";
import { ui } from "@/components/ui";
import { formatAuthors, SOURCE_TYPE_OPTIONS, type GroupRefDto, type SourceDto } from "@/lib/dto";
import { EmptyState } from "@/components/empty-state";
import type { LinkCounts } from "@/lib/sources/links";

/** Lower-case and strip accents so "muller" finds "Müller". */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const plural = (n: number) => `${n} source${n === 1 ? "" : "s"}`;


export function LibraryView({ sources, groups, linkCounts = {} }: { sources: SourceDto[]; groups: GroupRefDto[]; linkCounts?: LinkCounts }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [type, setType] = useState("");
  const [archive, setArchive] = useState<ArchiveView>("current");
  const inView = useMemo(() => sources.filter((s) => matchesArchive(archive, s.archived)), [sources, archive]);
  const hiddenArchived = archive === "current" ? sources.length - inView.length : 0;

  const visible = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return inView.filter((s) => {
      if (group && !s.groups.some((g) => g.id === group)) return false;
      if (type && s.type !== type) return false;
      if (!words.length) return true;
      const haystack = fold(`${s.title} ${s.authors.join(" ")}`);
      return words.every((w) => haystack.includes(w));
    });
  }, [inView, query, group, type]);

  if (!sources.length) {
    return (
      <EmptyState label="Your library is empty." />
    );
  }

  return (
    <>
      <div className="mb-6 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or author"
          aria-label="Search sources"
          className={ui.input}
        />
        <div className="grid grid-cols-3 gap-2 sm:contents">
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
          <ArchiveFilter value={archive} onChange={setArchive} />
        </div>
      </div>

      <p className="mb-2 text-xs text-faint">
        {visible.length === inView.length ? `${inView.length} ${archive === "archived" ? "archived " : ""}sources` : `${visible.length} of ${inView.length} sources`}
        {hiddenArchived > 0 && ` · ${hiddenArchived} archived not shown`}
      </p>
      <ul className="divide-y divide-rule border-y border-rule">
        {visible.map((s) => (
          <li key={s.id}>
            <SourceRow source={s} links={linkCounts[s.id]} />
          </li>
        ))}
      </ul>
      {!visible.length && <p className="py-8 text-center text-sm text-muted">No sources match.</p>}
    </>
  );
}

export function SourceRow({ source: s, links }: { source: SourceDto; links?: { to: number; from: number } }) {
  return (
    <div className="group flex items-start gap-3 py-3.5">
      <Link href={`/library/${s.id}`} className="min-w-0 flex-1">
        <span className="block font-serif text-[17px] leading-snug text-ink group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">
          {s.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {s.authors.length > 0 && <span>{formatAuthors(s.authors)}</span>}
          {s.year && <span className="tabular-nums">{s.year}</span>}
          {s.archived && <ArchivedBadge />}
          <SourceBadges summarised={!!s.aiSummary} annotated={isAnnotated(s.notes)} />
          {!!links?.from && (
            <span className={`${ui.badge} inline-flex items-center gap-1`} title={`${plural(links.from)} link to this source`}>
              <ArrowLeft size={11} strokeWidth={1.8} aria-hidden="true" />
              Linked from {links.from}
            </span>
          )}
          {!!links?.to && (
            <span className={`${ui.badge} inline-flex items-center gap-1`} title={`This source links to ${plural(links.to)}`}>
              <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
              Links to {links.to}
            </span>
          )}
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
