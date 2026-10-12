import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { sourceToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { extractSourceLinks } from "@/lib/map/graph";
import { LibraryView, type LinkCounts } from "./library-view";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <main className={ui.page}>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className={ui.h1}>Library</h1>
        <Link href="/library/new" className={ui.btnPrimary}>
          Add source
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-faint">Loading sources…</p>}>
        <LibraryLoader />
      </Suspense>
    </main>
  );
}

async function LibraryLoader() {
  await requireSession();
  const store = await getContentStore();
  const [sources, groups] = await Promise.all([store.listSources(), store.listGroups()]);
  return (
    <LibraryView
      sources={sources.map((s) => sourceToDto(s, groups))}
      groups={groups.map((g) => ({ id: g.id, title: g.title }))}
      linkCounts={countLinks(sources)}
    />
  );
}

/** Distinct sources each source links to and is linked from, read from source notes (as on the map). */
function countLinks(sources: Array<{ id: string; notes: string }>): LinkCounts {
  const ids = new Set(sources.map((s) => s.id));
  const to = new Map<string, Set<string>>();
  const from = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, value: string) => m.set(key, (m.get(key) ?? new Set()).add(value));
  for (const s of sources) {
    for (const link of extractSourceLinks(s.notes)) {
      if (link.to === s.id || !ids.has(link.to)) continue;
      add(to, s.id, link.to);
      add(from, link.to, s.id);
    }
  }
  return Object.fromEntries(sources.map((s) => [s.id, { to: to.get(s.id)?.size ?? 0, from: from.get(s.id)?.size ?? 0 }]));
}
