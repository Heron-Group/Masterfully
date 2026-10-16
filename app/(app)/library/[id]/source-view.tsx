"use client";

import { Archive, ArrowLeft, ArrowRight, BookOpen, Download, FilePlus2, FileText, Globe, Link2, Pencil, StickyNote, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { InlineAutoText, InlineSelectText, InlineTitle, PropertyRow, useInlineSave } from "@/components/inline-fields";
import { GroupTags } from "@/components/group-tags";
import { ArchivedBar } from "@/components/archive";
import { SourceBadges } from "@/components/source-badges";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { ReaderPanel, type ReaderTab } from "@/components/reader-panel";
import { CONTENT_CHANGED_EVENT } from "@/components/content-events";
import { ui } from "@/components/ui";
import { SaveStatus, useAutosave } from "@/components/use-autosave";
import { MAX_UPLOAD_BYTES, SOURCE_TYPE_OPTIONS, type GroupRefDto, type ReferenceDto, type SourceDto, type SourcePdfDto, type SourceType } from "@/lib/dto";
import { extractSourceLinks } from "@/lib/map/graph";
import { formatShortDate } from "@/lib/time";
import { upload } from "@/lib/upload-client";
import {
  deleteSource,
  removeSourcePdf,
  saveSourceNotes,
  setSourceArchived,
  setSourceInGroup,
  setSourceLink,
  fillSourceDetails,
  undoFilledDetails,
  updateSourceProps,
  type ActionResult,
  type FillResult,
  type SourceProps,
} from "../actions";
import { createGroup } from "../../groups/actions";
import { SourceSummaryPanel } from "./source-summary";

function changed() {
  window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
}

export type ReadKind = ReaderTab["key"];

/** Short names for the reading panel's tabs when there are several of a kind. */
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
export const tabKey = (kind: "pdf" | "link", i: number) => (i === 0 ? kind : `${kind}-${i + 1}`);

function readerTabs(source: SourceDto): ReaderTab[] {
  const tabs: ReaderTab[] = [];
  source.pdfs.forEach((pdf, i) =>
    tabs.push({
      key: tabKey("pdf", i),
      kind: "pdf",
      label: source.pdfs.length > 1 ? pdf.name : "PDF",
      src: pdf.url,
      openUrl: pdf.url,
      downloadUrl: pdf.downloadUrl,
    }),
  );
  source.links.forEach((link, i) =>
    tabs.push({
      key: tabKey("link", i),
      kind: "link",
      label: source.links.length > 1 ? host(link) : "Web page",
      src: `/api/reader/${encodeURIComponent(source.id)}${i ? `?n=${i}` : ""}`,
      openUrl: link,
    }),
  );
  return tabs;
}

/** Which PDF or link to read details from (index into source.pdfs / source.links). */
type DetailsTarget = { kind: "pdf" | "link"; index: number };
type Filling = { status: "reading" } | { status: "filled"; result: Extract<FillResult, { ok: true }> } | null;

export function SourceView({
  source,
  allGroups,
  referencedBy = [],
  sourceTitles = {},
  initialRead,
  fillOnOpen = false,
}: {
  source: SourceDto;
  allGroups: GroupRefDto[];
  referencedBy?: ReferenceDto[];
  /** Every source's title by id, for the References list (which follows the notes as they're typed). */
  sourceTitles?: Record<string, string>;
  initialRead?: ReadKind;
  /** Just created with a PDF or link: fill in its details straight away. */
  fillOnOpen?: boolean;
}) {
  const tabs = readerTabs(source);
  const [notes, setNotes] = useState(source.notes);
  const [filling, setFilling] = useState<Filling>(fillOnOpen ? { status: "reading" } : null);
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

  /**
   * Fill in any details the user hasn't set themselves from a PDF or link
   * (the one just added, or all of them). Says what changed, with Undo;
   * says nothing if nothing changed.
   */
  const show = (r: FillResult) => {
    if (r.ok && r.filled.length) {
      changed();
      setFilling({ status: "filled", result: r });
    } else setFilling(null);
  };
  async function fill(target?: DetailsTarget) {
    setFilling({ status: "reading" });
    show(await fillSourceDetails(source.id, target));
  }

  useEffect(() => {
    if (!fillOnOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("fill");
    window.history.replaceState(window.history.state, "", url);
    void fillSourceDetails(source.id).then((r) => {
      if (r.ok && r.filled.length) {
        changed();
        setFilling({ status: "filled", result: r });
      } else setFilling(null);
    });
  }, [fillOnOpen, source.id]);

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
        <div>
          {source.archived && (
            <ArchivedBar
              archived={source.archived}
              what="source"
              onUnarchive={async () => {
                const r = await setSourceArchived(source.id, false);
                if (r.ok) changed();
                return r;
              }}
            />
          )}
          <Details source={source} />
          {filling && <FilledNote sourceId={source.id} state={filling} onClose={() => setFilling(null)} />}
        </div>
        <MaterialSection
          source={source}
          reading={open}
          onRead={setReading}
          onAdded={(target) => void fill(target)}
        />
        <NotesSection source={source} onChange={setNotes} />
        <Connections sourceId={source.id} notes={notes} sourceTitles={sourceTitles} referencedBy={referencedBy} />
        <section aria-labelledby="groups-heading">
          <h2 id="groups-heading" className={`${ui.h2} mb-3`}>
            Reading groups
          </h2>
          <SourceGroupTags source={source} allGroups={allGroups} />
        </section>
        <SourceSummaryPanel source={source} />
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

/** Title, then the details as a labelled list (each edited in place). */
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
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <InlineTitle value={source.title} onSave={(title) => void update({ title })} ariaLabel="Title" />
        </div>
        <div className="flex items-center pt-2.5">
          {!source.archived && <ArchiveControl source={source} />}
          <DeleteControl source={source} />
        </div>
      </div>
      <div className="mt-3 text-muted [&_label]:text-[13px]" role="group" aria-label="Details">
        <PropertyRow label="Authors">
          <InlineAutoText
            value={source.authors.join("; ")}
            onSave={(v) => void update({ authors: v.split(";") })}
            placeholder="Add authors"
            ariaLabel="Authors"
            title="Authors — separate several with a semicolon"
            className="-ml-1.5 text-sm text-ink"
          />
        </PropertyRow>
        <PropertyRow label="Year">
          <InlineAutoText
            value={source.year ? String(source.year) : ""}
            onSave={(year) => void update({ year })}
            placeholder="Add year"
            ariaLabel="Year"
            inputMode="numeric"
            className="-ml-1.5 text-sm tabular-nums text-ink"
          />
        </PropertyRow>
        <PropertyRow label="Type">
          <InlineSelectText<SourceType>
            value={source.type}
            options={SOURCE_TYPE_OPTIONS}
            onSave={(type) => void update({ type })}
            ariaLabel="Type"
            className="-ml-1.5 text-sm text-ink"
          />
        </PropertyRow>
        <PropertyRow label="Added">
          <span className="flex flex-wrap items-center gap-2 py-0.5 text-sm text-muted">
            {formatShortDate(source.added)}
            <SourceBadges summarised={!!source.aiSummary} annotated={false} />
          </span>
        </PropertyRow>
      </div>
      {label && (
        <p role={isError ? "alert" : "status"} className={`mt-1 text-xs ${isError ? "text-danger" : "text-faint"}`}>
          {label}
        </p>
      )}
    </header>
  );
}

const FIELD_LABELS = { title: "title", authors: "authors", year: "year", type: "type" } as const;

/** "authors, year and type" */
function listFields(fields: string[]): string {
  return fields.length > 1 ? `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}` : (fields[0] ?? "");
}

/** While details are read, then what was filled in from where, with Undo. */
function FilledNote({ sourceId, state, onClose }: { sourceId: string; state: NonNullable<Filling>; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (state.status === "reading") {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <Wand2 size={14} strokeWidth={1.7} className="animate-pulse text-accent" aria-hidden="true" />
        Reading the source&apos;s details…
      </p>
    );
  }
  const { from, filled, previous } = state.result;
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-accent-soft/60 px-3 py-2 text-[13px]">
      <Wand2 size={14} strokeWidth={1.7} className="shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Filled in the {listFields(filled.map((f) => FIELD_LABELS[f.field]))} from {from}.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await undoFilledDetails(sourceId, previous);
            if (!r.ok) return setError(r.error);
            changed();
            onClose();
          })
        }
        className="rounded px-1.5 py-0.5 font-medium text-ink underline underline-offset-2 hover:bg-accent-soft"
      >
        Undo
      </button>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 text-faint hover:text-ink">
        <X size={14} aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="w-full text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** What this source's notes link to, and what links here: sources and notes, as links to open them. */
function Connections({
  sourceId,
  notes,
  sourceTitles,
  referencedBy,
}: {
  sourceId: string;
  notes: string;
  sourceTitles: Record<string, string>;
  referencedBy: ReferenceDto[];
}) {
  const references = useMemo(() => {
    const seen = new Set<string>();
    const out: ReferenceDto[] = [];
    for (const { to, label } of extractSourceLinks(notes)) {
      if (to === sourceId || seen.has(to)) continue;
      seen.add(to);
      // A source made from the "/" menu since the page loaded: its link's words stand in for the title.
      out.push({ kind: "source", id: to, title: sourceTitles[to] ?? label ?? to });
    }
    return out;
  }, [notes, sourceId, sourceTitles]);
  return (
    <section aria-labelledby="connections-heading">
      <h2 id="connections-heading" className={`${ui.h2} mb-3`}>
        Connections
      </h2>
      <div className="space-y-3">
        <ReferenceList
          label="References"
          icon={ArrowRight}
          items={references}
          empty="No sources yet."
        />
        <ReferenceList label="Referenced by" icon={ArrowLeft} items={referencedBy} empty="Nothing links here yet." />
      </div>
    </section>
  );
}

function ReferenceList({ label, icon: Arrow, items, empty }: { label: string; icon: typeof ArrowRight; items: ReferenceDto[]; empty: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-x-3 sm:grid-cols-[8rem_1fr]" role="group" aria-label={label}>
      <span className="flex items-center gap-1.5 py-1 text-[13px] text-muted">
        <Arrow size={13} strokeWidth={1.7} aria-hidden="true" />
        {label}
      </span>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5 text-[13px]">
          {items.map((r) => {
            const Icon = r.kind === "source" ? BookOpen : StickyNote;
            return (
              <Link
                key={`${r.kind}:${r.id}`}
                href={r.kind === "source" ? `/library/${r.id}` : `/notes/${r.id}`}
                title={r.kind === "source" ? "Open source" : "Open note"}
                className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md bg-accent-soft/70 px-2 py-1 text-ink transition-colors hover:bg-accent-soft"
              >
                <Icon size={13} strokeWidth={1.7} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">{r.title}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="py-1 text-[13px] text-faint">{empty}</p>
      )}
    </div>
  );
}

/** The source's reading groups as tags; changes show at once and save in the background. */
function SourceGroupTags({ source, allGroups }: { source: SourceDto; allGroups: GroupRefDto[] }) {
  const [groups, setGroups] = useState(allGroups);
  const [selected, setSelected] = useState(source.groups);
  const [prev, setPrev] = useState({ source: source.groups, all: allGroups });
  if (prev.source !== source.groups || prev.all !== allGroups) {
    // The server sent fresh data (after a save): follow it.
    setPrev({ source: source.groups, all: allGroups });
    setSelected(source.groups);
    setGroups(allGroups);
  }
  const [error, setError] = useState<string | null>(null);

  async function save(change: () => Promise<ActionResult>, undo: () => void) {
    setError(null);
    const r = await change();
    if (r.ok) changed();
    else {
      undo();
      setError(r.error);
    }
  }

  return (
    <>
      <GroupTags
        selected={selected}
        all={groups}
        onAdd={(id) => {
          const g = groups.find((x) => x.id === id);
          if (!g) return;
          setSelected((l) => [...l, g]);
          void save(() => setSourceInGroup(source.id, id, true), () => setSelected((l) => l.filter((x) => x.id !== id)));
        }}
        onRemove={(id) => {
          const before = selected;
          setSelected((l) => l.filter((x) => x.id !== id));
          void save(() => setSourceInGroup(source.id, id, false), () => setSelected(before));
        }}
        onCreate={(title) => {
          void (async () => {
            setError(null);
            const r = await createGroup(title);
            if (!r.ok) return setError(r.error);
            const g = { id: r.id, title };
            setGroups((l) => [...l, g]);
            setSelected((l) => [...l, g]);
            await save(() => setSourceInGroup(source.id, r.id, true), () => setSelected((l) => l.filter((x) => x.id !== r.id)));
          })();
        }}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/** Archive icon beside delete: hides the source from the library, groups and map (Unarchive brings it back). */
function ArchiveControl({ source }: { source: SourceDto }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setSourceArchived(source.id, true);
            if (r.ok) changed();
            else setError(r.error);
          })
        }
        aria-label="Archive source"
        title="Archive: hide from your library, groups and map (nothing is deleted)"
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-accent-soft hover:text-ink"
      >
        <Archive size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
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
            {source.pdfs.length ? ` and its ${source.pdfs.length === 1 ? "PDF" : `${source.pdfs.length} PDFs`}` : ""}? It will also be removed from{" "}
            {source.groups.length ? `${source.groups.length} group${source.groups.length === 1 ? "" : "s"}` : "any groups"}. This can&apos;t be undone.
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
/** "Read PDF" / "Read web page": opens it beside your notes. */
function ReadButton({ kind, label, reading, onRead }: { kind: ReadKind; label: string; reading: ReadKind | null; onRead: (k: ReadKind | null) => void }) {
  const open = reading === kind;
  const Icon = kind.startsWith("pdf") ? BookOpen : Globe;
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

type ReadProps = { reading: ReadKind | null; onRead: (k: ReadKind | null) => void };

/** The source itself: any number of PDFs and links, each readable beside your notes. */
function MaterialSection({ source, reading, onRead, onAdded }: { source: SourceDto; onAdded: (target: DetailsTarget) => void } & ReadProps) {
  const router = useRouter();
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadPdfs(files: File[]) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (pdfs.length < files.length) setError("Only PDF files can be added here.");
    else setError(null);
    // New PDFs go at the end of the list; details are read from the first one added.
    let next = source.pdfs.length;
    let offered = false;
    for (const file of pdfs) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`"${file.name}" is larger than 50 MB.`);
        continue;
      }
      setUploads((u) => [...u, { name: file.name, progress: 0 }]);
      const form = new FormData();
      form.set("pdf", file, file.name);
      try {
        await upload(`/api/upload/sources/${encodeURIComponent(source.id)}/pdf`, form, (p) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x))),
        );
        changed();
        router.refresh();
        if (!offered) onAdded({ kind: "pdf", index: next });
        offered = true;
        next++;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
  }

  const add = "-mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[15px] transition-colors hover:bg-accent-soft/70 hover:text-ink";
  return (
    <section
      aria-labelledby="material-heading"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void uploadPdfs([...e.dataTransfer.files]);
      }}
    >
      <h2 id="material-heading" className={`${ui.h2} mb-2`}>
        PDFs and links
      </h2>
      <div className="divide-y divide-rule/70">
        {source.pdfs.map((pdf, i) => (
          <PdfRow key={pdf.file} source={source} pdf={pdf} kind={tabKey("pdf", i)} reading={reading} onRead={onRead} />
        ))}
        {source.links.map((link, i) => (
          <LinkRow key={link} source={source} link={link} kind={tabKey("link", i)} reading={reading} onRead={onRead} onSaved={() => onAdded({ kind: "link", index: i })} />
        ))}
        {uploads.map((u) => (
          <p key={u.name} className="py-2.5 text-sm text-muted">
            Uploading {u.name} · {Math.round(u.progress * 100)}%…
          </p>
        ))}
        {addingLink && (
          <LinkRow
            source={source}
            reading={reading}
            onRead={onRead}
            onDone={() => setAddingLink(false)}
            onSaved={() => onAdded({ kind: "link", index: source.links.length })}
          />
        )}
        <div className="flex flex-wrap gap-x-4 py-2">
          <label className={`${add} ${dragging ? "bg-accent-soft text-ink" : "text-faint"}`}>
            <FilePlus2 size={17} strokeWidth={1.6} aria-hidden="true" />
            Add a PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                void uploadPdfs(files);
              }}
            />
          </label>
          <button type="button" onClick={() => setAddingLink(true)} className={`${add} text-faint`}>
            <Link2 size={17} strokeWidth={1.6} aria-hidden="true" />
            Add a link
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function PdfRow({ source, pdf, kind, reading, onRead }: { source: SourceDto; pdf: SourcePdfDto; kind: ReadKind } & ReadProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <FileText size={17} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onRead(kind)}
          title="Read alongside your notes"
          className="min-w-[10rem] flex-1 truncate text-left text-[15px] text-ink hover:underline hover:decoration-rule hover:underline-offset-4"
        >
          {pdf.name}
        </button>
        <div className="flex items-center gap-0.5">
          <ReadButton kind={kind} label="PDF" reading={reading} onRead={onRead} />
          <a href={pdf.downloadUrl} className={iconButton} title="Download" aria-label={`Download ${pdf.name}`}>
            <Download size={15} aria-hidden="true" />
          </a>
          <button type="button" onClick={() => setConfirmRemove(true)} className={iconButton} title="Remove PDF" aria-label={`Remove ${pdf.name}`}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {confirmRemove && (
        <div role="alertdialog" aria-label="Remove PDF" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">Remove {pdf.name} from this source?</span>
          <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (reading === kind) onRead(null);
                const r = await removeSourcePdf(source.id, pdf.file);
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

/** One link: shown, edited in place, or removed. Without `link` it's the "Add a link" field. */
function LinkRow({
  source,
  link,
  kind,
  reading,
  onRead,
  onDone,
  onSaved,
}: { source: SourceDto; link?: string; kind?: ReadKind; onDone?: () => void; onSaved?: () => void } & ReadProps) {
  const [editing, setEditing] = useState(!link);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [draft, setDraft] = useState(link ?? "");
  const { save, label, isError } = useInlineSave();

  async function commit(value: string) {
    const to = value.trim();
    setEditing(false);
    if (to === (link ?? "")) return onDone?.();
    if (!to && !link) return onDone?.();
    await save(async () => {
      const r = await setSourceLink(source.id, { from: link, to });
      if (r.ok) {
        changed();
        onDone?.();
        // A new or changed link (not a removal): offer its details.
        if (to) onSaved?.();
      } else setEditing(true);
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
                setDraft(link ?? "");
                setEditing(false);
                if (!link) onDone?.();
              }
            }}
            placeholder="https://"
            aria-label="Link"
            className="-mx-1.5 min-w-0 flex-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
      ) : link && kind ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Globe size={17} strokeWidth={1.6} className="shrink-0 text-muted" aria-hidden="true" />
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            title={link}
            className="min-w-[10rem] flex-1 truncate text-[15px] text-accent-text underline decoration-1 underline-offset-2"
          >
            {link.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
          <div className="flex items-center gap-0.5">
            <ReadButton kind={kind} label="web page" reading={reading} onRead={onRead} />
            <button
              type="button"
              onClick={() => {
                setDraft(link);
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
      ) : null}
      {confirmRemove && (
        <div role="alertdialog" aria-label="Remove link" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger/5 px-3 py-2 text-sm">
          <span className="mr-auto">Remove this link from the source?</span>
          <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmRemove(false);
              if (reading === kind) onRead(null);
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

function NotesSection({ source, onChange }: { source: SourceDto; onChange: (notes: string) => void }) {
  const [notes, setNotesState] = useState(source.notes);
  const setNotes = (value: string) => {
    setNotesState(value);
    onChange(value);
  };
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
