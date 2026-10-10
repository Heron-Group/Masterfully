import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { sourceToDto } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { SourceView } from "./source-view";

export async function generateMetadata(props: PageProps<"/library/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: id };
}

export default function SourcePage(props: PageProps<"/library/[id]">) {
  return (
    <main className={ui.page}>
      <BackLink to="library" />
      <Suspense fallback={<p className="mt-6 text-sm text-faint">Loading…</p>}>
        <SourceLoader params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function SourceLoader({
  params,
  searchParams,
}: {
  params: PageProps<"/library/[id]">["params"];
  searchParams: PageProps<"/library/[id]">["searchParams"];
}) {
  await requireSession();
  const { id } = await params;
  const read = (await searchParams).read;
  const store = await getContentStore();
  const [source, groups] = await Promise.all([store.getSource(id), store.listGroups()]);
  if (!source) notFound();
  return (
    <SourceView
      key={source.id}
      source={sourceToDto(source, groups)}
      allGroups={groups.map((g) => ({ id: g.id, title: g.title }))}
      initialRead={read === "pdf" || read === "link" ? read : undefined}
    />
  );
}
