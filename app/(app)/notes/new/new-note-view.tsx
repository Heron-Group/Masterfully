"use client";

import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { InlineTitle } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import type { NoteDto } from "@/lib/dto";
import { upload } from "@/lib/upload-client";
import { PendingFiles, releasePending, toPending, type PendingFile } from "../../journal/attachments";
import { saveNoteText } from "../actions";

/**
 * The same layout as a note page, but blank. Text and files can be added
 * straight away; nothing is saved until the note has a title. Then it is
 * created with everything so far, and once you're not typing in the page it
 * becomes the note's own page (saving anything typed in the meantime).
 */
export function NewNoteView() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; text: string } | null>(null);
  const textRef = useRef("");
  const article = useRef<HTMLElement>(null);

  /** Open the real note page once nothing on this page is being edited. */
  const maybeOpen = useCallback(async () => {
    if (!created) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && article.current?.contains(active) && active.matches("input, textarea, [contenteditable=true]")) return;
    if (textRef.current.trim() !== created.text.trim()) {
      const r = await saveNoteText(created.id, textRef.current);
      if (!r.ok) return setError(r.error);
    }
    router.replace(`/notes/${created.id}`);
  }, [created, router]);

  useEffect(() => {
    if (!created) return;
    void maybeOpen();
    const onFocusOut = () => setTimeout(() => void maybeOpen(), 0);
    const el = article.current;
    el?.addEventListener("focusout", onFocusOut);
    return () => el?.removeEventListener("focusout", onFocusOut);
  }, [created, maybeOpen]);

  async function create(title: string) {
    if (creating || created) return;
    setCreating(true);
    setError(null);
    const form = new FormData();
    form.set("title", title);
    form.set("text", textRef.current);
    for (const p of files) form.append("files", p.file, p.file.name);
    try {
      const note = await upload<NoteDto>("/api/upload/notes", form, files.length ? setProgress : undefined);
      releasePending(files);
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      setCreated({ id: note.id, text: note.text });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Nothing was saved.");
      setCreating(false);
    } finally {
      setProgress(null);
    }
  }

  function addFiles(list: FileList | File[]) {
    const { accepted, rejected } = toPending(list);
    setError(rejected.length ? `Too large (over 50 MB): ${rejected.join(", ")}` : null);
    setFiles((f) => [...f, ...accepted]);
  }

  const status =
    error ??
    (created
      ? "Saved"
      : creating
        ? progress !== null && progress < 1
          ? `Uploading ${Math.round(progress * 100)}%…`
          : "Creating…"
        : "Give the note a title to save it");

  return (
    <article ref={article} className="mt-4 space-y-10">
      <header>
        <h1 className="sr-only">New note</h1>
        <InlineTitle value="" onSave={(t) => void create(t)} ariaLabel="Note title" autoFocus />
        <p className={`mt-1 text-[13px] ${error ? "text-danger" : "text-faint"}`} role={error ? "alert" : "status"}>
          {status}
        </p>
      </header>

      <section aria-labelledby="note-heading">
        <h2 id="note-heading" className={`${ui.h2} mb-3`}>
          Note
        </h2>
        <LiveEditor
          value={text}
          onChange={(v) => {
            textRef.current = v;
            setText(v);
          }}
          onPasteFiles={created ? undefined : addFiles}
          placeholder="Write your note…"
          ariaLabel="Note"
          className="min-h-40"
        />
      </section>

      <section aria-labelledby="attachments-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="attachments-heading" className={ui.h2}>
            Attachments
          </h2>
          {!created && (
            <label className={`${ui.btnAction} relative cursor-pointer`}>
              <Paperclip size={14} strokeWidth={1.7} aria-hidden="true" />
              Add files
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        {files.length ? (
          <PendingFiles
            files={files}
            onRemove={(id) =>
              setFiles((fs) => {
                releasePending(fs.filter((f) => f.id === id));
                return fs.filter((f) => f.id !== id);
              })
            }
          />
        ) : (
          <p className="text-sm text-faint">Images, PDFs and other files you add appear here.</p>
        )}
      </section>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className={`${ui.h2} mb-3`}>
          AI summary
        </h2>
        <p className="text-sm text-faint">Once the note is saved, you can generate a summary of it here.</p>
      </section>
    </article>
  );
}
