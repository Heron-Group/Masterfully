import { chromium, type FullConfig } from "@playwright/test";
import { DEV_PASSWORD } from "./helpers";

/**
 * Sign in with the dev password once before the specs run, so the owner's
 * account and workspace exist for specs that read or write its files.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/login");
  await page.getByPlaceholder("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/journal", { timeout: 60_000 });
  await browser.close();
}
