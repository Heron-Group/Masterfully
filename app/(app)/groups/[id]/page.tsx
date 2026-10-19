import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { groupToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { shortTitle } from "@/lib/map/graph";
import { groupColours } from "@/lib/map/server";
import { countLinks } from "@/lib/sources/links";
import { GroupView } from "./group-view";

/** The browser tab shows the reading group's title (shortened if long), not its file name. */
export async function generateMetadata(props: PageProps<"/groups/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const item = await getContentStore()
    .then((store) => store.getGroup(id))
    .catch(() => null);
  return { title: item?.title ? shortTitle(item.title, 60) : "Reading group" };
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
  const account = await requireSession();
  const { id } = await params;
  const store = await getContentStore();
  const group = await store.getGroup(id);
  if (!group) notFound();
  const colours = await groupColours(account.id, await store.listGroups());
  const sources = await store.listSources();
  const library = sources.map((s) => ({ id: s.id, title: s.title, authors: s.authors, year: s.year, archived: !!s.archived }));
  return (
    <GroupView
      key={group.id}
      group={await groupToDto(group, store)}
      library={library}
      linkCounts={countLinks(sources)}
      colour={colours[group.id]}
    />
  );
}
