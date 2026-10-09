import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
      <Link href="/library" className="text-sm text-muted hover:text-ink">
        ← Library
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-faint">Loading…</p>}>
        <SourceLoader params={props.params} />
      </Suspense>
    </main>
  );
}

async function SourceLoader({ params }: { params: PageProps<"/library/[id]">["params"] }) {
  await requireSession();
  const { id } = await params;
  const store = await getContentStore();
  const [source, groups] = await Promise.all([store.getSource(id), store.listGroups()]);
  if (!source) notFound();
  return (
    <SourceView
      key={source.id}
      source={sourceToDto(source, groups)}
      allGroups={groups.map((g) => ({ id: g.id, title: g.title }))}
    />
  );
}
