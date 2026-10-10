import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Account, Identity } from "../accounts";
import { serverConfig } from "../config";
import { getAccounts } from "../content";
import { LoginRateLimiter } from "./rate-limit";
import { createSessionToken, SESSION_COOKIE, sessionKeysFromEnv, verifySessionToken } from "./session";

// Data Access Layer for auth. Every page, server action and route handler
// that touches content resolves the signed-in account here (via
// getContentStore), so access is checked next to the data and not only in
// proxy.ts.

const globalAuth = globalThis as unknown as { __loginLimiter?: LoginRateLimiter };
const limiter = (globalAuth.__loginLimiter ??= new LoginRateLimiter(5, 15 * 60 * 1000));

/** The signed-in account, or null. */
export async function currentAccount(): Promise<Account | null> {
  // Session checks compare against the current time, so they (and anything
  // after them) must run per request, never in a prerendered shell.
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await verifySessionToken(sessionKeysFromEnv(), token);
  if (!userId) return null;
  return (await getAccounts()).get(userId);
}

export async function isAuthenticated(): Promise<boolean> {
  return !!(await currentAccount());
}

/** For pages and server actions: the account, or a redirect to /login. */
export async function requireSession(): Promise<Account> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  return account;
}

/** For route handlers: returns a 401 response when signed out, else null. */
export async function requireApiSession(): Promise<Response | null> {
  if (await isAuthenticated()) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // Plesk's nginx sets X-Forwarded-For / X-Real-IP in front of the app.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/** Set the session cookie for an account. */
export async function startSession(account: Account): Promise<void> {
  const keys = sessionKeysFromEnv();
  if (!keys) throw new Error("SESSION_SECRET must be at least 32 characters");
  const { token, expires } = await createSessionToken(keys, account.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** Sign in (creating the account on first use) after a provider confirms who someone is. */
export async function signInWith(identity: Identity, profile: { name?: string }): Promise<Account> {
  const account = await (await getAccounts()).signIn(identity, profile);
  await startSession(account);
  return account;
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Whether the owner's password sign-in is available. */
export function passwordLoginEnabled(): boolean {
  return !!process.env.APP_PASSWORD_HASH && !!serverConfig().ownerEmail;
}

/** Password sign-in, for the owner's account only (a fallback to Google/Microsoft). */
export async function login(password: string): Promise<LoginResult> {
  const hash = process.env.APP_PASSWORD_HASH ?? "";
  const ownerEmail = serverConfig().ownerEmail;
  if (!hash || !ownerEmail || !sessionKeysFromEnv()) {
    return {
      ok: false,
      error: "Password sign-in needs APP_PASSWORD_HASH, OWNER_EMAIL and SESSION_SECRET (at least 32 characters).",
    };
  }
  const ip = await clientIp();
  const wait = limiter.retryAfter(ip);
  if (wait > 0) {
    return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 60000)} minutes.` };
  }
  const valid = password.length > 0 && (await bcrypt.compare(password, hash));
  if (!valid) {
    limiter.recordFailure(ip);
    return { ok: false, error: "That password isn't right." };
  }
  limiter.reset(ip);
  await signInWith({ provider: "password", subject: "owner", email: ownerEmail, emailVerified: true }, {});
  return { ok: true };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
