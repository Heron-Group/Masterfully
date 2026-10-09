"use client";

import { SummaryPanel } from "@/components/summary-panel";
import type { GroupDto } from "@/lib/dto";

export function GroupSummaryPanel({ group }: { group: GroupDto }) {
  return (
    <SummaryPanel
      endpoint={`/api/ai/group/${encodeURIComponent(group.id)}`}
      summary={group.aiSummary}
      stale={group.summaryStale}
      headingId="group-summary-heading"
      emptyHint="Generate a summary of themes, agreements, disagreements and gaps across this group, using each source's notes and AI summary."
    />
  );
}
