"use client";

import { useEffect, useState } from "react";
import { fileUrl, formatBytes, IMAGE_TYPES, MAX_UPLOAD_BYTES, type AttachmentDto } from "@/lib/dto";

/** Images as a thumbnail grid (tap to enlarge), other files as cards. */
export function AttachmentList({
  attachments,
  onRemove,
  columns,
}: {
  attachments: AttachmentDto[];
  /** When given, each attachment shows a remove control (with a confirm step). */
  onRemove?: (file: string) => void;
  /** Two full-width columns (notes): images two to a row, then files two to a row. */
  columns?: boolean;
}) {
  const [open, setOpen] = useState<AttachmentDto | null>(null);
  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);
  if (!attachments.length) return null;
  if (columns) {
    return (
      <div className="mt-3 space-y-2">
        {images.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {images.map((a) => (
              <div key={a.file} className="group/att relative">
                <button
                  type="button"
                  onClick={() => setOpen(a)}
                  className="block w-full overflow-hidden rounded-md bg-accent-soft"
                  aria-label={`Open ${a.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, server-thumbnailed */}
                  <img
                    src={a.thumbUrl ?? a.url}
                    alt={a.name}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover transition-opacity group-hover/att:opacity-90"
                  />
                </button>
                {onRemove && <RemoveControl name={a.name} onRemove={() => onRemove(a.file)} overlay />}
              </div>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {files.map((a) => (
              <div key={a.file} className="group/att relative">
                <FileCard attachment={a} wide />
                {onRemove && <RemoveControl name={a.name} onRemove={() => onRemove(a.file)} />}
              </div>
            ))}
          </div>
        )}
        {open && <Lightbox attachment={open} onClose={() => setOpen(null)} />}
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {images.length > 0 && (
        <div className={`grid gap-1.5 ${images.length === 1 ? "max-w-sm grid-cols-1" : "max-w-md grid-cols-2 sm:grid-cols-3"}`}>
          {images.map((a) => (
            <div key={a.file} className="group/att relative">
              <button
                type="button"
                onClick={() => setOpen(a)}
                className="block w-full overflow-hidden rounded-md bg-accent-soft"
                aria-label={`Open ${a.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated, server-thumbnailed */}
                <img
                  src={a.thumbUrl ?? a.url}
                  alt={a.name}
                  loading="lazy"
                  className={`w-full object-cover transition-opacity group-hover/att:opacity-90 ${images.length === 1 ? "max-h-80" : "aspect-square"}`}
                />
              </button>
              {onRemove && <RemoveControl name={a.name} onRemove={() => onRemove(a.file)} overlay />}
            </div>
          ))}
        </div>
      )}
      {files.map((a) => (
        <div key={a.file} className="group/att relative max-w-md">
          <FileCard attachment={a} />
          {onRemove && <RemoveControl name={a.name} onRemove={() => onRemove(a.file)} />}
        </div>
      ))}
      {open && <Lightbox attachment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A small × that asks "Remove?" before removing an attachment. */
function RemoveControl({ name, onRemove, overlay }: { name: string; onRemove: () => void; overlay?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const position = overlay ? "right-1 top-1" : "right-10 top-1/2 -translate-y-1/2";
  return confirming ? (
    <span className={`absolute ${position} flex gap-1 rounded-md bg-surface/95 p-0.5 text-xs shadow-sm`}>
      <button type="button" onClick={onRemove} className="rounded bg-danger px-2 py-0.5 font-medium text-paper">
        Remove
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 text-muted hover:text-ink">
        Keep
      </button>
    </span>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Remove ${name}`}
      title="Remove attachment"
      className={`absolute ${position} rounded-full bg-surface/90 px-1.5 text-sm leading-5 text-muted opacity-100 shadow-sm transition-opacity hover:text-danger sm:opacity-0 sm:group-hover/att:opacity-100 sm:focus:opacity-100`}
    >
      ×
    </button>
  );
}

export function FileCard({ attachment: a, wide }: { attachment: AttachmentDto; wide?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-md bg-accent-soft/60 px-3 py-2 ${wide ? "" : "max-w-md"}`}>
      <FileIcon type={a.type} />
      <a href={a.url} target="_blank" rel="noopener" className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm text-ink">{a.name}</span>
        <span className="block text-xs text-muted">
          {describeType(a.type, a.name)} · {formatBytes(a.size)}
        </span>
      </a>
      <a
        href={fileUrl(a.file, { download: true })}
        className="rounded p-1 text-muted hover:text-ink"
        title="Download"
        aria-label={`Download ${a.name}`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}

function describeType(type: string, name: string): string {
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("audio/")) return "Audio";
  if (type.startsWith("video/")) return "Video";
  if (type.startsWith("image/")) return "Image";
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase() : "File";
}

function FileIcon({ type }: { type: string }) {
  const label = type === "application/pdf" ? "PDF" : type.startsWith("audio/") ? "♪" : type.startsWith("video/") ? "▶" : "";
  return (
    <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-sm bg-paper text-[9px] font-semibold text-muted">
      {label}
    </span>
  );
}

function Lightbox({ attachment, onClose }: { attachment: AttachmentDto; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-white/80">
        <span className="truncate">{attachment.name}</span>
        <div className="flex shrink-0 gap-4">
          <a href={attachment.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="hover:text-white">
            Original
          </a>
          <button type="button" onClick={onClose} className="hover:text-white">
            Close
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt={attachment.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}

// --- Files chosen but not yet uploaded ---------------------------------------

export type PendingFile = { id: string; file: File; previewUrl?: string };

let counter = 0;

/** Wrap browser files for upload, rejecting ones over 50 MB. */
export function toPending(files: Iterable<File>): { accepted: PendingFile[]; rejected: string[] } {
  const accepted: PendingFile[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push(file.name || "file");
      continue;
    }
    // Pasted screenshots arrive as "image.png"; give them a dated name.
    let f = file;
    if (/^image\.(png|jpe?g)$/i.test(file.name)) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      f = new File([file], `screenshot-${stamp}.${file.name.split(".").pop()}`, { type: file.type });
    }
    accepted.push({
      id: `p${++counter}`,
      file: f,
      previewUrl: IMAGE_TYPES.includes(f.type) ? URL.createObjectURL(f) : undefined,
    });
  }
  return { accepted, rejected };
}

export function releasePending(files: PendingFile[]) {
  for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
}

export function PendingFiles({ files, onRemove }: { files: PendingFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((p) => (
        <li key={p.id} className="relative flex items-center gap-2 rounded-md bg-accent-soft/70 py-1 pl-1 pr-7 text-xs">
          {p.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.previewUrl} alt="" className="size-8 rounded object-cover" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded bg-accent-soft text-[9px] font-semibold text-muted">
              {(p.file.name.split(".").pop() ?? "").slice(0, 4).toUpperCase()}
            </span>
          )}
          <span className="max-w-[10rem] truncate">{p.file.name}</span>
          <span className="text-faint">{formatBytes(p.file.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            aria-label={`Remove ${p.file.name}`}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachButton({ onFiles, label = "Attach files" }: { onFiles: (files: FileList) => void; label?: string }) {
  return (
    // A fixed-size flex box: as an inline element, the hidden text and file
    // input added line boxes that made the button much taller than its icon.
    <label
      className="relative flex size-8 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:text-ink"
      title={label}
    >
      <span className="sr-only">{label}</span>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="m15 8.3-6 6a3.6 3.6 0 0 1-5.1-5.1l6.4-6.4a2.4 2.4 0 0 1 3.4 3.4l-6.4 6.4a1.2 1.2 0 0 1-1.7-1.7l5.8-5.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <input
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
