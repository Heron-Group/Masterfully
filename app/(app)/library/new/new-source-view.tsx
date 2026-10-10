"use client";

import { FilePlus2, FileText, Globe, Link2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  InlineAutoText,
  InlineSelectText,
  InlineTitle,
} from "@/components/inline-fields";
import { GroupTags } from "@/components/group-tags";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/content-events";
import { ui } from "@/components/ui";
import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  SOURCE_TYPE_OPTIONS,
  type GroupRefDto,
  type SourceType,
} from "@/lib/dto";
import { upload } from "@/lib/upload-client";
import {
  saveSourceNotes,
  setSourceInGroup,
  updateSourceProps,
  type SourceProps,
} from "../actions";
import { createGroup } from "../../groups/actions";

const iconButton =
  "rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink";

/**
 * The same layout as a source page, but blank. Everything can be filled in
 * straight away; nothing is saved until the source has a title. Then it is
 * created with everything entered so far. Later changes on this page save to
 * it directly, and once you're not in the middle of a field the page becomes
 * the source's own page, so nothing typed is lost.
 */
export function NewSourceView({
  groups,
  preselectedGroup,
}: {
  groups: GroupRefDto[];
  preselectedGroup?: string;
}) {
  const router = useRouter();
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [type, setType] = useState<SourceType>("article");
  const [url, setUrl] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [inGroups, setInGroups] = useState<string[]>(
    preselectedGroup ? [preselectedGroup] : [],
  );
  const [allGroups, setAllGroups] = useState(groups);
  const notes = useRef("");
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const article = useRef<HTMLElement>(null);
  const pending = useRef(0);

  /** Move to the real source page once nothing is being edited or saved. */
  const maybeOpen = useCallback(() => {
    if (!createdId || pending.current) return;
    const active = document.activeElement as HTMLElement | null;
    const editing =
      !!active &&
      !!article.current?.contains(active) &&
      active.matches("input, textarea, select, [contenteditable=true]");
    if (!editing) router.replace(`/library/${createdId}`);
  }, [createdId, router]);

  useEffect(() => {
    if (!createdId) return;
    maybeOpen();
    const onFocusOut = () => setTimeout(maybeOpen, 0);
    const el = article.current;
    el?.addEventListener("focusout", onFocusOut);
    return () => el?.removeEventListener("focusout", onFocusOut);
  }, [createdId, maybeOpen]);

  /** After creation, save a change straight to the source. */
  async function persist(
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
  ) {
    if (!createdId) return;
    pending.current++;
    try {
      const r = await fn(createdId);
      if (!r.ok) setError(r.error ?? "Couldn't save.");
    } finally {
      pending.current--;
      maybeOpen();
    }
  }
  const setProp = (props: SourceProps, local: () => void) => {
    local();
    void persist((id) => updateSourceProps(id, props));
  };

  async function create(title: string) {
    if (creating || !title.trim()) return;
    setCreating(true);
    setError(null);
    const form = new FormData();
    form.set("title", title);
    form.set(
      "authors",
      authors
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean)
        .join("\n"),
    );
    form.set("year", year);
    form.set("type", type);
    form.set("url", url);
    form.set("notes", notes.current);
    for (const g of inGroups) form.append("groups", g);
    if (pdf) form.set("pdf", pdf, pdf.name);
    try {
      const { id } = await upload<{ id: string }>(
        "/api/upload/sources",
        form,
        pdf ? setProgress : undefined,
      );
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      setCreatedId(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't create the source.",
      );
      setCreating(false);
      setProgress(null);
    }
  }

  const status =
    error ??
    (createdId
      ? "Saved"
      : creating
        ? progress !== null && progress < 1
          ? `Uploading ${Math.round(progress * 100)}%…`
          : "Creating…"
        : "Give the source a title to save it");
  const dot = (
    <span aria-hidden="true" className="px-0.5 text-faint">
      ·
    </span>
  );

  return (
    <article ref={article} className="mt-4 space-y-10">
      <header>
        <h1 className="sr-only">New source</h1>
        <InlineTitle
          value=""
          onSave={(t) => void create(t)}
          ariaLabel="Title"
          autoFocus
        />
        <div className="mt-1 flex flex-wrap items-center gap-y-1 text-[13px] text-muted">
          <InlineAutoText
            value={authors}
            onSave={(v) =>
              setProp({ authors: v.split(";") }, () => setAuthors(v))
            }
            placeholder="Authors"
            ariaLabel="Authors"
            title="Authors — separate several with a semicolon"
            className="-ml-1.5"
          />
          {dot}
          <InlineAutoText
            value={year}
            onSave={(v) => setProp({ year: v }, () => setYear(v))}
            placeholder="Year"
            ariaLabel="Year"
            inputMode="numeric"
            className="tabular-nums"
          />
          {dot}
          <InlineSelectText<SourceType>
            value={type}
            options={SOURCE_TYPE_OPTIONS}
            onSave={(v) => setProp({ type: v }, () => setType(v))}
            ariaLabel="Type"
          />
          {dot}
          <span
            className={`px-1.5 ${error ? "text-danger" : "text-faint"}`}
            role={error ? "alert" : "status"}
          >
            {status}
          </span>
        </div>
        <div className="mt-2.5">
          <GroupTags
            selected={allGroups.filter((g) => inGroups.includes(g.id))}
            all={allGroups}
            linkTags={false}
            onAdd={(gid) => {
              setInGroups((l) => [...l, gid]);
              void persist((sid) => setSourceInGroup(sid, gid, true));
            }}
            onRemove={(gid) => {
              setInGroups((l) => l.filter((x) => x !== gid));
              void persist((sid) => setSourceInGroup(sid, gid, false));
            }}
            onCreate={(title) => {
              void (async () => {
                const r = await createGroup(title);
                if (!r.ok) return setError(r.error);
                setAllGroups((l) => [...l, { id: r.id, title }]);
                setInGroups((l) => [...l, r.id]);
                void persist((sid) => setSourceInGroup(sid, r.id, true));
              })();
            }}
          />
        </div>
      </header>

      <section aria-labelledby="material-heading">
        <h2 id="material-heading" className={`${ui.h2} mb-2`}>
          PDF and link
        </h2>
        <div className="divide-y divide-rule/70">
          <PdfDraftRow
            file={pdf}
            onFile={(f) => {
              setPdf(f);
              if (f && createdId) {
                const form = new FormData();
                form.set("pdf", f, f.name);
                void persist((id) =>
                  upload(
                    `/api/upload/sources/${encodeURIComponent(id)}/pdf`,
                    form,
                  ).then(() => ({ ok: true })),
                );
              }
            }}
            onError={setError}
          />
          <LinkDraftRow
            url={url}
            onUrl={(u) => setProp({ url: u }, () => setUrl(u))}
          />
        </div>
      </section>

      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading" className={`${ui.h2} mb-3`}>
          My notes
        </h2>
        <LiveEditor
          value=""
          onChange={(v) => (notes.current = v)}
          onBlur={() =>
            void persist((id) => saveSourceNotes(id, notes.current))
          }
          placeholder="Write your notes…"
          ariaLabel="My notes"
          className="min-h-24"
        />
      </section>

    </article>
  );
}

function PdfDraftRow({
  file,
  onFile,
  onError,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onError: (e: string | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const choose = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES)
      return onError(`"${f.name}" is larger than 50 MB.`);
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf")
      return onError(`"${f.name}" isn't a PDF.`);
    onError(null);
    onFile(f);
  };
  return (
    <div
      className="py-2.5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        choose(e.dataTransfer.files[0]);
      }}
    >
      {file ? (
        <div className="flex items-center gap-2">
          <FileText
            size={17}
            strokeWidth={1.6}
            className="shrink-0 text-muted"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
            {file.name}
          </span>
          <span className="text-xs text-faint">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => onFile(null)}
            className={iconButton}
            title="Remove PDF"
            aria-label="Remove PDF"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <label
          className={`-mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[15px] transition-colors hover:bg-accent-soft/70 hover:text-ink ${dragging ? "bg-accent-soft text-ink" : "text-faint"}`}
        >
          <FilePlus2 size={17} strokeWidth={1.6} aria-hidden="true" />
          Add a PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

function LinkDraftRow({
  url,
  onUrl,
}: {
  url: string;
  onUrl: (u: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url);
  return (
    <div className="py-2.5">
      {editing ? (
        <div className="flex items-center gap-2">
          <Link2
            size={17}
            strokeWidth={1.6}
            className="shrink-0 text-muted"
            aria-hidden="true"
          />
          <input
            autoFocus
            type="url"
            inputMode="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onUrl(draft.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(url);
                setEditing(false);
              }
            }}
            placeholder="https://"
            aria-label="Link"
            className="-mx-1.5 min-w-0 flex-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[15px] text-ink placeholder:text-faint focus:outline-none"
          />
        </div>
      ) : url ? (
        <div className="flex items-center gap-2">
          <Globe
            size={17}
            strokeWidth={1.6}
            className="shrink-0 text-muted"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-[15px] text-accent-text underline decoration-1 underline-offset-2"
          >
            {url.replace(/^https?:\/\/(www\.)?/, "")}
          </button>
          <button
            type="button"
            onClick={() => onUrl("")}
            className={iconButton}
            title="Remove link"
            aria-label="Remove link"
          >
            <X size={15} aria-hidden="true" />
          </button>
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
    </div>
  );
}
