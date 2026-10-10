import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { formatShortDate } from "@/lib/time";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Reading groups" };

export default function GroupsPage() {
  return (
    <main className={ui.page}>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className={ui.h1}>Reading groups</h1>
        <Link href="/groups/new" className={ui.btnPrimary}>
          New group
        </Link>
      </div>
      <Suspense fallback={<p className="mt-8 text-sm text-faint">Loading groups…</p>}>
        <GroupList />
      </Suspense>
    </main>
  );
}

async function GroupList() {
  await requireSession();
  const groups = await (await getContentStore()).listGroups();
  if (!groups.length) {
    return (
      <EmptyState label="No reading groups yet." />
    );
  }
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {groups.map((g) => (
        <li key={g.id}>
          <Link href={`/groups/${g.id}`} className="group flex items-baseline gap-4 py-4">
            <span className="min-w-0 flex-1 font-serif text-lg leading-snug group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">
              {g.title}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-muted">
              {g.sources.length} source{g.sources.length === 1 ? "" : "s"}
            </span>
            <span className="hidden shrink-0 whitespace-nowrap text-right text-xs text-faint sm:block">
              Updated {formatShortDate(g.updated)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
