"use client";

import { SummaryPanel } from "@/components/summary-panel";
import type { SourceDto } from "@/lib/dto";

export function SourceSummaryPanel({ source }: { source: SourceDto }) {
  return (
    <SummaryPanel
      endpoint={`/api/ai/source/${encodeURIComponent(source.id)}`}
      summary={source.aiSummary}
      headingId="summary-heading"
      emptyHint={
        source.pdf
          ? "Generate a summary of the PDF: a research-style abstract and a breakdown of what it explores."
          : source.url
            ? "Generate a summary of the linked page: a research-style abstract and a breakdown of what it explores."
            : "Add a PDF or a link for a full summary, or generate one from the details and your notes."
      }
    />
  );
}
