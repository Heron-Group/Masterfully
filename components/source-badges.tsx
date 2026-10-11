import { PenLine, Sparkles } from "lucide-react";
import { countWords } from "@/lib/speech/text";
import { ui } from "./ui";

/** Notes longer than this count as annotated. */
export const ANNOTATED_WORDS = 50;

export function isAnnotated(notes: string): boolean {
  return countWords(notes) > ANNOTATED_WORDS;
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
        <span className={`${ui.badge} inline-flex items-center gap-1`} title={`Your notes are over ${ANNOTATED_WORDS} words`}>
          <PenLine size={11} strokeWidth={1.8} aria-hidden="true" />
          Annotated
        </span>
      )}
    </>
  );
}
