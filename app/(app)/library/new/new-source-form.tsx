"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { CONTENT_CHANGED_EVENT } from "@/components/sync-status";
import { ui } from "@/components/ui";
import { formatBytes, MAX_UPLOAD_BYTES, type GroupRefDto } from "@/lib/dto";
import { upload } from "@/lib/upload-client";
import { SourceFields } from "../source-fields";

export function NewSourceForm({ groups, preselectedGroup }: { groups: GroupRefDto[]; preselectedGroup?: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: HTMLFormElement) {
    setError(null);
    const data = new FormData(form);
    data.delete("pdf-picker");
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
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
    >
      <SourceFields />

      <div>
        <span className={ui.label}>PDF</span>
        {pdf ? (
          <div className="flex items-center gap-3 rounded-md border border-rule bg-surface px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{pdf.name}</span>
            <span className="text-faint">{formatBytes(pdf.size)}</span>
            <button type="button" onClick={() => setPdf(null)} className={ui.btnGhost}>
              Remove
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-rule px-3 py-5 text-sm text-muted hover:border-accent hover:text-ink">
            Choose a PDF (up to 50 MB)
            <input
              type="file"
              name="pdf-picker"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > MAX_UPLOAD_BYTES) setError(`"${file.name}" is larger than 50 MB.`);
                else {
                  setError(null);
                  setPdf(file);
                }
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      <div>
        <span className={ui.label}>Notes</span>
        <MarkdownEditor value={notes} onChange={setNotes} placeholder="Your notes on this source (Markdown)" minRows={5} />
      </div>

      {groups.length > 0 && (
        <fieldset>
          <legend className={ui.label}>Add to groups</legend>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-rule px-3 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="groups" value={g.id} defaultChecked={g.id === preselectedGroup} className="accent-[var(--accent)]" />
                {g.title}
              </label>
            ))}
          </div>
        </fieldset>
      )}

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
