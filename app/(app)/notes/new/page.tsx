import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { NewNoteView } from "./new-note-view";

export const metadata: Metadata = { title: "Add note" };

/** A blank note page; the note is created once it has a title. */
export default function NewNotePage() {
  return (
    <main className={ui.page}>
      <BackLink to="notes" />
      <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
        <SignedIn />
      </Suspense>
    </main>
  );
}

async function SignedIn() {
  await requireSession();
  return <NewNoteView />;
}
