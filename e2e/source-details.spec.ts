import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { makePdf, ownerId, REPO_DIR } from "./fixtures";
import { waitForHydration } from "./helpers";

// The source page's details: a labelled list, reading groups in their own
// section, and details filled in from a PDF when it's added, except those
// the user set themselves. As a fresh user.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `details-${stamp}@example.com`;

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}
const file = (id: string) => readFileSync(path.join(REPO_DIR, "users", ownerId(email), "sources", `${id}.md`), "utf8");
const pdf = (name: string, info: { Title?: string; Author?: string }) => ({
  name,
  mimeType: "application/pdf",
  buffer: makePdf(3000, "Copyright 2019 Body", info),
});

test("a new PDF fills in only the details the user hasn't set; Undo puts them back", async ({ page }) => {
  test.setTimeout(90_000);
  await as(page, "/library");
  const res = await page.request.post("/api/upload/sources", { multipart: { title: `Typed title ${stamp}`, authors: "Mine, Kept" } });
  const { id } = (await res.json()) as { id: string };
  await as(page, `/library/${id}`);

  const details = page.getByRole("group", { name: "Details" });
  for (const label of ["Authors", "Year", "Type", "Added"]) await expect(details.getByText(label, { exact: true })).toBeVisible();
  await expect(details.getByText("Groups", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Reading groups" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fill in details/ })).toHaveCount(0);

  const input = page.locator("section", { has: page.getByRole("heading", { name: "PDFs and links" }) }).locator('input[type="file"]');
  await input.setInputFiles(pdf("thinking.pdf", { Title: `Material Thinking ${stamp}`, Author: "Ann Tester" }));
  // The title and authors were typed, so only the empty year is filled in.
  const note = page.getByRole("status").filter({ hasText: "Filled in" });
  await expect(note).toHaveText(/Filled in the year from thinking\.pdf\./, { timeout: 20_000 });
  await expect.poll(() => file(id)).toContain("year: 2019");
  expect(file(id)).toContain(`title: Typed title ${stamp}`);
  expect(file(id)).toContain("Mine, Kept");
  await expect(details.getByLabel("Year")).toHaveValue("2019");

  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toHaveCount(0);
  await expect.poll(() => file(id)).not.toContain("year:");

  // A year typed by hand stays, whatever the next PDF says.
  const year = details.getByLabel("Year");
  await year.fill("2001");
  await year.press("Enter");
  await expect.poll(() => file(id)).toContain("year: 2001");
  await input.setInputFiles(pdf("second.pdf", { Title: "Another", Author: "Bo Writer" }));
  await expect(page.getByText("second.pdf")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "Reading the source" })).toHaveCount(0, { timeout: 20_000 });
  await expect(note).toHaveCount(0);
  expect(file(id)).toContain("year: 2001");
  expect(file(id)).toContain("Mine, Kept");
});

test("a source created with a PDF fills in its details when it opens", async ({ page }) => {
  test.setTimeout(90_000);
  await as(page, "/library");
  const res = await page.request.post("/api/upload/sources", {
    multipart: { title: `Just a title ${stamp}`, set_by_hand: "", pdf: pdf("made.pdf", { Title: "Ignored", Author: "Ann Tester and Bo Writer" }) },
  });
  const { id } = (await res.json()) as { id: string };
  await as(page, `/library/${id}?fill=1`);
  await expect(page.getByRole("status").filter({ hasText: "Filled in" })).toHaveText(/Filled in the authors and year from made\.pdf\./, {
    timeout: 20_000,
  });
  await expect.poll(() => file(id)).toContain('"Tester, Ann", "Writer, Bo"');
  expect(file(id)).toContain(`title: Just a title ${stamp}`); // the title was typed
  expect(page.url()).not.toContain("fill=1");
});
