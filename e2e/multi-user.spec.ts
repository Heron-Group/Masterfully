import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { REPO_DIR } from "./fixtures";

// Uses the development sign-in (AUTH_DEV_LOGIN=1 in .env.local) to act as
// several users without Google or Microsoft.

const stamp = Date.now();

async function signInAs(page: Page, email: string, next = "/library") {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&name=${email.split("@")[0]}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
}

function accountId(email: string): string {
  const dir = path.join(REPO_DIR, "accounts");
  const file = readdirSync(dir).find((f) => readFileSync(path.join(dir, f), "utf8").includes(`email: ${email}`));
  return file!.slice(0, -3);
}

async function userPage(browser: Browser, email: string, next?: string) {
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, email, next);
  return page;
}

test("each user has a private workspace", async ({ browser }) => {
  test.setTimeout(90_000);
  const ada = await userPage(browser, `ada-${stamp}@example.com`, "/library/new");
  const title = `Ada's private source ${stamp}`;
  const titleField = ada.getByLabel("Title", { exact: true });
  await titleField.fill(title);
  await titleField.press("Enter");
  await ada.waitForURL((url) => /^\/library\/(?!new$)[a-z0-9-]+$/.test(url.pathname), { timeout: 30_000 });
  await expect(ada.getByRole("heading", { level: 1 })).toHaveText(title);
  const sourceUrl = new URL(ada.url()).pathname;
  const sourceId = sourceUrl.split("/").pop()!;

  // Saved in Ada's folder, committed as Ada.
  const adaId = accountId(`ada-${stamp}@example.com`);
  expect(existsSync(path.join(REPO_DIR, "users", adaId, "sources", `${sourceId}.md`))).toBe(true);

  // Bo sees an empty library and can't open Ada's source, its files or its summary.
  const bo = await userPage(browser, `bo-${stamp}@example.com`, "/library");
  await expect(bo.getByText("Your library is empty")).toBeVisible();
  await expect(bo.getByText(title)).toHaveCount(0);
  // (Streamed pages answer 200 and then render the not-found page.)
  await bo.goto(sourceUrl);
  await expect(bo.getByText(/could not be found/i)).toBeVisible();
  await expect(bo.getByText(title)).toHaveCount(0);
  expect(await (await bo.request.get(`/api/reader/${sourceId}`)).text()).not.toContain(title);
  expect((await bo.request.get(`/api/files/users/${adaId}/sources/${sourceId}.md`)).status()).not.toBe(200);

  // Signing in again returns to the same account.
  const again = await userPage(browser, `ada-${stamp}@example.com`, "/library");
  await expect(again.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  expect(accountId(`ada-${stamp}@example.com`)).toBe(adaId);

  await Promise.all([ada, bo, again].map((p) => p.context().close()));
});

test("AI provider and API key in Settings", async ({ page }) => {
  const email = `keys-${stamp}@example.com`;
  await signInAs(page, email, "/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.waitForLoadState("networkidle");

  // Choose OpenAI and save a key: only a hint is shown, and the file holds no plain key.
  await page.getByRole("radio", { name: "OpenAI" }).click();
  await expect(page.getByRole("radio", { name: "OpenAI" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Model")).toHaveValue("gpt-5.5");
  await page.getByLabel("OpenAI API key").fill("sk-proj-test-secret-9876");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("key-hint")).toHaveText("sk-proj-…9876");
  const secretFile = path.resolve(".secrets", "ai", `${accountId(email)}.json`);
  const stored = readFileSync(secretFile, "utf8");
  expect(stored).not.toContain("secret-9876");
  expect(JSON.parse(stored).provider).toBe("openai");

  // A different model is kept after a reload; Claude keeps its own settings.
  await page.getByLabel("Model").fill("gpt-5.5-mini");
  await page.getByLabel("Model").press("Enter");
  await expect(page.getByRole("button", { name: /Use the default/ })).toBeVisible();
  await expect.poll(() => JSON.parse(readFileSync(secretFile, "utf8")).models?.openai).toBe("gpt-5.5-mini");
  await page.reload();
  await expect(page.getByLabel("Model")).toHaveValue("gpt-5.5-mini");
  await page.getByRole("radio", { name: "Claude" }).click();
  await expect(page.getByLabel("Model")).toHaveValue("claude-opus-5-5");
  await expect(page.getByLabel("Claude API key")).toBeVisible();

  // Remove the OpenAI key, with a confirmation.
  await page.getByRole("radio", { name: "OpenAI" }).click();
  await page.getByRole("button", { name: "Remove key" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  expect(JSON.parse(readFileSync(secretFile, "utf8")).keys.openai).toBeUndefined();
});

test("login page explains sign-in problems", async ({ page, request }) => {
  await page.goto("/login?error=cancelled");
  await expect(page.getByRole("alert").filter({ hasText: "Sign-in" })).toHaveText("Sign-in was cancelled.");
  const res = await request.get("/api/auth/google", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/login?error=unavailable");
  const cb = await request.get("/api/auth/google/callback?code=x&state=y", { maxRedirects: 0 });
  expect(cb.headers().location).toContain("/login?error=expired");
});

test("Settings sits at the bottom of the sidebar; data downloads as a zip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the sidebar shows on wide screens");
  const email = `export-${stamp}@example.com`;
  await signInAs(page, email, "/settings");
  const main = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(main.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Settings" })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download your data" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^research-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = readFileSync((await download.path())!);
  expect(zip.subarray(0, 2).toString()).toBe("PK");
  expect(zip.includes(Buffer.from("settings.md"))).toBe(true);
});
