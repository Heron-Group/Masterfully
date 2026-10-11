"use client";

import { useState } from "react";
import { CONTENT_CHANGED_EVENT } from "@/components/content-events";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import { saveResearchContext } from "./actions";

export function ResearchContextEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const { state, error, flush } = useAutosave(text, async (value) => {
    const r = await saveResearchContext(value);
    if (r.ok) window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  return (
    <div>
      <div className="rounded-lg bg-accent-soft/40 px-4 py-3">
        <LiveEditor
          value={text}
          onChange={setText}
          onBlur={() => void flush()}
          placeholder="My research question is…"
          ariaLabel="Research context"
          className="min-h-24"
        />
      </div>
      <p className="mt-1 h-4 text-xs">
        <SaveStatus state={state} error={error} onRetry={() => void flush()} />
      </p>
    </div>
  );
}
