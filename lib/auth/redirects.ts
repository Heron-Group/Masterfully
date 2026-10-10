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
