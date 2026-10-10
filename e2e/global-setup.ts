import { request, type FullConfig } from "@playwright/test";
import { OWNER_EMAIL } from "./helpers";

/**
 * Sign in as the owner once before the specs run, so their account and
 * workspace exist for specs that read or write its files.
 */
export default async function globalSetup(config: FullConfig) {
  const ctx = await request.newContext({ baseURL: config.projects[0].use.baseURL });
  const res = await ctx.get(`/api/auth/dev?email=${encodeURIComponent(OWNER_EMAIL)}`, { maxRedirects: 0, timeout: 120_000 });
  if (res.status() !== 307) throw new Error(`Development sign-in failed (${res.status()}). Is AUTH_DEV_LOGIN=1 set?`);
  await ctx.dispose();
}
