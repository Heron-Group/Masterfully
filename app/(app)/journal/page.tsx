import type { Metadata } from "next";
import { Suspense } from "react";
import { entryToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { Journal } from "./journal";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  return (
    <Suspense fallback={<div style={{ height: "calc(100dvh - var(--header-height))" }} />}>
      <JournalLoader />
    </Suspense>
  );
}

async function JournalLoader() {
  await requireSession();
  const store = await getContentStore();
  const { entries, hasMore } = await store.listJournal({ limit: 50 });
  return <Journal initial={{ entries: entries.map(entryToDto), hasMore }} />;
}
