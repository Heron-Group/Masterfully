import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { handRemove, handWrite, ownerHas, pdfFile, workspace } from "./fixtures";

/** Add the open source to a group with the tag list. */
async function addToGroup(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Add to group" }).click();
  await page.getByLabel("Find a group").fill(name);
  await page.getByRole("option", { name }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Reading groups" }).getByText(name)).toBeVisible();
}

const read = (rel: string) => readFileSync(workspace(rel), "utf8");
import { setEditorText, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const GROUP = `e2e-group-${stamp}`;
const TITLE = `E2E Graphic Language ${stamp}`;

test.beforeAll(() => {
  // A group written by hand, as if made in a text editor.
  handWrite(`groups/${GROUP}.md`, `---\ntitle: "E2E Group ${stamp}"\n---\n## Overview\n\nHand-written.\n`);
});

test.afterAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  handRemove(`groups/e2e-tag-group-${stamp}.md`);
  handRemove(`groups/${GROUP}.md`);
  const page = await browser.newPage();
  await signIn(page, "/library");
  await page.getByText(/sources$/).or(page.getByRole("img", { name: "Your library is empty." })).first().waitFor();
  // Remove any sources left by a failed run.
  for (const link of await page.getByRole("link", { name: /^E2E Graphic Language/ }).all()) {
    const href = await link.getAttribute("href");
    if (!href) continue;
    await page.goto(href);
    await page.getByRole("button", { name: "Delete source…" }).click();
    await page.getByRole("button", { name: "Delete source", exact: true }).click();
    await page.waitForURL("**/library");
  }
  await page.close();
});

test("add a source with a 40 MB PDF; it displays and is committed", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "/library");
  await page.getByRole("link", { name: "Add source" }).click();
  // The blank source page: fill in the details first, then the title creates it.
  await expect(page.getByText("Give the source a title to save it")).toBeVisible();
  const authors = page.getByLabel("Authors", { exact: true });
  await authors.fill("Brody, Ann; Müller, Jo");
  await authors.press("Enter");
  const year = page.getByLabel("Year", { exact: true });
  await year.fill("2025");
  await year.press("Enter");
  await page.getByLabel("Type", { exact: true }).selectOption("article");
  await page.getByRole("button", { name: "Add a link" }).click();
  await page.getByLabel("Link", { exact: true }).fill("https://example.org/paper");
  await page.getByLabel("Link", { exact: true }).press("Enter");
  await page.locator('input[type="file"]').setInputFiles(pdfFile(40 * 1024 * 1024, `Forty megabytes ${stamp}`));
  await setEditorText(page, page.getByRole("textbox", { name: "My notes" }), "First **impressions**.");
  await addToGroup(page, `E2E Group ${stamp}`);
  const title = page.getByLabel("Title", { exact: true });
  await title.fill(TITLE);
  await title.press("Enter");

  await page.waitForURL(/\/library\/brody-2025-e2e-graphic/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  await expect(page.getByLabel("Title", { exact: true }).filter({ visible: true })).toHaveValue(TITLE);
  await expect(page.getByRole("link", { name: "example.org/paper" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("button", { name: "Read web page" })).toBeVisible();

  // Read the PDF in the side panel (pdf.js renders it as pages with text).
  await page.getByRole("button", { name: "Read PDF" }).click();
  const panel = page.getByRole("complementary", { name: `Reading: ${TITLE}` });
  await expect(panel.getByText("Page 1 of 1")).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(".textLayer")).toContainText(`Forty megabytes ${stamp}`, { timeout: 30_000 });
  expect(page.url()).toContain("?read=pdf");
  const src = await panel.getByRole("link", { name: "Open in a new tab" }).getAttribute("href");
  const res = await page.request.get(src!, { headers: { Range: "bytes=0-1023" } });
  expect(res.status()).toBe(206);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-range"]).toMatch(/\/4194\d{4}$/);
  await panel.getByRole("button", { name: "Close reading panel" }).click();
  await expect(panel).toHaveCount(0);

  const id = page.url().split("/").pop()!.split("?")[0];
  // The web-page reader serves third-party HTML, so it must be sandboxed.
  const reader = await page.request.get(`/api/reader/${id}`);
  expect(reader.headers()["content-security-policy"]).toMatch(/^sandbox .*default-src 'none'/);
  expect(reader.headers()["content-security-policy"]).not.toContain("allow-scripts");
  expect(ownerHas(`sources/${id}.md`)).toBe(true);
  expect(ownerHas(`attachments/sources/${id}.pdf`)).toBe(true);
  expect(read(`groups/${GROUP}.md`)).toContain(`id: ${id}`);
  await expect(page.getByRole("link", { name: `E2E Group ${stamp}` })).toBeVisible();
});

test("library search and filters; open a source straight into the reader", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(`Read the PDF of ${TITLE}`) }).click();
  await expect(page.getByRole("complementary", { name: `Reading: ${TITLE}` }).getByText("Page 1 of 1")).toBeVisible({ timeout: 30_000 });
  await page.goto("/library");
  await page.getByLabel("Search sources").fill("muller");
  await expect(page.getByRole("link", { name: new RegExp(`^${TITLE}`) })).toBeVisible();
  await page.getByLabel("Search sources").fill("no such source zzz");
  await expect(page.getByText("No sources match.")).toBeVisible();
  await page.getByLabel("Search sources").fill("");
  await page.getByLabel("Filter by group").selectOption(GROUP);
  await expect(page.getByRole("link", { name: new RegExp(`^${TITLE}`) })).toBeVisible();
  await page.getByLabel("Filter by type").selectOption("book");
  await expect(page.getByText("No sources match.")).toBeVisible();
});

test("notes autosave exactly as typed and survive a reload", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(`^${TITLE}`) }).click();
  await page.waitForURL(/\/library\/brody-/);
  const id = page.url().split("/").pop()!;
  const notes = page.getByRole("textbox", { name: "My notes" });
  await setEditorText(page, notes, "Autosaved note\n\n## My own heading\n\nKept.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(read(`sources/${id}.md`)).toContain("## Notes\n\nAutosaved note\n\n## My own heading\n\nKept.\n");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "My notes" })).toContainText("My own heading");
});

test("edit details, leave and rejoin a group", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(`^${TITLE}`) }).click();
  await page.waitForURL(/\/library\/brody-/);
  const id = page.url().split("/").pop()!;
  await page.getByLabel("Year", { exact: true }).filter({ visible: true }).fill("2024");
  await page.getByLabel("Year", { exact: true }).filter({ visible: true }).press("Enter");
  await expect.poll(() => read(`sources/${id}.md`)).toContain("year: 2024");
  await page.getByLabel("Title", { exact: true }).filter({ visible: true }).fill(`${TITLE} (revised)`);
  await page.getByLabel("Title", { exact: true }).filter({ visible: true }).press("Enter");
  await expect.poll(() => read(`sources/${id}.md`)).toContain(`title: ${TITLE} (revised)`);

  await page.getByRole("button", { name: `Remove from E2E Group ${stamp}` }).click();
  await expect(page.getByRole("link", { name: `E2E Group ${stamp}` })).toHaveCount(0);
  await expect.poll(() => read(`groups/${GROUP}.md`)).not.toContain(id);
  await addToGroup(page, `E2E Group ${stamp}`);
  await expect.poll(() => read(`groups/${GROUP}.md`)).toContain(id);

  // Tags: create a second group from the list; the source is in both.
  await page.getByRole("button", { name: "Add to group" }).click();
  await page.getByLabel("Find a group").fill(`E2E Tag group ${stamp}`);
  await page.getByRole("button", { name: `Create “E2E Tag group ${stamp}”` }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: `E2E Tag group ${stamp}` })).toBeVisible();
  await expect.poll(() => read(`groups/e2e-tag-group-${stamp}.md`)).toContain(`- id: ${id}`);
  expect(read(`groups/${GROUP}.md`)).toContain(`- id: ${id}`);
  await expect(page.getByRole("link", { name: `E2E Group ${stamp}` })).toBeVisible();
});

test("delete a source removes its PDF and group membership", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("link", { name: new RegExp(`^${TITLE}`) }).click();
  await page.waitForURL(/\/library\/brody-/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Delete source…" }).click();
  await page.getByRole("button", { name: "Delete source", exact: true }).click();
  await page.waitForURL("**/library");
  await expect(page.getByRole("link", { name: new RegExp(`^${TITLE}`) })).toHaveCount(0);
  expect(ownerHas(`sources/${id}.md`)).toBe(false);
  expect(ownerHas(`attachments/sources/${id}.pdf`)).toBe(false);
  expect(read(`groups/${GROUP}.md`)).not.toContain(`id: ${id}`);
  expect(read(`groups/e2e-tag-group-${stamp}.md`)).not.toContain(`id: ${id}`);
});

test("signed out, sources and PDFs are unreachable", async ({ request }) => {
  expect((await request.get("/library", { maxRedirects: 0 })).status()).toBe(307);
  expect((await request.get("/api/files/attachments/sources/x.pdf")).status()).toBe(401);
  expect((await request.post("/api/upload/sources", { multipart: { title: "x" } })).status()).toBe(401);
  expect((await request.get("/api/reader/ingold-2013-making")).status()).toBe(401);
});
