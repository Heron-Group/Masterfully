import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { FreshOnEachVisit } from "@/components/fresh-on-each-visit";
import { ui } from "@/components/ui";
import { NewGroupView } from "./new-group-view";

export const metadata: Metadata = { title: "New group" };

/** A blank group page; the group is created once it has a title. */
export default function NewGroupPage() {
  return (
    <main className={ui.page}>
      <BackLink to="groups" />
      <FreshOnEachVisit>
        <NewGroupView />
      </FreshOnEachVisit>
    </main>
  );
}
