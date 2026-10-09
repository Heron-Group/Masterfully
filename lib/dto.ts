// Shapes sent to the browser. Safe to import from client components.

export type AttachmentDto = {
  file: string;
  name: string;
  type: string;
  size: number;
  url: string;
  /** Present for images that get a server-side thumbnail. */
  thumbUrl?: string;
  isImage: boolean;
};

export type EntryDto = {
  id: string;
  created: string;
  updated: string;
  body: string;
  attachments: AttachmentDto[];
  problem?: string;
};

export type JournalPage = { entries: EntryDto[]; hasMore: boolean; targetId?: string };

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function fileUrl(file: string, opts: { thumb?: boolean; download?: boolean } = {}): string {
  const path = file.split("/").map(encodeURIComponent).join("/");
  const q = opts.thumb ? "?thumb=1" : opts.download ? "?download=1" : "";
  return `/api/files/${path}${q}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
