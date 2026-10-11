import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerId, REPO_DIR } from "./fixtures";
import { setEditorText, waitForHydration } from "./helpers";

// The "/" menu, links to sources, and the "AI summarised" / "Annotated"
// labels, as a fresh user with one source.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `writer-${stamp}@example.com`;
const TARGET = `Co-design primer ${stamp}`;
let sourceId = "";
let targetId = "";

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}

const sourceFile = (id: string) => readFileSync(path.join(REPO_DIR, "users", ownerId(email), "sources", `${id}.md`), "utf8");

test("set up two sources", async ({ page }) => {
  await as(page, "/library");
  for (const title of [`Notes test ${stamp}`, TARGET]) {
    const res = await page.request.post("/api/upload/sources", { multipart: { title } });
    expect(res.ok()).toBe(true);
    const { id } = await res.json();
    if (title === TARGET) targetId = id;
    else sourceId = id;
  }
});

test("the / menu turns a line into a heading", async ({ page }) => {
  await as(page, `/library/${sourceId}`);
  const notes = page.getByRole("textbox", { name: "My notes" });
  await notes.click();
  await page.keyboard.type("/head");
  const menu = page.getByRole("listbox", { name: "Insert" });
  await expect(menu.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("ArrowDown"); // Heading 2
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await page.keyboard.type("Key ideas");
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("## Notes\n\n## Key ideas");

  // Escape closes the menu and leaves the "/" as typed.
  await page.keyboard.press("Enter");
  await page.keyboard.type("Half / way");
  await expect(menu).toHaveCount(0);
  await page.keyboard.type(" /");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("Half / way /");
});

test("link text to a source with Cmd/Ctrl+K, and insert one from the / menu", async ({ page }) => {
  await as(page, `/library/${sourceId}`);
  const notes = page.getByRole("textbox", { name: "My notes" });
  await setEditorText(page, notes, "This builds on the primer.");
  // Select "the primer" and link it.
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "the primer".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+k");
  const picker = page.getByRole("dialog", { name: "Add a link" });
  await picker.getByRole("textbox").fill("primer");
  await picker.getByRole("option", { name: new RegExp(TARGET) }).click();
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain(`This builds on [the primer](/library/${targetId}).`);

  // "/" → Link to source → a new source, created on the spot.
  await page.keyboard.press("End");
  await page.keyboard.type(" See also /source");
  await page.keyboard.press("Enter");
  const sourcePicker = page.getByRole("dialog", { name: "Link to source" });
  await sourcePicker.getByRole("textbox").fill(`Brand new ${stamp}`);
  await sourcePicker.getByRole("option", { name: /New source/ }).click();
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toMatch(new RegExp(`See also \\[Brand new ${stamp}\\]\\(/library/[a-z0-9-]+\\)`));

  // In the editor the link is a mention; a plain click opens the source in a new tab.
  const mention = page.locator(".cm-md-source-link", { hasText: "the primer" }).first();
  await expect(mention).toBeVisible();
  await page.keyboard.press("Escape"); // leave the editor so the link shows as a mention
  const [tab] = await Promise.all([page.context().waitForEvent("page"), mention.click()]);
  await tab.waitForURL(`**/library/${targetId}`);
  expect(page.url()).toContain(`/library/${sourceId}`); // the notes stay open

  // The target lists the source that links to it; click it to go back.
  await waitForHydration(tab);
  const refs = tab.getByRole("group", { name: "Referenced by" });
  await expect(refs.getByRole("link", { name: `Notes test ${stamp}` })).toBeVisible();
  await refs.getByRole("link", { name: `Notes test ${stamp}` }).click();
  await tab.waitForURL(`**/library/${sourceId}`);
  await tab.close();
});

test("formatting marks stay hidden, even on the line being edited", async ({ page }) => {
  await as(page, `/library/${sourceId}`);
  const notes = page.getByRole("textbox", { name: "My notes" });
  await setEditorText(page, notes, "Make this **word** bold.");
  const line = notes.locator(".cm-line").first();
  // Still typing on this line: no asterisks, but the word is bold.
  await expect(line).toHaveText("Make this word bold.");
  await expect(line.locator(".cm-md-strong")).toHaveText("word");
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("Make this **word** bold.");

  // Backspace just after the bold word deletes its last letter, not a hidden "*".
  await page.keyboard.press("End");
  for (let i = 0; i < " bold.".length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect(line).toHaveText("Make this wor bold.");
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("Make this **wor** bold.");
  // Deleting the rest leaves no empty "****" behind.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await expect(line).toHaveText("Make this  bold.");
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("Make this  bold.");

  // A heading's "#" is hidden too; Backspace at its start makes it a paragraph.
  await setEditorText(page, notes, "# Big idea");
  await expect(notes.locator(".cm-line").first()).toHaveText("Big idea");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toMatch(/## Notes\n\nBig idea\n/);
});

test("right-click selected text to style it; clicking elsewhere closes pop-ups", async ({ page }) => {
  await as(page, `/library/${sourceId}`);
  const notes = page.getByRole("textbox", { name: "My notes" });
  await setEditorText(page, notes, "Make this word bold.");
  // Select "word" and right-click it.
  await page.keyboard.press("End");
  for (let i = 0; i < " bold.".length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "word".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  const box = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: "right" });
  const menu = page.getByRole("dialog", { name: "Format" });
  await expect(menu.getByText("Turn into")).toBeVisible();
  await menu.getByRole("option", { name: /^Bold/ }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => sourceFile(sourceId), { timeout: 10_000 }).toContain("Make this **word** bold.");

  // The link pop-up closes when you click anywhere else.
  await notes.click();
  await page.keyboard.press("ControlOrMeta+k");
  const picker = page.getByRole("dialog", { name: "Add a link" });
  await expect(picker).toBeVisible();
  await page.getByRole("heading", { name: "My notes" }).click();
  await expect(picker).toHaveCount(0);
});

test("Settings: research context, and usage through Masterfully", async ({ page }) => {
  await as(page, "/library");
  await page.getByRole("button", { name: "Settings" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Research context" }).click();
  await setEditorText(page, dialog.getByRole("textbox", { name: "Research context" }), `Graphic language in co-design ${stamp}`);
  await expect(dialog.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const settingsFile = path.join(REPO_DIR, "users", ownerId(email), "settings.md");
  expect(readFileSync(settingsFile, "utf8")).toContain(`Graphic language in co-design ${stamp}`);

  await dialog.getByRole("button", { name: "AI summaries" }).click();
  await expect(dialog.getByTestId("ai-usage")).toContainText("This month");
});

test("library and source show AI summarised and Annotated", async ({ page }) => {
  await as(page, `/library/${targetId}`);
  const details = page.locator("header").filter({ has: page.getByLabel("Title", { exact: true }) });
  await expect(details.getByText("Annotated")).toHaveCount(0);
  // One word is enough.
  await setEditorText(page, page.getByRole("textbox", { name: "My notes" }), "Promising");
  await expect(details.getByText("Annotated")).toBeVisible(); // as soon as it's typed

  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });

  await page.goto("/library");
  const row = page.getByRole("listitem").filter({ hasText: TARGET });
  await expect(row.getByText("AI summarised")).toBeVisible();
  await expect(row.getByText("Annotated")).toBeVisible();
  // Any notes count; a source with none isn't annotated.
  const other = page.getByRole("listitem").filter({ hasText: `Notes test ${stamp}` });
  await expect(other.getByText("Annotated")).toBeVisible();
  const empty = page.getByRole("listitem").filter({ hasText: `Brand new ${stamp}` });
  await expect(empty).toBeVisible();
  await expect(empty.getByText("Annotated")).toHaveCount(0);

  // That summary is counted in Settings.
  await page.getByRole("button", { name: "Settings" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "AI summaries" }).click();
  await expect(dialog.getByTestId("ai-usage")).toContainText(/This month\s*1 request/);
});
