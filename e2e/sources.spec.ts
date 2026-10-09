import { expect, test } from "@playwright/test";
import { git, handRemove, handWrite, pdfFile } from "./fixtures";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const GROUP = `e2e-group-${stamp}`;
const TITLE = `E2E Graphic Language ${stamp}`;

test.beforeAll(() => {
  // A group written by hand, as if made in a text editor.
  handWrite(`groups/${GROUP}.md`, `---\ntitle: "E2E Group ${stamp}"\n---\n## Overview\n\nHand-written.\n`);
});

test.afterAll(async ({ browser }) => {
  handRemove(`groups/${GROUP}.md`);
  const page = await browser.newPage();
  await signIn(page, "/library");
  await page.getByText(/sources$|Your library is empty/).first().waitFor();
  // Remove any sources left by a failed run.
  for (const link of await page.getByRole("link", { name: /E2E Graphic Language/ }).all()) {
    const href = await link.getAttribute("href");
    if (!href) continue;
    await page.goto(href);
    await page.getByRole("button", { name: "Delete source…" }).click();
    await page.getByRole("button", { name: "Delete source" }).click();
    await page.waitForURL("**/library");
  }
  await page.close();
});

test("add a source with a 40 MB PDF; it displays and is committed", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "/library");
  await page.getByRole("link", { name: "Add source" }).click();
  await page.getByLabel("Title", { exact: true }).fill(TITLE);
  await page.getByLabel(/Authors/).fill("Brody, Ann\nMüller, Jo");
  await page.getByLabel("Year", { exact: true }).fill("2025");
  await page.getByLabel("Type", { exact: true }).selectOption("article");
  await page.getByLabel("Link", { exact: true }).fill("https://example.org/paper");
  await page.locator('input[type="file"]').setInputFiles(pdfFile(40 * 1024 * 1024, `Forty megabytes ${stamp}`));
  await page.getByPlaceholder(/Your notes/).fill("First **impressions**.");
  await page.getByLabel(`E2E Group ${stamp}`).check();
  await page.getByRole("button", { name: "Add source" }).click();

  await page.waitForURL(/\/library\/brody-2025-e2e-graphic/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  await expect(page.getByRole("link", { name: /example\.org\/paper/ })).toHaveAttribute("target", "_blank");

  const iframe = page.locator("iframe");
  const src = await iframe.getAttribute("src");
  const res = await page.request.get(src!, { headers: { Range: "bytes=0-1023" } });
  expect(res.status()).toBe(206);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-range"]).toMatch(/\/4194\d{4}$/);

  const id = page.url().split("/").pop()!;
  const files = git("show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean);
  expect(files[0]).toBe(`source: add ${id}`);
  expect(files).toContain(`attachments/sources/${id}.pdf`);
  expect(files).toContain(`groups/${GROUP}.md`);
  await expect(page.getByRole("link", { name: `E2E Group ${stamp}` })).toBeVisible();
});

test("library search and filters", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByLabel("Search sources").fill("muller");
  await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toBeVisible();
  await page.getByLabel("Search sources").fill("no such source zzz");
  await expect(page.getByText("No sources match.")).toBeVisible();
  await page.getByLabel("Search sources").fill("");
  await page.getByLabel("Filter by group").selectOption(GROUP);
  await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toBeVisible();
  await page.getByLabel("Filter by type").selectOption("book");
  await expect(page.getByText("No sources match.")).toBeVisible();
});

test("notes autosave and survive a reload", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(TITLE) }).click();
  const notes = page.getByRole("textbox", { name: "My notes" });
  await notes.fill("Autosaved note\n\n## My own heading\n\nKept.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "My notes" })).toHaveValue("Autosaved note\n\n## My own heading\n\nKept.");
  expect(git("log", "-1", "--format=%s")).toMatch(/^source: update notes /);
});

test("edit details, leave and rejoin a group", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(TITLE) }).click();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Year", { exact: true }).fill("2024");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("2024")).toBeVisible();

  await page.getByRole("button", { name: `Remove from E2E Group ${stamp}` }).click();
  await expect(page.getByText("Not in any group yet.")).toBeVisible();
  await page.getByLabel("Add to a group").selectOption(GROUP);
  await expect(page.getByRole("link", { name: `E2E Group ${stamp}` })).toBeVisible();
});

test("delete a source removes its PDF and group membership", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(TITLE) }).click();
  await page.waitForURL(/\/library\/brody-/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Delete source…" }).click();
  await page.getByRole("button", { name: "Delete source" }).click();
  await page.waitForURL("**/library");
  await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toHaveCount(0);
  const files = git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
  expect(files).toEqual([`attachments/sources/${id}.pdf`, `groups/${GROUP}.md`, `sources/${id}.md`].sort());
});

test("signed out, sources and PDFs are unreachable", async ({ request }) => {
  expect((await request.get("/library", { maxRedirects: 0 })).status()).toBe(307);
  expect((await request.get("/api/files/attachments/sources/x.pdf")).status()).toBe(401);
  expect((await request.post("/api/upload/sources", { multipart: { title: "x" } })).status()).toBe(401);
});
