import type { Metadata } from "next";
import { StagePlaceholder } from "@/components/stage-placeholder";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  return <StagePlaceholder title="Journal" stage={2} />;
}
