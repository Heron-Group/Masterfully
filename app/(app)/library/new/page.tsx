import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ui } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { NewSourceForm } from "./new-source-form";

export const metadata: Metadata = { title: "Add source" };

export default function NewSourcePage(props: PageProps<"/library/new">) {
  return (
    <main className={ui.page}>
      <BackLink to="library" />
      <h1 className="sr-only">Add a source</h1>
      <div className="mt-6" />
      <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
        <FormLoader searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function FormLoader({ searchParams }: { searchParams: PageProps<"/library/new">["searchParams"] }) {
  await requireSession();
  const store = await getContentStore();
  const groups = await store.listGroups();
  const preselect = (await searchParams).group;
  return (
    <NewSourceForm
      groups={groups.map((g) => ({ id: g.id, title: g.title }))}
      preselectedGroup={typeof preselect === "string" ? preselect : undefined}
    />
  );
}
