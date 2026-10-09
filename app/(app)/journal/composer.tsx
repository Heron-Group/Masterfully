"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AutoTextarea } from "@/components/markdown-editor";
import { Markdown } from "@/components/markdown";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import type { EntryDto } from "@/lib/dto";
import { upload } from "@/lib/upload-client";
import { AttachButton, PendingFiles, releasePending, toPending, type PendingFile } from "./attachments";

const DRAFT_KEY = "rp:journal-draft";

export type ComposerHandle = { addFiles: (files: Iterable<File>) => void; focus: () => void };

/**
 * Fixed to the bottom of the journal. Enter adds a line, Cmd/Ctrl+Enter or
 * Post saves. The text draft survives a reload (files can't be kept by the
 * browser, so those are lost on reload).
 */
export function Composer({ onPosted, ref }: { onPosted: (entry: EntryDto) => void; ref?: Ref<ComposerHandle> }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [preview, setPreview] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore draft after hydration
      if (draft) setText(draft);
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
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

  useImperativeHandle(ref, () => ({ addFiles, focus: () => textarea.current?.focus() }));

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
      setPreview(false);
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
    <div className="border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto max-w-3xl px-3 pb-2 pt-2 sm:px-4">
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
        <div
          className="flex items-end gap-1 rounded-xl border border-rule bg-surface py-1 pl-1 pr-1.5 focus-within:border-accent"
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              addFiles(pasted);
            }
          }}
        >
          <AttachButton onFiles={addFiles} />
          <div className="min-w-0 flex-1 py-1">
            {preview ? (
              <div className="max-h-[40vh] overflow-y-auto px-1 py-0.5">
                {text.trim() ? <Markdown>{text}</Markdown> : <p className="text-sm text-faint">Nothing to preview.</p>}
              </div>
            ) : (
              <AutoTextarea
                ref={textarea}
                value={text}
                onChange={setText}
                onSubmit={post}
                placeholder="Write a note…"
                aria-label="New journal entry"
                maxHeight="40vh"
                className="block w-full resize-none bg-transparent px-1 py-0.5 font-serif text-[17px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            aria-pressed={preview}
            title={preview ? "Back to writing" : "Preview Markdown"}
            className={`mb-0.5 hidden rounded px-2 py-1.5 text-xs transition-colors sm:block ${preview ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"}`}
          >
            {preview ? "Write" : "Preview"}
          </button>
          <button
            type="button"
            onClick={post}
            disabled={!canPost}
            title="Post (⌘/Ctrl + Enter)"
            className="mb-0.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper transition-opacity disabled:opacity-30"
          >
            {posting ? (progress !== null && progress < 1 ? `${Math.round(progress * 100)}%` : "Posting…") : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
