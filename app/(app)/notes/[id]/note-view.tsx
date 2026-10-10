"use client";

import { Paperclip, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { InlineTitle, useInlineSave } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { SummaryPanel } from "@/components/summary-panel";
import { CONTENT_CHANGED_EVENT } from "@/components/content-events";
import { ui } from "@/components/ui";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import type { NoteDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";
import { upload } from "@/lib/upload-client";
import { AttachmentList, toPending } from "../../journal/attachments";
import { deleteNote, renameNote, saveNoteText, type ActionResult } from "../actions";

function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

export function NoteView({ note }: { note: NoteDto }) {
  if (note.problem) {
    return (
      <div className="mt-6 rounded-md bg-warn/10 px-4 py-3 text-sm">
        <p className="font-medium">This note&apos;s file can&apos;t be read.</p>
        <p className="mt-1 text-muted">
          The frontmatter in <code>notes/{note.id}.md</code> has an error ({note.problem}). Fix it in a text editor;
          the app won&apos;t change the file until then.
        </p>
      </div>
    );
  }
  return (
    <article className="mt-4 space-y-10">
      <Header note={note} />
      <NoteText note={note} />
      <Attachments note={note} />
      <SummaryPanel
        endpoint={`/api/ai/note/${encodeURIComponent(note.id)}`}
        summary={note.aiSummary}
        headingId="summary-heading"
        emptyHint="Generate a summary of this note and any PDFs attached to it: its main points, key ideas, and how it connects to your research."
      />
    </article>
  );
}

/** Title (renamed in place; the file name never changes), then one quiet line of details. */
function Header({ note }: { note: NoteDto }) {
  const { save, label, isError } = useInlineSave();
  const dot = <span aria-hidden="true" className="px-0.5 text-faint">·</span>;
  return (
    <header>
      <h1 className="sr-only">{note.title}</h1>
      <InlineTitle
        value={note.title}
        ariaLabel="Note title"
        onSave={(title) =>
          void save(async () => {
            const r = await renameNote(note.id, title);
            if (r.ok) changed();
            return r;
          })
        }
      />
      <div className="mt-1 flex flex-wrap items-center gap-y-1 text-[13px] text-faint">
        <span className="whitespace-nowrap">Created {formatShortDate(note.created)}</span>
        {note.updated !== note.created && (
          <>
            {dot}
            <span className="whitespace-nowrap px-1.5">Updated {formatShortDate(note.updated)}</span>
          </>
        )}
        <span className="ml-auto">
          <DeleteControl note={note} />
        </span>
      </div>
      {label && (
        <p role={isError ? "alert" : "status"} className={`mt-1 text-xs ${isError ? "text-danger" : "text-faint"}`}>
          {label}
        </p>
      )}
    </header>
  );
}

function DeleteControl({ note }: { note: NoteDto }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const files = note.attachments.length;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setConfirming((c) => !c)}
        aria-label="Delete note…"
        aria-expanded={confirming}
        title="Delete note"
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {confirming && (
        <div
          role="alertdialog"
          aria-label="Delete note"
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg bg-surface p-4 text-sm text-ink shadow-lg shadow-black/10 ring-1 ring-rule"
        >
          <p>
            Delete <strong>{note.title}</strong>
            {files ? ` and its ${files} attachment${files === 1 ? "" : "s"}` : ""}? This can&apos;t be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  changed();
                  setResult(await deleteNote(note.id));
                })
              }
              className={ui.btnDanger}
            >
              {pending ? "Deleting…" : "Delete note"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={ui.btnGhost}>
              Cancel
            </button>
          </div>
          {result && !result.ok && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {result.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NoteText({ note }: { note: NoteDto }) {
  const [text, setText] = useState(note.text);
  const { state, error, flush } = useAutosave(text, async (value) => {
    const r = await saveNoteText(note.id, value);
    if (r.ok) changed();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  return (
    <section aria-labelledby="note-heading">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id="note-heading" className={ui.h2}>
          Note
        </h2>
        <span className="text-xs">
          <SaveStatus state={state} error={error} onRetry={() => void flush()} />
        </span>
      </div>
      <LiveEditor
        value={text}
        onChange={setText}
        onBlur={() => void flush()}
        placeholder="Write your note…"
        ariaLabel="Note"
        className="min-h-40"
      />
    </section>
  );
}

/** Files attached to the note: added straight away, removed after a confirmation. */
function Attachments({ note }: { note: NoteDto }) {
  const [attachments, setAttachments] = useState(note.attachments);
  const [prev, setPrev] = useState(note.attachments);
  if (prev !== note.attachments) {
    setPrev(note.attachments);
    setAttachments(note.attachments);
  }
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(form: FormData) {
    setError(null);
    setProgress(0);
    try {
      const updated = await upload<NoteDto>(`/api/upload/notes/${encodeURIComponent(note.id)}`, form, setProgress);
      setAttachments(updated.attachments);
      changed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setProgress(null);
    }
  }

  function add(list: FileList) {
    const { accepted, rejected } = toPending(list);
    if (rejected.length) setError(`Too large (over 50 MB): ${rejected.join(", ")}`);
    if (!accepted.length) return;
    const form = new FormData();
    for (const p of accepted) form.append("files", p.file, p.file.name);
    void send(form);
  }

  function remove(file: string) {
    const form = new FormData();
    form.append("remove", file);
    void send(form);
  }

  return (
    <section aria-labelledby="attachments-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="attachments-heading" className={ui.h2}>
          Attachments
        </h2>
        <label className={`${ui.btnAction} relative cursor-pointer`}>
          <Paperclip size={14} strokeWidth={1.7} aria-hidden="true" />
          {progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : "Add files"}
          <input
            type="file"
            multiple
            disabled={progress !== null}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {attachments.length ? (
        <AttachmentList attachments={attachments} onRemove={remove} />
      ) : (
        <p className="text-sm text-faint">Files you add appear here.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
