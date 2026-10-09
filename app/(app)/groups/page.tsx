import type { Metadata } from "next";
import { StagePlaceholder } from "@/components/stage-placeholder";

export const metadata: Metadata = { title: "Reading groups" };

export default function ReadinggroupsPage() {
  return <StagePlaceholder title="Reading groups" stage={4} />;
}
