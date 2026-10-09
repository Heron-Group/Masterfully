import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginRateLimiter } from "./rate-limit";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionKeysFromEnv,
  verifySessionToken,
} from "./session";

// Data Access Layer for auth. Every page, server action and route handler
// that touches content calls one of these, so access is checked next to the
// data and not only in proxy.ts.

const globalAuth = globalThis as unknown as { __loginLimiter?: LoginRateLimiter };
const limiter = (globalAuth.__loginLimiter ??= new LoginRateLimiter(5, 15 * 60 * 1000));

export async function isAuthenticated(): Promise<boolean> {
  // Session checks compare against the current time, so they (and anything
  // after them) must run per request, never in a prerendered shell.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(sessionKeysFromEnv(), token);
}

/** For pages and server actions: redirects to /login when signed out. */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

/** For route handlers: returns a 401 response when signed out, else null. */
export async function requireApiSession(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // Plesk's nginx sets X-Forwarded-For / X-Real-IP in front of the app.
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(password: string): Promise<LoginResult> {
  const keys = sessionKeysFromEnv();
  if (!keys) {
    return {
      ok: false,
      error: "The server is missing APP_PASSWORD_HASH or SESSION_SECRET (at least 32 characters).",
    };
  }
  const ip = await clientIp();
  const wait = limiter.retryAfter(ip);
  if (wait > 0) {
    return {
      ok: false,
      error: `Too many attempts. Try again in ${Math.ceil(wait / 60000)} minutes.`,
    };
  }
  const valid = password.length > 0 && (await bcrypt.compare(password, keys.passwordHash));
  if (!valid) {
    limiter.recordFailure(ip);
    return { ok: false, error: "That password isn't right." };
  }
  limiter.reset(ip);
  const { token, expires } = await createSessionToken(keys);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
