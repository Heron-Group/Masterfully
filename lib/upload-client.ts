// Browser-side upload helper with progress (fetch has no upload progress).

export class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function upload<T>(
  url: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else {
        const message =
          (xhr.response && typeof xhr.response === "object" && "error" in xhr.response
            ? String(xhr.response.error)
            : null) ??
          (xhr.status === 413
            ? "That upload is too large for the server."
            : xhr.status === 401
              ? "You've been signed out. Sign in again and retry; your text is kept."
              : `Upload failed (${xhr.status}).`);
        reject(new UploadError(message, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError("Couldn't reach the server. Check your connection; nothing was lost.", 0));
    xhr.send(form);
  });
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}
