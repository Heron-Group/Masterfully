import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { workspace } from "./fixtures";
import { signIn } from "./helpers";

// Needs the dev server to run with AI_FAKE=1 (see .env.local) so no API
// calls are made. Uses the sample library from `seed-dev-content.mjs --library`.
test.describe.configure({ mode: "serial" });

const read = (rel: string) => readFileSync(workspace(rel), "utf8");

test("source summary streams in, is labelled, and changes only the AI section", async ({ page }) => {
  const before = read("sources/ingold-2013-making.md");
  await signIn(page, "/library/ingold-2013-making");
  await page.getByRole("button", { name: /^(Summarise|Resummarise)$/ }).click();
  await expect(page.getByText("AI-generated · writing…")).toBeVisible();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/simulated summary of/i)).toBeVisible();
  const after = read("sources/ingold-2013-making.md");
  const head = (t: string) => t.slice(0, t.indexOf("## AI summary") === -1 ? undefined : t.indexOf("## AI summary"));
  expect(head(after).replace(/updated: .*\n/, "")).toBe(head(before).replace(/updated: .*\n/, "").trimEnd() + "\n\n");
});

test("group summary is marked stale after a member is re-summarised", async ({ page }) => {
  test.setTimeout(120_000);
  const groupGeneratedAt = () => read("groups/co-design-foundations.md").match(/generated: (\S+);/)?.[1];
  const groupBefore = groupGeneratedAt();
  await signIn(page, "/groups/co-design-foundations");
  await page.getByRole("button", { name: /^(Summarise|Resummarise)$/ }).click();
  // Wait for the new group summary to be saved (an older one may be showing).
  await expect.poll(groupGeneratedAt, { timeout: 30_000 }).not.toBe(groupBefore);
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Out of date/)).toHaveCount(0);
  expect(read("groups/co-design-foundations.md")).toContain("## Overview");

  await page.waitForTimeout(1100); // timestamps have one-second resolution
  // If the source's link is paywalled (the sample Sanders DOI is), the app
  // says so and offers to summarise from the details and notes instead.
  // Re-summarise a source that is in the group (the first one listed).
  const member = read("groups/co-design-foundations.md").match(/- id: (\S+)/)![1];
  const generatedAt = () => read(`sources/${member}.md`).match(/generated: (\S+);/)?.[1];
  const before = generatedAt();
  await page.goto(`/library/${member}`);
  await page.waitForLoadState("networkidle"); // a click before hydration does nothing
  await page.getByRole("button", { name: /^(Summarise|Resummarise)$/ }).click();
  const fallback = page.getByRole("button", { name: "Summarise from details and notes only" });
  // An earlier summary stays on screen while the new one is written, so wait
  // for the new one to reach the file, taking the details-only route when
  // the paywall message appears.
  await expect
    .poll(
      async () => {
        if (await fallback.isVisible()) await fallback.click();
        return generatedAt();
      },
      { timeout: 45_000, intervals: [500] },
    )
    .not.toBe(before);
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle"); // let the post-save refresh finish

  // The page refreshes itself after saving; retry if that interrupts us.
  await expect(async () => {
    await page.goto("/groups/co-design-foundations");
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText(/Out of date/)).toBeVisible();
});

test("signed out, AI routes are unreachable", async ({ request }) => {
  expect((await request.post("/api/ai/source/ingold-2013-making")).status()).toBe(401);
  expect((await request.post("/api/ai/group/co-design-foundations")).status()).toBe(401);
});
