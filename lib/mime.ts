const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", svg: "image/svg+xml", avif: "image/avif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  key: "application/vnd.apple.keynote", pages: "application/vnd.apple.pages",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  zip: "application/zip",
};

export function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

/** Types the browser may display inline. Everything else is served as a download. */
export function isInlineSafe(type: string): boolean {
  if (type === "image/svg+xml") return false; // can carry scripts
  return (
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    type === "application/pdf" ||
    type === "text/plain"
  );
}
