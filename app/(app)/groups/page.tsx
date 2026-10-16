import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { EmptyState } from "@/components/empty-state";
import { GroupsView } from "./groups-view";

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
    <GroupsView
      groups={groups.map((g) => ({
        id: g.id,
        title: g.title,
        overview: g.overview,
        sourceCount: g.sources.length,
        updated: g.updated,
        archived: g.archived,
      }))}
    />
  );
}
