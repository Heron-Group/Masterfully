/** Holds the OAuth state and PKCE verifier between leaving for the provider and coming back. */
export const OAUTH_COOKIE = "rp_oauth";

/** Only allow redirects back into this app (no protocol-relative URLs). */
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/journal";
}

export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "1";
}

/**
 * A full URL on this site for a redirect. Behind Plesk's nginx and Passenger,
 * `request.url` is the internal address the server listens on (e.g.
 * http://0.0.0.0:3000), so use APP_URL, then the forwarded host the visitor
 * used, and only then the request's own origin.
 */
export function publicUrl(path: string, request: Request): URL {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return new URL(path, configured);
  const headers = request.headers;
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim();
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
    return new URL(path, `${proto}://${host}`);
  }
  return new URL(path, request.url);
}
