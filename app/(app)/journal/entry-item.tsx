"use client";

import { memo, useEffect, useRef, useState } from "react";
import { LiveEditor, type LiveEditorHandle } from "@/components/live-editor/live-editor";
import { Markdown } from "@/components/markdown";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
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
 * One journal entry. Click the text to edit it in place; it saves when you
 * click away (or Cmd/Ctrl+Enter, or Escape). Files can be added or removed
 * directly.
 */
export const EntryItem = memo(function EntryItem({ entry, onUpdated, onDeleted }: Props) {
  const [editing, setEditing] = useState<{ x: number; y: number } | "end" | null>(null);
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

  return (
    <article id={`entry-${entry.id}`} data-entry-id={entry.id} className="group relative scroll-mt-16 py-3">
      <header className="mb-1 flex min-h-6 items-center gap-2 text-xs text-faint">
        <time dateTime={entry.created} title={`${formatShortDate(entry.created)} ${formatTime(entry.created)}`} className="tabular-nums text-muted">
          {formatTime(entry.created)}
        </time>
        {edited && <span title={`Edited ${formatShortDate(entry.updated)} ${formatTime(entry.updated)}`}>edited</span>}
        {busy && <span>{busy}</span>}
        <span className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {!entry.body && !editing && !entry.problem && (
            <button type="button" onClick={() => setEditing("end")} className="rounded px-1.5 py-0.5 hover:bg-accent-soft hover:text-ink">
              Add text
            </button>
          )}
          {!entry.problem && <AttachButton label="Attach files" onFiles={attach} />}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded px-1.5 py-0.5 hover:bg-accent-soft hover:text-danger"
          >
            Delete
          </button>
        </span>
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
          focusAt={editing}
          onDone={(updated) => {
            setEditing(null);
            if (updated) {
              changed();
              onUpdated(updated);
            }
          }}
        />
      ) : (
        entry.body && (
          <div
            onClick={(e) => {
              if (entry.problem) return;
              const target = e.target as HTMLElement;
              if (target.closest("a, button, input, img")) return;
              if (window.getSelection()?.toString()) return; // selecting text to copy
              setEditing({ x: e.clientX, y: e.clientY });
            }}
            className={entry.problem ? "" : "cursor-text"}
          >
            <Markdown>{entry.body}</Markdown>
          </div>
        )
      )}

      <AttachmentList
        attachments={entry.attachments}
        onRemove={
          entry.problem
            ? undefined
            : (file) =>
                run("Removing…", async () => {
                  const updated = await saveEntry(entry.id, { remove: [file] });
                  changed();
                  onUpdated(updated);
                })
        }
      />

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

/** The entry's text as a live editor; saves on leaving it. */
function EntryEditor({
  entry,
  focusAt,
  onDone,
}: {
  entry: EntryDto;
  focusAt: { x: number; y: number } | "end";
  onDone: (updated: EntryDto | null) => void;
}) {
  const editor = useRef<LiveEditorHandle>(null);
  const [text, setText] = useState(entry.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(entry.body);

  useEffect(() => {
    editor.current?.focus(focusAt);
    // Focus once, where the entry was clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish() {
    const body = latest.current;
    if (body.trim() === entry.body.trim()) {
      onDone(null);
      return;
    }
    if (!body.trim() && !entry.attachments.length) {
      setError("An entry needs some text or an attachment. To remove it, use Delete.");
      editor.current?.focus("end");
      return;
    }
    setSaving(true);
    try {
      onDone(await saveEntry(entry.id, { body }));
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? `${err.message} Your text is still here.` : "Couldn't save. Your text is still here.");
    }
  }

  return (
    <div>
      <LiveEditor
        ref={editor}
        value={text}
        onChange={(v) => {
          latest.current = v;
          setText(v);
        }}
        onBlur={() => void finish()}
        onSubmit={() => void finish()}
        onEscape={() => void finish()}
        ariaLabel="Edit journal entry"
        placeholder="Write something…"
      />
      {(saving || error) && (
        <p role={error ? "alert" : undefined} className={`mt-1 text-xs ${error ? "text-danger" : "text-faint"}`}>
          {error ?? "Saving…"}
        </p>
      )}
    </div>
  );
}
