/**
 * Signed session tokens: `v2.<userId>.<expiresAtMs>.<hmac>`. Uses Web Crypto
 * only so it runs anywhere (proxy, route handlers, tests).
 *
 * Changing SESSION_SECRET signs out every session.
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

export type SessionKeys = { secret: string };

export function sessionKeysFromEnv(): SessionKeys | null {
  const secret = process.env.SESSION_SECRET ?? "";
  return secret.length >= 32 ? { secret } : null;
}

export async function createSessionToken(
  keys: SessionKeys,
  userId: string,
  now = Date.now(),
): Promise<{ token: string; expires: Date }> {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Invalid user id");
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v2.${userId}.${expiresAt}`;
  const token = `${payload}.${await hmac(keys.secret, payload)}`;
  return { token, expires: new Date(expiresAt) };
}

/** The user id in a valid, unexpired token; otherwise null. */
export async function verifySessionToken(
  keys: SessionKeys | null,
  token: string | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!keys || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const [, userId, exp, sig] = parts;
  const expiresAt = Number(exp);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const expected = await hmac(keys.secret, `v2.${userId}.${exp}`);
  return timingSafeEqual(expected, sig) ? userId : null;
}
