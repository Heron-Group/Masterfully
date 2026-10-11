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

  // In the editor the link is a mention; Cmd/Ctrl-click opens the source.
  const mention = page.locator(".cm-md-source-link", { hasText: "the primer" }).first();
  await expect(mention).toBeVisible();
  await page.keyboard.press("Escape"); // leave the editor so the link shows as a mention
  await mention.click({ modifiers: ["ControlOrMeta"] });
  await page.waitForURL(`**/library/${targetId}`);
});

test("library and source show AI summarised and Annotated", async ({ page }) => {
  await as(page, `/library/${targetId}`);
  const details = page.locator("header").filter({ has: page.getByLabel("Title", { exact: true }) });
  await expect(details.getByText("Annotated")).toHaveCount(0);
  const words = Array.from({ length: 51 }, (_, i) => `word${i}`).join(" ");
  await setEditorText(page, page.getByRole("textbox", { name: "My notes" }), words);
  await expect(details.getByText("Annotated")).toBeVisible(); // as soon as it's typed

  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 15_000 });

  await page.goto("/library");
  const row = page.getByRole("listitem").filter({ hasText: TARGET });
  await expect(row.getByText("AI summarised")).toBeVisible();
  await expect(row.getByText("Annotated")).toBeVisible();
  const other = page.getByRole("listitem").filter({ hasText: `Notes test ${stamp}` });
  await expect(other.getByText("Annotated")).toHaveCount(0);
});
