"use client";

import { Markdown } from "@/components/markdown";
import { ui } from "@/components/ui";
import type { GroupDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";

/** Shows the saved AI summary. Generating summaries arrives in stage 5. */
export function GroupSummaryPanel({ group }: { group: GroupDto }) {
  return (
    <section aria-labelledby="group-summary-heading">
      <h2 id="group-summary-heading" className={`${ui.h2} mb-3`}>
        AI summary
      </h2>
      {group.aiSummary ? (
        <div className="rounded-lg border border-rule bg-accent-soft/40 p-4">
          <p className="mb-3 text-xs text-muted">
            AI-generated{group.aiSummary.generated ? ` ${formatShortDate(group.aiSummary.generated)}` : ""}
            {group.aiSummary.model ? ` · ${group.aiSummary.model}` : ""}
            {group.summaryStale && <span className="ml-2 text-warn">Out of date: sources have changed since</span>}
          </p>
          <Markdown className="text-[16px]">{group.aiSummary.text}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted">No summary yet.</p>
      )}
    </section>
  );
}
