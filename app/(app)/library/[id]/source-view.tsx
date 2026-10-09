"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import { MAX_UPLOAD_BYTES, type GroupRefDto, type SourceDto } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";
import { upload } from "@/lib/upload-client";
import { deleteSource, removeSourcePdf, saveSourceNotes, setSourceInGroup, updateSourceDetails, type ActionResult } from "../actions";
import { typeLabel } from "../library-view";
import { SourceFields } from "../source-fields";
import { SourceSummaryPanel } from "./source-summary";

function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

export function SourceView({ source, allGroups }: { source: SourceDto; allGroups: GroupRefDto[] }) {
  if (source.problem) {
    return (
      <div className="mt-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
        <p className="font-medium">This source&apos;s file can&apos;t be read.</p>
        <p className="mt-1 text-muted">
          The frontmatter in <code>sources/{source.id}.md</code> has an error ({source.problem}). Fix it in a text
          editor; the app won&apos;t change the file until then.
        </p>
      </div>
    );
  }
  return (
    <article className="mt-4 space-y-12">
      <Details source={source} />
      <PdfSection source={source} />
      <NotesSection source={source} />
      <SourceSummaryPanel source={source} />
      <GroupsSection source={source} allGroups={allGroups} />
      <DeleteSection source={source} />
    </article>
  );
}

function ErrorText({ result }: { result: ActionResult | null }) {
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-danger">
      {result.error}
    </p>
  );
}

function Details({ source }: { source: SourceDto }) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const r = await updateSourceDetails(source.id, form);
            setResult(r);
            if (r.ok) {
              changed();
              setEditing(false);
            }
          });
        }}
      >
        <SourceFields source={source} />
        <ErrorText result={result} />
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={ui.btnPrimary}>
            {pending ? "Saving…" : "Save details"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={ui.btnGhost}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <header>
      <h1 className="font-serif text-[1.9rem] leading-tight tracking-tight">{source.title}</h1>
      <dl className="mt-3 space-y-1 text-[15px]">
        {source.authors.length > 0 && (
          <div>
            <dt className="sr-only">Authors</dt>
            <dd>{source.authors.join("; ")}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          {source.year && <span className="tabular-nums">{source.year}</span>}
          <span className={ui.badge}>{typeLabel(source.type)}</span>
          <span className="text-xs text-faint">Added {formatShortDate(source.added)}</span>
        </div>
        {source.url && (
          <div className="pt-1">
            <dt className="sr-only">Link</dt>
            <dd>
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline decoration-1 underline-offset-2">
                {source.url.replace(/^https?:\/\//, "")} ↗
              </a>
            </dd>
          </div>
        )}
      </dl>
      <button type="button" onClick={() => setEditing(true)} className={`${ui.btnGhost} -ml-2 mt-2`}>
        Edit details
      </button>
    </header>
  );
}

function PdfSection({ source }: { source: SourceDto }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function uploadPdf(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is larger than 50 MB.`);
      return;
    }
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.set("pdf", file, file.name);
    try {
      await upload(`/api/upload/sources/${encodeURIComponent(source.id)}/pdf`, form, setProgress);
      changed();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  const picker = (label: string) => (
    <label className={`${ui.btnSecondary} cursor-pointer`}>
      {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : label}
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        disabled={progress !== null}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadPdf(file);
        }}
      />
    </label>
  );

  return (
    <section aria-labelledby="pdf-heading">
      <h2 id="pdf-heading" className={`${ui.h2} mb-3`}>
        PDF
      </h2>
      {source.pdf ? (
        <>
          <div className="overflow-hidden rounded-lg border border-rule bg-surface">
            <iframe
              key={source.updated}
              src={source.pdf.url}
              title={`PDF of ${source.title}`}
              className="h-[75vh] w-full"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={source.pdf.url} target="_blank" rel="noopener" className={ui.btnSecondary}>
              Open in new tab
            </a>
            <a href={source.pdf.downloadUrl} className={ui.btnSecondary}>
              Download
            </a>
            {picker("Replace PDF")}
            {confirmRemove ? (
              <span className="flex items-center gap-2 text-sm">
                Remove the PDF?
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await removeSourcePdf(source.id);
                      if (r.ok) changed();
                      else setError(r.error);
                      setConfirmRemove(false);
                    })
                  }
                  className={ui.btnDanger}
                >
                  Remove
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} className={ui.btnGhost}>
                Remove PDF
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>No PDF attached.</span>
          {picker("Upload PDF")}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function NotesSection({ source }: { source: SourceDto }) {
  const [notes, setNotes] = useState(source.notes);
  const { state, error, flush } = useAutosave(notes, async (value) => {
    const r = await saveSourceNotes(source.id, value);
    if (r.ok) changed();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading" className={`${ui.h2} mb-3`}>
        My notes
      </h2>
      <MarkdownEditor
        value={notes}
        onChange={setNotes}
        placeholder="Notes in Markdown. Saved automatically."
        minRows={6}
        toolbar={<span className="text-xs"><SaveStatus state={state} error={error} onRetry={() => void flush()} /></span>}
        textareaProps={{ "aria-label": "My notes", onBlur: () => void flush() }}
      />
    </section>
  );
}

function GroupsSection({ source, allGroups }: { source: SourceDto; allGroups: GroupRefDto[] }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const memberIds = new Set(source.groups.map((g) => g.id));
  const available = allGroups.filter((g) => !memberIds.has(g.id));

  function toggle(groupId: string, member: boolean) {
    start(async () => {
      const r = await setSourceInGroup(source.id, groupId, member);
      setResult(r);
      if (r.ok) changed();
    });
  }

  return (
    <section aria-labelledby="groups-heading">
      <h2 id="groups-heading" className={`${ui.h2} mb-3`}>
        Reading groups
      </h2>
      {source.groups.length ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {source.groups.map((g) => (
            <li key={g.id} className="flex items-center rounded-full border border-rule bg-surface text-sm">
              <a href={`/groups/${g.id}`} className="py-1 pl-3 pr-1 hover:underline">
                {g.title}
              </a>
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(g.id, false)}
                aria-label={`Remove from ${g.title}`}
                className="rounded-full px-2 py-1 text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted">Not in any group yet.</p>
      )}
      {available.length > 0 && (
        <select
          value=""
          disabled={pending}
          onChange={(e) => e.target.value && toggle(e.target.value, true)}
          aria-label="Add to a group"
          className={`${ui.input} max-w-xs`}
        >
          <option value="">Add to a group…</option>
          {available.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      )}
      <ErrorText result={result} />
    </section>
  );
}

function DeleteSection({ source }: { source: SourceDto }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="border-t border-rule pt-6">
      {confirming ? (
        <div role="alertdialog" aria-label="Delete source" className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm">
          <p>
            Delete <strong>{source.title}</strong>
            {source.pdf ? " and its PDF" : ""}? It will also be removed from{" "}
            {source.groups.length ? `${source.groups.length} group${source.groups.length === 1 ? "" : "s"}` : "any groups"}. Its history stays in Git.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  changed();
                  setResult(await deleteSource(source.id));
                })
              }
              className={ui.btnDanger}
            >
              {pending ? "Deleting…" : "Delete source"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={ui.btnGhost}>
              Cancel
            </button>
          </div>
          <ErrorText result={result} />
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-sm text-muted hover:text-danger">
          Delete source…
        </button>
      )}
    </section>
  );
}
