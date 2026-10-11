import { PenLine, Sparkles } from "lucide-react";
import { countWords } from "@/lib/speech/text";
import { ui } from "./ui";

/** Any notes at all (at least one word) count as annotated. */
export function isAnnotated(notes: string): boolean {
  return countWords(notes) > 0;
}

/** "AI summarised" and "Annotated" labels, shown beside a source's type. */
export function SourceBadges({ summarised, annotated }: { summarised: boolean; annotated: boolean }) {
  return (
    <>
      {summarised && (
        <span className={`${ui.badge} inline-flex items-center gap-1`} title="Has an AI summary">
          <Sparkles size={11} strokeWidth={1.8} aria-hidden="true" />
          AI summarised
        </span>
      )}
      {annotated && (
        <span className={`${ui.badge} inline-flex items-center gap-1`} title="You've written notes on this source">
          <PenLine size={11} strokeWidth={1.8} aria-hidden="true" />
          Annotated
        </span>
      )}
    </>
  );
}
