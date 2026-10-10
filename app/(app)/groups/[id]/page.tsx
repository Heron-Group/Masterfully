import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { groupToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { GroupView } from "./group-view";

export async function generateMetadata(props: PageProps<"/groups/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: id };
}

export default function GroupPage(props: PageProps<"/groups/[id]">) {
  return (
    <main className={ui.page}>
      <BackLink to="groups" />
      <Suspense fallback={<p className="mt-6 text-sm text-faint">Loading…</p>}>
        <GroupLoader params={props.params} />
      </Suspense>
    </main>
  );
}

async function GroupLoader({ params }: { params: PageProps<"/groups/[id]">["params"] }) {
  await requireSession();
  const { id } = await params;
  const store = await getContentStore();
  const group = await store.getGroup(id);
  if (!group) notFound();
  const library = (await store.listSources()).map((s) => ({
    id: s.id,
    title: s.title,
    authors: s.authors,
    year: s.year,
  }));
  return <GroupView key={group.id} group={await groupToDto(group, store)} library={library} />;
}
