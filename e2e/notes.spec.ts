import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ownerHas, workspace } from "./fixtures";
import { setEditorText, signIn } from "./helpers";

// Needs AI_FAKE=1 (see .env.local) so the summary uses the scripted stand-in.
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const TITLE = `E2E Workshop note ${stamp}`;
let noteUrl = "";
const noteFile = () => readFileSync(workspace(`notes/${noteUrl.split("/").pop()}.md`), "utf8");

test("the sidebar has Notes; the index has Add note and a search box", async ({ page }) => {
  await signIn(page, "/journal");
  await page.getByRole("link", { name: "Notes" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/notes");
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add note" })).toBeVisible();
});

test("add a note with text and an attachment; it is saved once titled", async ({ page }) => {
  await signIn(page, "/notes/new");
  await expect(page.getByText("Give the note a title to save it")).toBeVisible();
  await setEditorText(page, page.getByRole("textbox", { name: "Note", exact: true }), `Seven people, two hours. ${stamp}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "map.txt", mimeType: "text/plain", buffer: Buffer.from("route map") });
  await expect(page.getByText("map.txt").filter({ visible: true }).first()).toBeVisible();
  const title = page.getByLabel("Note title");
  await title.fill(TITLE);
  await title.press("Enter");

  await page.waitForURL((url) => /^\/notes\/(?!new$)[a-z0-9-]+$/.test(url.pathname), { timeout: 30_000 });
  noteUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  await expect(page.getByText("map.txt").filter({ visible: true }).first()).toBeVisible();
  const file = noteFile();
  expect(file).toContain(`title: ${TITLE}`);
  expect(file).toContain(`Seven people, two hours. ${stamp}`);
});

test("edit the note's text and title, and search for it", async ({ page }) => {
  await signIn(page, new URL(noteUrl).pathname);
  const editor = page.getByRole("textbox", { name: "Note", exact: true });
  await setEditorText(page, editor, `Rewritten **text** ${stamp}`);
  await expect.poll(noteFile, { timeout: 10_000 }).toContain(`Rewritten **text** ${stamp}`);
  await page.getByLabel("Note title").fill(`${TITLE} (renamed)`);
  await page.getByLabel("Note title").press("Enter");
  await expect.poll(noteFile).toContain(`title: ${TITLE} (renamed)`);

  await page.goto("/notes");
  await page.getByLabel("Search notes").fill(`rewritten ${stamp}`);
  await expect(page.getByRole("link", { name: new RegExp(`${TITLE} \\(renamed\\)`) })).toBeVisible();
  await page.getByLabel("Search notes").fill(`nothing-matches-${stamp}`);
  await expect(page.getByText("No notes match.")).toBeVisible();
});

test("generate an AI summary; the note's text is untouched", async ({ page }) => {
  await signIn(page, new URL(noteUrl).pathname);
  await page.getByRole("button", { name: /^Summarise$|Regenerate summary/ }).click();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });
  expect(noteFile()).toContain(`Rewritten **text** ${stamp}`);
  expect(noteFile()).toMatch(/## AI summary\n\n<!-- generated: .*; model: fake-model -->/);
});

test("remove the attachment, then delete the note", async ({ page }) => {
  await signIn(page, new URL(noteUrl).pathname);
  await page.getByRole("button", { name: /Remove map\.txt/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("map.txt").filter({ visible: true })).toHaveCount(0);
  expect(noteFile()).not.toContain("map.txt");

  await page.getByRole("button", { name: "Delete note…" }).click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.waitForURL("**/notes");
  await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toHaveCount(0);
  expect(ownerHas(`notes/${noteUrl.split("/").pop()}.md`)).toBe(false);
  noteUrl = "";
});
