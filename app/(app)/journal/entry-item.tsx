"use client";

import { memo, useState } from "react";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import type { EntryDto } from "@/lib/dto";
import { formatShortDate, formatTime } from "@/lib/time";
import { jsonFetch, upload } from "@/lib/upload-client";
import { AttachButton, AttachmentList, PendingFiles, releasePending, toPending, type PendingFile } from "./attachments";

type Props = {
  entry: EntryDto;
  onUpdated: (entry: EntryDto) => void;
  onDeleted: (id: string) => void;
};

export const EntryItem = memo(function EntryItem({ entry, onUpdated, onDeleted }: Props) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = entry.updated !== entry.created;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await jsonFetch(`/api/journal/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      onDeleted(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the entry.");
      setBusy(false);
    }
  }

  return (
    <article id={`entry-${entry.id}`} data-entry-id={entry.id} className="group relative scroll-mt-16 py-3">
      <header className="mb-1 flex items-baseline gap-2 text-xs text-faint">
        <time dateTime={entry.created} title={`${formatShortDate(entry.created)} ${formatTime(entry.created)}`} className="tabular-nums text-muted">
          {formatTime(entry.created)}
        </time>
        {edited && <span title={`Edited ${formatShortDate(entry.updated)} ${formatTime(entry.updated)}`}>edited</span>}
        {mode === "view" && (
          <span className="ml-auto flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            {!entry.problem && (
              <button type="button" onClick={() => setMode("edit")} className="rounded px-1.5 py-0.5 hover:bg-accent-soft hover:text-ink">
                Edit
              </button>
            )}
            <button type="button" onClick={() => setMode("confirm-delete")} className="rounded px-1.5 py-0.5 hover:bg-accent-soft hover:text-danger">
              Delete
            </button>
          </span>
        )}
      </header>

      {entry.problem && (
        <p className="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink">
          This entry&apos;s frontmatter can&apos;t be read, so it&apos;s shown as raw text and can&apos;t be edited here.
          Fix it in a text editor. ({entry.problem})
        </p>
      )}

      {mode === "edit" ? (
        <EntryEditor
          entry={entry}
          onCancel={() => setMode("view")}
          onSaved={(e) => {
            setMode("view");
            onUpdated(e);
          }}
        />
      ) : (
        <>
          {entry.body && <Markdown>{entry.body}</Markdown>}
          <AttachmentList attachments={entry.attachments} />
        </>
      )}

      {mode === "confirm-delete" && (
        <div role="alertdialog" aria-label="Delete entry" className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">
            Delete this entry{entry.attachments.length ? ` and its ${entry.attachments.length} attachment${entry.attachments.length === 1 ? "" : "s"}` : ""}?
          </span>
          <button type="button" onClick={() => setMode("view")} disabled={busy} className="rounded px-2.5 py-1 text-muted hover:text-ink">
            Cancel
          </button>
          <button type="button" onClick={remove} disabled={busy} className="rounded bg-danger px-2.5 py-1 font-medium text-paper disabled:opacity-60">
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </article>
  );
});

function EntryEditor({ entry, onCancel, onSaved }: { entry: EntryDto; onCancel: () => void; onSaved: (e: EntryDto) => void }) {
  const [body, setBody] = useState(entry.body);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<PendingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = entry.attachments.length - removed.size + added.length;
  const canSave = !saving && (!!body.trim() || remaining > 0);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set("body", body);
    for (const file of removed) form.append("remove", file);
    for (const p of added) form.append("files", p.file, p.file.name);
    try {
      const updated = await upload<EntryDto>(`/api/upload/journal/${encodeURIComponent(entry.id)}`, form, added.length ? setProgress : undefined);
      releasePending(added);
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the entry.");
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2">
      <MarkdownEditor value={body} onChange={setBody} onSubmit={save} autoFocus minRows={3} maxHeight="60vh" />
      {entry.attachments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {entry.attachments.map((a) => {
            const isRemoved = removed.has(a.file);
            return (
              <li key={a.file} className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 truncate ${isRemoved ? "text-faint line-through" : ""}`}>{a.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setRemoved((r) => {
                      const next = new Set(r);
                      if (isRemoved) next.delete(a.file);
                      else next.add(a.file);
                      return next;
                    })
                  }
                  className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-ink"
                >
                  {isRemoved ? "Keep" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PendingFiles files={added} onRemove={(id) => setAdded((fs) => fs.filter((f) => f.id !== id))} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <AttachButton
          label="Add files"
          onFiles={(list) => {
            const { accepted, rejected } = toPending(list);
            setAdded((a) => [...a, ...accepted]);
            setError(rejected.length ? `Too large (over 50 MB): ${rejected.join(", ")}` : null);
          }}
        />
        <span className="mr-auto text-xs text-faint">⌘/Ctrl + Enter to save</span>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded px-2.5 py-1 text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <button type="button" onClick={save} disabled={!canSave} className="rounded bg-ink px-3 py-1 text-sm font-medium text-paper disabled:opacity-40">
          {saving ? (progress !== null && progress < 1 ? `${Math.round(progress * 100)}%` : "Saving…") : "Save"}
        </button>
      </div>
    </div>
  );
}
