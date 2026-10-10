import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { noteToListItem } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { NotesView } from "./notes-view";

export const metadata: Metadata = { title: "Notes" };

export default function NotesPage() {
  return (
    <main className={ui.page}>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className={ui.h1}>Notes</h1>
        <Link href="/notes/new" className={ui.btnPrimary}>
          Add note
        </Link>
      </div>
      <Suspense fallback={<p className="text-sm text-faint">Loading notes…</p>}>
        <NotesLoader />
      </Suspense>
    </main>
  );
}

async function NotesLoader() {
  await requireSession();
  const notes = await (await getContentStore()).listNotes();
  return <NotesView notes={notes.map(noteToListItem)} />;
}
