"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AutoTextarea } from "@/components/auto-textarea";
import { fieldBase, PropertyRow } from "@/components/inline-fields";
import { LiveEditor } from "@/components/live-editor/live-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { formatBytes, MAX_UPLOAD_BYTES, SOURCE_TYPE_OPTIONS, type GroupRefDto } from "@/lib/dto";
import { upload } from "@/lib/upload-client";

/** A new source laid out like the page it will become. */
export function NewSourceForm({ groups, preselectedGroup }: { groups: GroupRefDto[]; preselectedGroup?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [notes, setNotes] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choosePdf(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) setError(`"${file.name}" is larger than 50 MB.`);
    else if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") setError(`"${file.name}" isn't a PDF.`);
    else {
      setError(null);
      setPdf(file);
    }
  }

  async function submit(form: HTMLFormElement) {
    if (!title.trim()) {
      setError("Give the source a title.");
      return;
    }
    setError(null);
    const data = new FormData(form);
    data.delete("pdf-picker");
    data.set("title", title);
    data.set("authors", authors);
    data.set("notes", notes);
    if (pdf) data.set("pdf", pdf, pdf.name);
    setSaving(true);
    setProgress(pdf ? 0 : null);
    try {
      const { id } = await upload<{ id: string }>("/api/upload/sources", data, pdf ? setProgress : undefined);
      window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
      router.push(preselectedGroup ? `/groups/${preselectedGroup}` : `/library/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the source.");
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <div>
        <AutoTextarea
          value={title}
          onChange={(v) => setTitle(v.replace(/\n/g, " "))}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder="Untitled"
          aria-label="Title"
          autoFocus
          minRows={1}
          className={`${fieldBase} block resize-none font-serif text-[1.9rem] leading-tight tracking-tight`}
        />
        <div className="mt-4 space-y-0.5">
          <PropertyRow label="Authors" htmlFor="new-authors">
            <AutoTextarea
              id="new-authors"
              value={authors}
              onChange={setAuthors}
              placeholder="Surname, Firstname — one per line"
              aria-label="Authors"
              minRows={1}
              className={`${fieldBase} block resize-none`}
            />
          </PropertyRow>
          <PropertyRow label="Year" htmlFor="new-year">
            <input id="new-year" name="year" inputMode="numeric" placeholder="Empty" aria-label="Year" autoComplete="off" className={fieldBase} />
          </PropertyRow>
          <PropertyRow label="Type" htmlFor="new-type">
            <select id="new-type" name="type" defaultValue="article" aria-label="Type" className={`${fieldBase} w-auto cursor-pointer appearance-none pr-5`}>
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </PropertyRow>
          <PropertyRow label="Link" htmlFor="new-url">
            <input id="new-url" name="url" type="url" inputMode="url" placeholder="https://" aria-label="Link" autoComplete="off" className={`${fieldBase} text-accent`} />
          </PropertyRow>
          {groups.length > 0 && (
            <PropertyRow label="Groups">
              <div className="flex flex-wrap gap-1.5 py-0.5">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="cursor-pointer rounded-full px-2.5 py-0.5 text-sm text-muted transition-colors hover:bg-accent-soft has-[:checked]:bg-accent-soft has-[:checked]:text-ink"
                  >
                    <input type="checkbox" name="groups" value={g.id} defaultChecked={g.id === preselectedGroup} className="sr-only" />
                    {g.title}
                  </label>
                ))}
              </div>
            </PropertyRow>
          )}
        </div>
      </div>

      <section aria-label="PDF">
        <h2 className={`${ui.h2} mb-3`}>PDF</h2>
        {pdf ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{pdf.name}</span>
            <span className="text-faint">{formatBytes(pdf.size)}</span>
            <button type="button" onClick={() => setPdf(null)} className={ui.btnGhost}>
              Remove
            </button>
          </div>
        ) : (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choosePdf(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer items-center rounded-md px-1.5 py-1 -mx-1.5 text-sm transition-colors hover:bg-accent-soft/70 ${dragging ? "bg-accent-soft text-ink" : "text-faint"}`}
          >
            Drop a PDF here or click to choose one (up to 50 MB)
            <input type="file" name="pdf-picker" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => (choosePdf(e.target.files?.[0]), (e.target.value = ""))} />
          </label>
        )}
      </section>

      <section aria-label="My notes">
        <h2 className={`${ui.h2} mb-3`}>My notes</h2>
        <LiveEditor value={notes} onChange={setNotes} placeholder="Write your notes…" ariaLabel="My notes" className="min-h-24" />
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={ui.btnPrimary}>
          {saving ? (progress !== null && progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Saving…") : "Add source"}
        </button>
        <button type="button" onClick={() => router.back()} className={ui.btnGhost}>
          Cancel
        </button>
      </div>
    </form>
  );
}
