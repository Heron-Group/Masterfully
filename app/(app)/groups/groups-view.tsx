"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArchiveFilter, ArchivedBadge, matchesArchive, type ArchiveView } from "@/components/archive";
import { ui } from "@/components/ui";
import { formatShortDate } from "@/lib/time";
import { fold } from "../library/library-view";

export type GroupRow = { id: string; title: string; overview: string; sourceCount: number; updated: string; archived?: string };

/** The reading groups, with search and the archived filter (archived groups hidden by default). */
export function GroupsView({ groups }: { groups: GroupRow[] }) {
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState<ArchiveView>("current");
  const inView = useMemo(() => groups.filter((g) => matchesArchive(archive, g.archived)), [groups, archive]);
  const hiddenArchived = archive === "current" ? groups.length - inView.length : 0;
  const visible = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return inView.filter((g) => words.every((w) => fold(`${g.title} ${g.overview}`).includes(w)));
  }, [inView, query]);

  return (
    <>
      <div className="mb-6 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search groups"
          aria-label="Search groups"
          className={ui.input}
        />
        <ArchiveFilter value={archive} onChange={setArchive} />
      </div>
      <p className="mb-2 text-xs text-faint">
        {visible.length === inView.length ? `${inView.length} ${archive === "archived" ? "archived " : ""}group${inView.length === 1 ? "" : "s"}` : `${visible.length} of ${inView.length} groups`}
        {hiddenArchived > 0 && ` · ${hiddenArchived} archived not shown`}
      </p>
      <ul className="divide-y divide-rule border-y border-rule">
        {visible.map((g) => (
          <li key={g.id}>
            <Link href={`/groups/${g.id}`} className="group flex items-baseline gap-4 py-4">
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-serif text-lg leading-snug group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{g.title}</span>
                {g.archived && <ArchivedBadge />}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-muted">
                {g.sourceCount} source{g.sourceCount === 1 ? "" : "s"}
              </span>
              <span className="hidden shrink-0 whitespace-nowrap text-right text-xs text-faint sm:block">Updated {formatShortDate(g.updated)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {!visible.length && <p className="py-8 text-center text-sm text-muted">No groups match.</p>}
    </>
  );
}
