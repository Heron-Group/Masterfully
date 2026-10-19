import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { noteToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { shortTitle } from "@/lib/map/graph";
import { NoteView } from "./note-view";

/** The browser tab shows the note's title (shortened if long), not its file name. */
export async function generateMetadata(props: PageProps<"/notes/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const item = await getContentStore()
    .then((store) => store.getNote(id))
    .catch(() => null);
  return { title: item?.title ? shortTitle(item.title, 60) : "Note" };
}

export default function NotePage(props: PageProps<"/notes/[id]">) {
  return (
    <main className={ui.page}>
      <BackLink to="notes" />
      <Suspense fallback={<p className="mt-6 text-sm text-faint">Loading…</p>}>
        <NoteLoader params={props.params} />
      </Suspense>
    </main>
  );
}

async function NoteLoader({ params }: { params: PageProps<"/notes/[id]">["params"] }) {
  await requireSession();
  const { id } = await params;
  const note = await (await getContentStore()).getNote(id);
  if (!note) notFound();
  return <NoteView key={note.id} note={noteToDto(note)} />;
}
