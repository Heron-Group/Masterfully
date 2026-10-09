"use client";

import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
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
    <MarkdownEditor
      value={text}
      onChange={setText}
      placeholder={"My research question is…\n\nCurrent focus: …"}
      minRows={6}
      toolbar={<span className="text-xs"><SaveStatus state={state} error={error} onRetry={() => void flush()} /></span>}
      textareaProps={{ "aria-label": "Research context", onBlur: () => void flush() }}
    />
  );
}
