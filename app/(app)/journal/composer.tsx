"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { LiveEditor, type LiveEditorHandle } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import type { EntryDto } from "@/lib/dto";
import { upload } from "@/lib/upload-client";
import { AttachButton, PendingFiles, releasePending, toPending, type PendingFile } from "./attachments";

const DRAFT_KEY = "rp:journal-draft";

export type ComposerHandle = { addFiles: (files: Iterable<File>) => void; focus: () => void };

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The bottom of the journal is where you write: a line on the page rather
 * than a text box. Enter adds a line, Cmd/Ctrl+Enter or Post saves. The text
 * draft survives a reload (files can't be kept by the browser).
 */
export function Composer({ onPosted, ref }: { onPosted: (entry: EntryDto) => void; ref?: Ref<ComposerHandle> }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<LiveEditorHandle>(null);
  const restored = useRef(false);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      editor.current?.setValue(draft);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore draft after hydration
      setText(draft);
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [text]);

  function addFiles(list: Iterable<File>) {
    const { accepted, rejected } = toPending(list);
    if (accepted.length) setFiles((f) => [...f, ...accepted]);
    setError(rejected.length ? `Too large (over 50 MB): ${rejected.join(", ")}` : null);
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => editor.current?.focus("end") }));

  async function post() {
    if (posting || (!text.trim() && !files.length)) return;
    setPosting(true);
    setError(null);
    const form = new FormData();
    form.set("body", text);
    for (const f of files) form.append("files", f.file, f.file.name);
    if (files.length) setProgress(0);
    try {
      const entry = await upload<EntryDto>("/api/upload/journal", form, files.length ? setProgress : undefined);
      releasePending(files);
      setFiles([]);
      setText("");
      editor.current?.setValue("");
      onPosted(entry);
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post the entry.");
    } finally {
      setPosting(false);
      setProgress(null);
    }
  }

  const canPost = !posting && (!!text.trim() || files.length > 0);

  return (
    <div role="region" aria-label="New entry" className="bg-paper pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl px-3 sm:px-4">
        {error && (
          <p role="alert" className="mb-2 px-1 text-sm text-danger">
            {error}
          </p>
        )}
        {/* A rounded input box, like Claude's: writing on top, controls below. */}
        <div className="rounded-2xl border border-rule bg-surface px-4 pb-2 pt-3 shadow-[0_1px_6px_rgba(0,0,0,0.04)] transition-colors focus-within:border-faint">
          {files.length > 0 && (
            <div className="mb-2">
              <PendingFiles
                files={files}
                onRemove={(id) =>
                  setFiles((fs) => {
                    releasePending(fs.filter((f) => f.id === id));
                    return fs.filter((f) => f.id !== id);
                  })
                }
              />
            </div>
          )}
          <div className="max-h-[40vh] overflow-y-auto">
            <LiveEditor
              ref={editor}
              value={text}
              onChange={setText}
              onSubmit={post}
              onPasteFiles={addFiles}
              placeholder="Write something…"
              ariaLabel="New journal entry"
            />
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="-ml-1.5">
              <AttachButton onFiles={addFiles} />
            </div>
            <div className="flex items-center gap-2">
              {progress !== null && progress < 1 && <span className="text-xs tabular-nums text-muted">{Math.round(progress * 100)}%</span>}
              <button
                type="button"
                onClick={post}
                disabled={!canPost}
                aria-label="Post"
                title="Post (⌘/Ctrl + Enter)"
                className="flex size-8 items-center justify-center rounded-full bg-ink text-paper transition-opacity disabled:opacity-20"
              >
                <ArrowUp size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
