"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { LiveEditor, type LiveEditorHandle } from "@/components/live-editor/live-editor";
import { Markdown } from "@/components/markdown";
import { CONTENT_CHANGED_EVENT } from "@/components/content-events";
import type { EntryDto } from "@/lib/dto";
import { formatShortDate, formatTime } from "@/lib/time";
import { jsonFetch, upload } from "@/lib/upload-client";
import { AttachButton, AttachmentList, toPending } from "./attachments";

type Props = {
  entry: EntryDto;
  onUpdated: (entry: EntryDto) => void;
  onDeleted: (id: string) => void;
};

function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

/** Save the entry's text and/or attachment changes. */
function saveEntry(id: string, parts: { body?: string; remove?: string[]; files?: File[] }, onProgress?: (f: number) => void) {
  const form = new FormData();
  if (parts.body !== undefined) form.set("body", parts.body);
  for (const file of parts.remove ?? []) form.append("remove", file);
  for (const f of parts.files ?? []) form.append("files", f, f.name);
  return upload<EntryDto>(`/api/upload/journal/${encodeURIComponent(id)}`, form, onProgress);
}

/**
 * One journal entry. The pencil opens it for editing (text, plus adding or
 * removing files); the bin deletes it after a confirmation.
 */
export const EntryItem = memo(function EntryItem({ entry, onUpdated, onDeleted }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edited = entry.updated !== entry.created;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const attach = (list: FileList) => {
    const { accepted, rejected } = toPending(list);
    if (rejected.length) setError(`Too large (over 50 MB): ${rejected.join(", ")}`);
    if (!accepted.length) return;
    void run("Uploading…", async () => {
      const updated = await saveEntry(entry.id, { files: accepted.map((p) => p.file) });
      changed();
      onUpdated(updated);
    });
  };

  const icon = "rounded-md p-1.5 text-faint transition-colors hover:bg-accent-soft";

  return (
    <article id={`entry-${entry.id}`} data-entry-id={entry.id} className="group relative scroll-mt-16 py-3">
      <header className="mb-1 flex min-h-7 items-center gap-2 text-xs text-faint">
        <time dateTime={entry.created} title={`${formatShortDate(entry.created)} ${formatTime(entry.created)}`} className="tabular-nums text-muted">
          {formatTime(entry.created)}
        </time>
        {edited && <span title={`Edited ${formatShortDate(entry.updated)} ${formatTime(entry.updated)}`}>edited</span>}
        {busy && <span>{busy}</span>}
        {!editing && (
          <span className="ml-auto flex items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {!entry.problem && (
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit entry" title="Edit" className={`${icon} hover:text-ink`}>
                <Pencil size={15} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete entry" title="Delete" className={`${icon} hover:text-danger`}>
              <Trash2 size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </span>
        )}
      </header>

      {entry.problem && (
        <p className="mb-2 rounded-md bg-warn/10 px-3 py-2 text-sm text-ink">
          This entry&apos;s frontmatter can&apos;t be read, so it&apos;s shown as raw text and can&apos;t be edited here.
          Fix it in a text editor. ({entry.problem})
        </p>
      )}

      {editing ? (
        <EntryEditor
          entry={entry}
          onSaved={(updated) => {
            changed();
            onUpdated(updated);
          }}
          onDone={() => setEditing(false)}
        />
      ) : (
        entry.body && <Markdown>{entry.body}</Markdown>
      )}

      <AttachmentList
        attachments={entry.attachments}
        onRemove={
          editing
            ? (file) =>
                run("Removing…", async () => {
                  const updated = await saveEntry(entry.id, { remove: [file] });
                  changed();
                  onUpdated(updated);
                })
            : undefined
        }
      />

      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <div className="-ml-1.5">
            <AttachButton label="Attach files" onFiles={attach} />
          </div>
          <span className="mr-auto hidden text-xs text-faint sm:inline">⌘/Ctrl + B bold · I italic · K link</span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-sm font-medium text-paper"
          >
            <Check size={15} aria-hidden="true" />
            Done
          </button>
        </div>
      )}

      {confirmDelete && (
        <div role="alertdialog" aria-label="Delete entry" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">
            Delete this entry{entry.attachments.length ? ` and its ${entry.attachments.length} attachment${entry.attachments.length === 1 ? "" : "s"}` : ""}?
          </span>
          <button type="button" onClick={() => setConfirmDelete(false)} disabled={!!busy} className="rounded px-2.5 py-1 text-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("Deleting…", async () => {
                await jsonFetch(`/api/journal/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
                changed();
                onDeleted(entry.id);
              })
            }
            className="rounded bg-danger px-2.5 py-1 font-medium text-paper disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </article>
  );
});

/**
 * The entry's text as a live editor. Saves whenever you click away (so
 * nothing is lost) and finishes on Done, Escape or Cmd/Ctrl+Enter.
 */
function EntryEditor({
  entry,
  onSaved,
  onDone,
}: {
  entry: EntryDto;
  onSaved: (updated: EntryDto) => void;
  onDone: () => void;
}) {
  const editor = useRef<LiveEditorHandle>(null);
  const [text, setText] = useState(entry.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(entry.body);
  const saved = useRef(entry.body);

  useEffect(() => {
    editor.current?.focus("end");
  }, []);

  const inflight = useRef<Promise<boolean> | null>(null);

  // Blur, Done and closing can all ask to save at once; share one request.
  function save(): Promise<boolean> {
    inflight.current ??= doSave().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }

  async function doSave(): Promise<boolean> {
    const body = latest.current;
    if (body.trim() === saved.current.trim()) return true;
    if (!body.trim() && !entry.attachments.length) {
      setError("An entry needs some text or an attachment. To remove it, use Delete.");
      return false;
    }
    setSaving(true);
    try {
      const updated = await saveEntry(entry.id, { body });
      saved.current = body;
      setError(null);
      onSaved(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? `${err.message} Your text is still here.` : "Couldn't save. Your text is still here.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Save when the entry closes (Done), as well as on blur.
  useEffect(() => () => void save(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    if (await save()) onDone();
  };

  return (
    <div>
      <LiveEditor
        ref={editor}
        value={text}
        onChange={(v) => {
          latest.current = v;
          setText(v);
        }}
        onBlur={() => void save()}
        onSubmit={() => void finish()}
        onEscape={() => void finish()}
        ariaLabel="Edit journal entry"
        placeholder="Write something…"
        className="-mx-2 rounded-md bg-accent-soft/40 px-2 py-1"
      />
      {(saving || error) && (
        <p role={error ? "alert" : undefined} className={`mt-1 text-xs ${error ? "text-danger" : "text-faint"}`}>
          {error ?? "Saving…"}
        </p>
      )}
    </div>
  );
}
