"use client";

import { BookOpen, Download, ExternalLink, FilePlus2, FileText, Globe, Link2, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { InlineAutoText, InlineSelectText, InlineTitle, useInlineSave } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { ReaderPanel, type ReaderTab } from "@/components/reader-panel";
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

export type ReadKind = ReaderTab["key"];

function readerTabs(source: SourceDto): ReaderTab[] {
  const tabs: ReaderTab[] = [];
  if (source.pdf) {
    tabs.push({ key: "pdf", label: "PDF", src: source.pdf.url, openUrl: source.pdf.url, downloadUrl: source.pdf.downloadUrl });
  }
  if (source.url) {
    tabs.push({ key: "link", label: "Web page", src: `/api/reader/${encodeURIComponent(source.id)}`, openUrl: source.url });
  }
  return tabs;
}

export function SourceView({
  source,
  allGroups,
  initialRead,
}: {
  source: SourceDto;
  allGroups: GroupRefDto[];
  initialRead?: ReadKind;
}) {
  const tabs = readerTabs(source);
  const [reading, setReadingState] = useState<ReadKind | null>(
    initialRead && tabs.some((t) => t.key === initialRead) ? initialRead : null,
  );
  // Keep ?read= in the address so a refresh (or a link from the library) reopens the panel.
  const setReading = useCallback((kind: ReadKind | null) => {
    setReadingState(kind);
    const url = new URL(window.location.href);
    if (kind) url.searchParams.set("read", kind);
    else url.searchParams.delete("read");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const close = useCallback(() => setReading(null), [setReading]);
  // Close the panel if what it shows is removed.
  const open = reading && tabs.some((t) => t.key === reading) ? reading : null;

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
    <>
      <article className="mt-4 space-y-10">
        <Details source={source} />
        <MaterialSection source={source} reading={open} onRead={setReading} />
        <NotesSection source={source} />
        <SourceSummaryPanel source={source} />
        <GroupsSection source={source} allGroups={allGroups} />
      </article>
      {open && <ReaderPanel title={source.title} tabs={tabs} active={open} onTab={setReading} onClose={close} />}
    </>
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

/** Title, then one quiet line of details (edited in place) with delete. */
function Details({ source }: { source: SourceDto }) {
  const { save, label, isError } = useInlineSave();
  const update = (props: SourceProps) =>
    save(async () => {
      const r = await updateSourceProps(source.id, props);
      if (r.ok) changed();
      return r;
    });
  const dot = <span aria-hidden="true" className="px-0.5 text-faint">·</span>;

  return (
    <header>
      <h1 className="sr-only">{source.title}</h1>
      <InlineTitle value={source.title} onSave={(title) => void update({ title })} ariaLabel="Title" />
      <div className="mt-1 flex flex-wrap items-center gap-y-1 text-[13px] text-muted">
        <InlineAutoText
          value={source.authors.join("; ")}
          onSave={(v) => void update({ authors: v.split(";") })}
          placeholder="Authors"
          ariaLabel="Authors"
          title="Authors — separate several with a semicolon"
          className="-ml-1.5"
        />
        {dot}
        <InlineAutoText
          value={source.year ? String(source.year) : ""}
          onSave={(year) => void update({ year })}
          placeholder="Year"
          ariaLabel="Year"
          inputMode="numeric"
          className="tabular-nums"
        />
        {dot}
        <InlineSelectText<SourceType>
          value={source.type}
          options={SOURCE_TYPE_OPTIONS}
          onSave={(type) => void update({ type })}
          ariaLabel="Type"
        />
        {dot}
        <span className="px-1.5 text-faint" title="Date added">
          Added {formatShortDate(source.added)}
        </span>
        <span className="ml-auto">
          <DeleteControl source={source} />
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

/** Bin icon in the details block; asks before deleting. */
function DeleteControl({ source }: { source: SourceDto }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setConfirming((c) => !c)}
        aria-label="Delete source…"
        aria-expanded={confirming}
        title="Delete source"
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {confirming && (
        <div role="alertdialog" aria-label="Delete source" className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg bg-surface p-4 text-sm shadow-lg shadow-black/10 ring-1 ring-rule">
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
      )}
    </div>
  );
}

/** The "Read PDF" / "Read web page" button: opens it beside your notes. */
function ReadButton({ kind, label, reading, onRead }: { kind: ReadKind; label: string; reading: ReadKind | null; onRead: (k: ReadKind | null) => void }) {
  const open = reading === kind;
  const Icon = kind === "pdf" ? BookOpen : Globe;
  return (
    <button
      type="button"
      onClick={() => onRead(open ? null : kind)}
      aria-pressed={open}
      className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
        open ? "bg-ink text-paper" : "bg-accent-soft/70 text-ink hover:bg-accent-soft"
      }`}
    >
      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
      {open ? `Close ${label}` : `Read ${label}`}
    </button>
  );
}

const iconButton = "rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink";

/** The source itself: add a PDF or a link, then read it alongside your notes. */
function MaterialSection({ source, reading, onRead }: { source: SourceDto; reading: ReadKind | null; onRead: (k: ReadKind | null) => void }) {
  return (
    <section aria-labelledby="material-heading">
      <h2 id="material-heading" className={`${ui.h2} mb-2`}>
        PDF and link
      </h2>
      <div className="divide-y divide-rule/70">
        <PdfRow source={source} reading={reading} onRead={onRead} />
        <LinkRow source={source} reading={reading} onRead={onRead} />
      </div>
    </section>
  );
}

function PdfRow({ source, reading, onRead }: { source: SourceDto; reading: ReadKind | null; onRead: (k: ReadKind | null) => void }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function uploadPdf(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError(`"${file.name}" is larger than 50 MB.`);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setError(`"${file.name}" isn't a PDF.`);
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

  const fileInput = (
    <input
      type="file"
      accept="application/pdf,.pdf"
      className="sr-only"
      disabled={progress !== null}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        void uploadPdf(file);
      }}
    />
  );
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void uploadPdf(e.dataTransfer.files[0]);
    },
  };

  return (
    <div className="py-2.5" {...dropProps}>
      {source.pdf ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <FileText size={17} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onRead("pdf")}
            title="Read alongside your notes"
            className="min-w-[10rem] flex-1 truncate text-left text-[15px] text-ink hover:underline hover:decoration-rule hover:underline-offset-4"
          >
            {source.pdf.name}
          </button>
          <div className="flex items-center gap-0.5">
            <ReadButton kind="pdf" label="PDF" reading={reading} onRead={onRead} />
            <a href={source.pdf.url} target="_blank" rel="noopener" className={iconButton} title="Open in a new tab" aria-label="Open the PDF in a new tab">
              <ExternalLink size={15} aria-hidden="true" />
            </a>
            <a href={source.pdf.downloadUrl} className={iconButton} title="Download" aria-label="Download the PDF">
              <Download size={15} aria-hidden="true" />
            </a>
            <label className={`${iconButton} cursor-pointer`} title="Replace PDF" aria-label="Replace PDF">
              <FilePlus2 size={15} aria-hidden="true" />
              {fileInput}
            </label>
            <button type="button" onClick={() => setConfirmRemove(true)} className={iconButton} title="Remove PDF" aria-label="Remove PDF">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`-mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[15px] transition-colors hover:bg-accent-soft/70 hover:text-ink ${dragging ? "bg-accent-soft text-ink" : "text-faint"}`}
        >
          <FilePlus2 size={17} strokeWidth={1.6} aria-hidden="true" />
          Add a PDF
          {fileInput}
        </label>
      )}
      {progress !== null && <p className="mt-1 text-xs text-muted">Uploading {Math.round(progress * 100)}%…</p>}
      {confirmRemove && (
        <div role="alertdialog" aria-label="Remove PDF" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">Remove the PDF from this source?</span>
          <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
            Cancel
          </button>
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
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function LinkRow({ source, reading, onRead }: { source: SourceDto; reading: ReadKind | null; onRead: (k: ReadKind | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draft, setDraft] = useState(source.url ?? "");
  const { save, label, isError } = useInlineSave();

  async function commit(value: string) {
    setEditing(false);
    if (value.trim() === (source.url ?? "")) return;
    await save(async () => {
      const r = await updateSourceProps(source.id, { url: value });
      if (r.ok) changed();
      else setEditing(true);
      return r;
    });
  }

  return (
    <div className="py-2.5">
      {editing ? (
        <div className="flex items-center gap-2">
          <Link2 size={17} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            autoFocus
            type="url"
            inputMode="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(source.url ?? "");
                setEditing(false);
              }
            }}
            placeholder="https://"
            aria-label="Link"
            className="-mx-1.5 min-w-0 flex-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
      ) : source.url ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Globe size={17} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden="true" />
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.url}
            className="min-w-[10rem] flex-1 truncate text-[15px] text-accent underline decoration-1 underline-offset-2"
          >
            {source.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
          <div className="flex items-center gap-0.5">
            <ReadButton kind="link" label="web page" reading={reading} onRead={onRead} />
            <button
              type="button"
              onClick={() => {
                setDraft(source.url ?? "");
                setEditing(true);
              }}
              className={iconButton}
              title="Edit link"
              aria-label="Edit link"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setConfirmRemove(true)} className={iconButton} title="Remove link" aria-label="Remove link">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="-mx-1.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[15px] text-faint transition-colors hover:bg-accent-soft/70 hover:text-ink"
        >
          <Link2 size={17} strokeWidth={1.6} aria-hidden="true" />
          Add a link
        </button>
      )}
      {confirmRemove && (
        <div role="alertdialog" aria-label="Remove link" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">Remove the link from this source?</span>
          <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmRemove(false);
              void commit("");
            }}
            className={ui.btnDanger}
          >
            Remove
          </button>
        </div>
      )}
      {label && (
        <p role={isError ? "alert" : "status"} className={`mt-1 text-xs ${isError ? "text-danger" : "text-faint"}`}>
          {label}
        </p>
      )}
    </div>
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
