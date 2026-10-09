"use client";

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
    <div role="region" aria-label="New entry" className="border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-3xl px-4 pb-3 pt-3">
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        )}
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
        <div className="flex items-end gap-2">
          <div className="max-h-[40vh] min-w-0 flex-1 overflow-y-auto py-1">
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
          <AttachButton onFiles={addFiles} />
          <button
            type="button"
            onClick={post}
            disabled={!canPost}
            title="Post (⌘/Ctrl + Enter)"
            className="mb-1 rounded-full bg-ink px-3.5 py-1 text-sm font-medium text-paper transition-opacity disabled:opacity-25"
          >
            {posting ? (progress !== null && progress < 1 ? `${Math.round(progress * 100)}%` : "Posting…") : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
