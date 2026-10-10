import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { Account, Identity } from "../accounts";
import { getAccounts } from "../content";
import { createSessionToken, SESSION_COOKIE, sessionKeysFromEnv, verifySessionToken } from "./session";

// Data Access Layer for auth. Every page, server action and route handler
// that touches content resolves the signed-in account here (via
// getContentStore), so access is checked next to the data and not only in
// proxy.ts.

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

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
