"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InlineSelect, InlineText, InlineTitle, PropertyRow, useInlineSave } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import { MAX_UPLOAD_BYTES, SOURCE_TYPE_OPTIONS, type GroupRefDto, type SourceDto, type SourceType } from "@/lib/dto";
import { formatShortDate } from "@/lib/time";
import { upload } from "@/lib/upload-client";
import { deleteSource, removeSourcePdf, saveSourceNotes, setSourceInGroup, updateSourceProps, type ActionResult, type SourceProps } from "../actions";
import { SourceSummaryPanel } from "./source-summary";

function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

export function SourceView({ source, allGroups }: { source: SourceDto; allGroups: GroupRefDto[] }) {
  if (source.problem) {
    return (
      <div className="mt-6 rounded-md bg-warn/10 px-4 py-3 text-sm">
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

/** Title and properties, edited in place like a Notion page. */
function Details({ source }: { source: SourceDto }) {
  const { save, label, isError } = useInlineSave();
  const update = (props: SourceProps) =>
    save(async () => {
      const r = await updateSourceProps(source.id, props);
      if (r.ok) changed();
      return r;
    });

  return (
    <header>
      <h1 className="sr-only">{source.title}</h1>
      <InlineTitle value={source.title} onSave={(title) => void update({ title })} ariaLabel="Title" />
      <div className="mt-4 space-y-0.5">
        <PropertyRow label="Authors" htmlFor="prop-authors">
          <InlineText
            id="prop-authors"
            multiline
            value={source.authors.join("\n")}
            onSave={(v) => void update({ authors: v.split(/\r?\n/) })}
            placeholder="Surname, Firstname — one per line"
            ariaLabel="Authors"
          />
        </PropertyRow>
        <PropertyRow label="Year" htmlFor="prop-year">
          <InlineText id="prop-year" value={source.year ? String(source.year) : ""} onSave={(year) => void update({ year })} inputMode="numeric" ariaLabel="Year" className="tabular-nums" />
        </PropertyRow>
        <PropertyRow label="Type" htmlFor="prop-type">
          <InlineSelect<SourceType> id="prop-type" value={source.type} options={SOURCE_TYPE_OPTIONS} onSave={(type) => void update({ type })} ariaLabel="Type" />
        </PropertyRow>
        <PropertyRow label="Link" htmlFor="prop-url">
          <div className="flex items-center gap-1">
            <InlineText id="prop-url" value={source.url ?? ""} onSave={(url) => void update({ url })} inputMode="url" placeholder="https://" ariaLabel="Link" className="truncate text-accent" />
            {source.url && (
              <a href={source.url} target="_blank" rel="noopener noreferrer" title="Open link in a new tab" aria-label="Open link in a new tab" className="shrink-0 rounded px-1.5 text-muted hover:text-ink">
                ↗
              </a>
            )}
          </div>
        </PropertyRow>
        <PropertyRow label="Added">
          <span className="block px-0 py-0.5 text-muted">{formatShortDate(source.added)}</span>
        </PropertyRow>
      </div>
      <p role={isError ? "alert" : "status"} className={`mt-1 h-4 text-xs ${isError ? "text-danger" : "text-faint"}`}>
        {label}
      </p>
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
          <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-rule/60">
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
      <div className="mb-3 flex items-baseline gap-3">
        <h2 id="notes-heading" className={ui.h2}>
          My notes
        </h2>
        <span className="text-xs">
          <SaveStatus state={state} error={error} onRetry={() => void flush()} />
        </span>
      </div>
      <LiveEditor
        value={notes}
        onChange={setNotes}
        onBlur={() => void flush()}
        placeholder="Write your notes…"
        ariaLabel="My notes"
        className="min-h-24"
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
            <li key={g.id} className="flex items-center rounded-full bg-accent-soft/70 text-sm">
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
        <div role="alertdialog" aria-label="Delete source" className="rounded-md bg-danger/5 p-4 text-sm">
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
