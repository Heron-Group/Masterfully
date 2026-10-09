"use client";

import { Markdown } from "@/components/markdown";
import { ui } from "@/components/ui";
import type { SourceDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";

/** Shows the saved AI summary. Generating summaries arrives in stage 5. */
export function SourceSummaryPanel({ source }: { source: SourceDto }) {
  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className={`${ui.h2} mb-3`}>
        AI summary
      </h2>
      {source.aiSummary ? (
        <div className="rounded-lg border border-rule bg-accent-soft/40 p-4">
          <p className="mb-3 text-xs text-muted">
            AI-generated{source.aiSummary.generated ? ` ${formatShortDate(source.aiSummary.generated)}` : ""}
            {source.aiSummary.model ? ` · ${source.aiSummary.model}` : ""}
          </p>
          <Markdown className="text-[16px]">{source.aiSummary.text}</Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted">No summary yet.</p>
      )}
    </section>
  );
}
