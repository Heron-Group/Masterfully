/**
 * Signed session tokens: `v1.<expiresAtMs>.<hmac>`. Uses Web Crypto only so
 * it runs anywhere (proxy, route handlers, tests).
 *
 * The signing key mixes SESSION_SECRET with the password hash, so changing
 * the password signs out every existing session.
 */

export const SESSION_COOKIE = "rp_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SessionKeys = { secret: string; passwordHash: string };

export function sessionKeysFromEnv(): SessionKeys | null {
  const secret = process.env.SESSION_SECRET ?? "";
  const passwordHash = process.env.APP_PASSWORD_HASH ?? "";
  if (secret.length < 32 || !passwordHash) return null;
  return { secret, passwordHash };
}

function signingKey(keys: SessionKeys): string {
  return `${keys.secret}\u0000${keys.passwordHash}`;
}

export async function createSessionToken(
  keys: SessionKeys,
  now = Date.now(),
): Promise<{ token: string; expires: Date }> {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const token = `${payload}.${await hmac(signingKey(keys), payload)}`;
  return { token, expires: new Date(expiresAt) };
}

export async function verifySessionToken(
  keys: SessionKeys | null,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!keys || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = await hmac(signingKey(keys), `${parts[0]}.${parts[1]}`);
  return timingSafeEqual(expected, parts[2]);
}
