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
          ? "Generate a summary of the PDF: its argument, key concepts, citable claims and relevance to your research."
          : source.url
            ? "Generate a summary from the linked page."
            : "Add a PDF or a link for a full summary, or generate one from the details and your notes."
      }
    />
  );
}
