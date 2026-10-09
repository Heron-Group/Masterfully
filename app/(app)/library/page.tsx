import type { Metadata } from "next";
import { StagePlaceholder } from "@/components/stage-placeholder";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return <StagePlaceholder title="Library" stage={3} />;
}
