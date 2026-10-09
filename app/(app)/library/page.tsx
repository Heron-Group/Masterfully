import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { sourceToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { LibraryView } from "./library-view";

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
    />
  );
}
