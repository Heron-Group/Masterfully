"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { AiEvent, AiSummaryDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";
import { Markdown } from "./markdown";
import { CONTENT_CHANGED_EVENT } from "./sync-status";
import { ui } from "./ui";

type Run =
  | { state: "idle" }
  | { state: "running"; text: string; notices: string[] }
  | { state: "error"; message: string; code?: string; notices: string[] };

/**
 * AI summary section for a source or group. Generates only when the button
 * is pressed, streams the text in, and is always labelled as AI-generated.
 * A failed run leaves the saved summary untouched.
 */
export function SummaryPanel({
  endpoint,
  summary,
  stale,
  headingId,
  emptyHint,
}: {
  endpoint: string;
  summary: AiSummaryDto | null;
  stale?: boolean;
  headingId: string;
  emptyHint: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [warning, setWarning] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function generate(mode?: "metadata") {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setWarning(null);
    let current = { state: "running", text: "", notices: [] } as Run;
    setRun(current);
    const update = (next: Run) => {
      current = next;
      setRun(next);
    };
    try {
      const res = await fetch(`${endpoint}${mode ? `?mode=${mode}` : ""}`, { method: "POST", signal: controller.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AiEvent;
          const notices = current.state === "idle" ? [] : current.notices;
          switch (event.type) {
            case "notice":
              update({ ...(current.state === "running" ? current : { state: "running", text: "" }), notices: [...notices, event.message] } as Run);
              break;
            case "delta":
              if (current.state === "running") update({ ...current, text: current.text + event.text });
              break;
            case "reset":
              update({ state: "running", text: "", notices: [...notices, event.message] });
              break;
            case "error":
              finished = true;
              update({ state: "error", message: event.message, code: event.code, notices });
              break;
            case "done":
              finished = true;
              setWarning(event.warning ?? null);
              update({ state: "idle" });
              window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
              router.refresh();
              break;
          }
        }
      }
      if (!finished) throw new Error("The connection closed before the summary finished. Nothing was saved.");
    } catch (err) {
      if (controller.signal.aborted) return;
      update({
        state: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
        notices: current.state === "idle" ? [] : current.notices,
      });
    }
  }

  const running = run.state === "running";

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id={headingId} className={ui.h2}>
          AI summary
        </h2>
        <div className="ml-auto flex gap-2">
          {running ? (
            <button type="button" onClick={() => { abort.current?.abort(); setRun({ state: "idle" }); }} className={ui.btnGhost}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={() => void generate()} className={ui.btnSecondary}>
              {summary ? "Regenerate summary" : "Generate summary"}
            </button>
          )}
        </div>
      </div>

      {run.state !== "idle" && run.notices.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm text-muted" aria-live="polite">
          {run.notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {run.state === "error" && (
        <div role="alert" className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm">
          <p className="text-danger">{run.message}</p>
          {summary && <p className="mt-1 text-muted">The previous summary below is unchanged.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {run.code === "url_unavailable" && (
              <button type="button" onClick={() => void generate("metadata")} className={ui.btnSecondary}>
                Summarise from details and notes only
              </button>
            )}
            {run.code !== "not_configured" && (
              <button type="button" onClick={() => void generate()} className={ui.btnGhost}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
      {warning && <p className="mb-3 text-sm text-warn">{warning}</p>}

      {running ? (
        <AiBox label="AI-generated · writing…" live>
          {run.text ? <Markdown className="text-[16px]">{run.text}</Markdown> : <p className="text-sm text-faint">Thinking…</p>}
        </AiBox>
      ) : summary ? (
        <AiBox
          label={`AI-generated${summary.generated ? ` ${formatShortDate(summary.generated)}` : ""}${summary.model ? ` · ${summary.model}` : ""}`}
          stale={stale}
        >
          <Markdown className="text-[16px]">{summary.text}</Markdown>
        </AiBox>
      ) : (
        run.state === "idle" && <p className="text-sm text-muted">{emptyHint}</p>
      )}
    </section>
  );
}

function AiBox({ label, stale, live, children }: { label: string; stale?: boolean; live?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rule bg-accent-soft/40 p-4" aria-live={live ? "polite" : undefined} aria-busy={live}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full border border-accent/30 px-2 py-px text-accent">AI</span>
        <span>{label}</span>
        {stale && <span className="text-warn">· Out of date: the group&apos;s sources changed after this was written</span>}
      </p>
      {children}
    </div>
  );
}
