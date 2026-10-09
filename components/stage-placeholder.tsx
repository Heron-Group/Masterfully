import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";

/** Temporary page body until each section is built (stages 2–5). */
export function StagePlaceholder({ title, stage }: { title: string; stage: number }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">Coming in stage {stage}.</p>
      <Suspense fallback={<p className="mt-8 text-sm text-faint">Reading content…</p>}>
        <ContentSummary />
      </Suspense>
    </main>
  );
}

async function ContentSummary() {
  await requireSession();
  const store = await getContentStore();
  const [journal, sources, groups] = await Promise.all([
    store.listJournal({ limit: 1_000_000 }),
    store.listSources(),
    store.listGroups(),
  ]);
  return (
    <dl className="mt-8 grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      <dt className="text-muted">Content folder</dt>
      <dd className="truncate font-mono text-xs leading-5">{store.dir}</dd>
      <dt className="text-muted">Journal entries</dt>
      <dd>{journal.entries.length}</dd>
      <dt className="text-muted">Sources</dt>
      <dd>{sources.length}</dd>
      <dt className="text-muted">Groups</dt>
      <dd>{groups.length}</dd>
    </dl>
  );
}
