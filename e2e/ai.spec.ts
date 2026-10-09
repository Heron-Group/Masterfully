import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { CONTENT_DIR } from "./fixtures";
import { signIn } from "./helpers";

// Needs the dev server to run with AI_FAKE=1 (see .env.local) so no API
// calls are made. Uses the sample library from `seed-dev-content.mjs --library`.
test.describe.configure({ mode: "serial" });

const read = (rel: string) => readFileSync(path.join(CONTENT_DIR, rel), "utf8");

test("research context saves to settings.md", async ({ page }) => {
  await signIn(page, "/settings");
  await expect(page.getByText("Simulated (AI_FAKE=1")).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Research context" });
  const text = `How can graphic language support co-design with community groups? (${Date.now()})`;
  await editor.fill(text);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(read("settings.md")).toContain(text);
});

test("source summary streams in, is labelled, and changes only the AI section", async ({ page }) => {
  const before = read("sources/ingold-2013-making.md");
  await signIn(page, "/library/ingold-2013-making");
  await page.getByRole("button", { name: /Generate summary|Regenerate summary/ }).click();
  await expect(page.getByText("AI-generated · writing…")).toBeVisible();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/simulated summary of/i)).toBeVisible();
  const after = read("sources/ingold-2013-making.md");
  const head = (t: string) => t.slice(0, t.indexOf("## AI summary") === -1 ? undefined : t.indexOf("## AI summary"));
  expect(head(after).replace(/updated: .*\n/, "")).toBe(head(before).replace(/updated: .*\n/, "").trimEnd() + "\n\n");
});

test("group summary is marked stale after a member is re-summarised", async ({ page }) => {
  await signIn(page, "/groups/co-design-foundations");
  await page.getByRole("button", { name: /Generate summary|Regenerate summary/ }).click();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Out of date/)).toHaveCount(0);
  expect(read("groups/co-design-foundations.md")).toContain("## Overview");

  await page.waitForTimeout(1100); // timestamps have one-second resolution
  // This source's link is a paywalled DOI: the app says so and offers to
  // summarise from the details and notes instead.
  await page.goto("/library/sanders-2008-co-creation-new");
  await page.getByRole("button", { name: /Generate summary|Regenerate summary/ }).click();
  const fallback = page.getByRole("button", { name: "Summarise from details and notes only" });
  const label = page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/);
  await expect(page.getByText("AI-generated · writing…")).toHaveCount(0, { timeout: 30_000 });
  if (await fallback.isVisible()) {
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't read the linked page" })).toBeVisible();
    await fallback.click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't read" })).toHaveCount(0);
  }
  await expect(page.getByText("AI-generated · writing…")).toHaveCount(0, { timeout: 30_000 });
  await expect(label).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle"); // let the post-save refresh finish

  await page.goto("/groups/co-design-foundations");
  await expect(page.getByText(/Out of date/)).toBeVisible();
});

test("signed out, AI routes are unreachable", async ({ request }) => {
  expect((await request.post("/api/ai/source/ingold-2013-making")).status()).toBe(401);
  expect((await request.post("/api/ai/group/co-design-foundations")).status()).toBe(401);
});
