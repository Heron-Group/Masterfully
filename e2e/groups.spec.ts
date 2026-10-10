import { expect, test, type Page } from "@playwright/test";
import { ownerHas, workspace } from "./fixtures";
import { readFileSync } from "node:fs";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const TITLE = `E2E Methods ${stamp}`;
let groupUrl = "";

const groupFile = () => readFileSync(workspace(`groups/${groupUrl.split("/").pop()}.md`), "utf8");

async function openGroup(page: Page) {
  await signIn(page, groupUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.afterAll(async ({ browser }) => {
  if (!groupUrl) return;
  const page = await browser.newPage();
  await signIn(page, "/groups");
  await page.getByText(/sources?$/).or(page.getByRole("img", { name: "No reading groups yet." })).first().waitFor();
  for (const link of await page.getByRole("link", { name: /E2E Methods/ }).all()) {
    const href = await link.getAttribute("href");
    if (!href) continue;
    await page.goto(href);
    await page.getByRole("button", { name: "Delete group…" }).click();
    await page.getByRole("button", { name: "Delete group", exact: true }).click();
    await page.waitForURL("**/groups");
  }
  await page.close();
});

test("create a group, add sources from the library, see it in the index", async ({ page }) => {
  await signIn(page, "/groups");
  await page.getByRole("link", { name: "New group" }).click();
  // The blank group page: the title creates it.
  await expect(page.getByText("Give the group a title to save it")).toBeVisible();
  await page.getByLabel("Group title").fill(TITLE);
  await page.getByLabel("Group title").press("Enter");
  await page.waitForURL(/\/groups\/e2e-methods-/);
  groupUrl = page.url();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);

  await page.getByRole("button", { name: "Add from library" }).click();
  const picker = page.getByRole("dialog", { name: "Add sources from the library" });
  for (const q of ["Schön", "Ingold", "Sanders"]) {
    await picker.getByLabel("Search your library").fill(q);
    await picker.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByRole("heading", { name: /Sources \(\d+\)/ })).toContainText(String(["Schön", "Ingold", "Sanders"].indexOf(q) + 1));
  }
  await picker.getByRole("button", { name: "Done" }).click();

  await page.goto("/groups");
  const row = page.getByRole("link", { name: new RegExp(TITLE) });
  await expect(row).toContainText("3 sources");
});

test("drag and drop reorders sources and saves the order", async ({ page }) => {
  await openGroup(page);
  const handles = page.getByRole("button", { name: /^Reorder / });
  await expect(handles).toHaveCount(3);
  const from = (await handles.nth(0).boundingBox())!;
  const to = (await handles.nth(2).boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 + 30 };
  if (test.info().project.name === "desktop") {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 20, { steps: 5 });
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
  } else {
    // Playwright can't perform a touch drag, so dispatch the pointer events
    // a finger produces (pointerType "touch"), which is what dnd-kit handles.
    await handles.nth(0).evaluate(
      async (el, { start, end }) => {
        const fire = (target: EventTarget, type: string, x: number, y: number) =>
          target.dispatchEvent(
            new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }),
          );
        fire(el, "pointerdown", start.x, start.y);
        for (let i = 1; i <= 20; i++) {
          fire(document, "pointermove", start.x + ((end.x - start.x) * i) / 20, start.y + ((end.y - start.y) * i) / 20);
          await new Promise((r) => setTimeout(r, 16));
        }
        fire(document, "pointerup", end.x, end.y);
      },
      { start, end },
    );
  }
  await expect.poll(() => groupFile().match(/- id: (\S+)/g)?.map((l) => l.slice(6))).toEqual([
    "ingold-2013-making",
    "sanders-2008-co-creation-new",
    "schon-1983-reflective-practitioner",
  ]);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Reorder / }).first()).toHaveAttribute("aria-label", /Making/);
});

test("group note, expandable source notes and overview are saved separately", async ({ page }) => {
  await openGroup(page);
  const note = page.getByLabel(/Group note for Co-creation/);
  await note.fill("Defines the vocabulary");
  await note.blur();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  expect(groupFile()).toContain('note: Defines the vocabulary');

  await page.getByRole("button", { name: "Show my notes" }).nth(1).click();
  await expect(page.getByText("Distinguishes co-creation from co-design.")).toBeVisible();

  await page.getByRole("textbox", { name: "My overview" }).fill("Methods texts for chapter 3.");
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(groupFile).toContain("## Overview\n\nMethods texts for chapter 3.");
});

test("rename the group without renaming the file", async ({ page }) => {
  await openGroup(page);
  await page.getByLabel("Group title").fill(`${TITLE} (renamed)`);
  await page.getByLabel("Group title").press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${TITLE} (renamed)`);
  expect(groupFile()).toContain(`title: ${TITLE} (renamed)`);
});

test("remove a source from the group; it stays in the library", async ({ page }) => {
  await openGroup(page);
  await page.getByRole("button", { name: /Remove Making.* from this group/ }).click();
  await expect(page.getByRole("button", { name: /^Reorder / })).toHaveCount(2);
  await page.goto("/library");
  await expect(page.getByRole("link", { name: /Making: Anthropology/ })).toBeVisible();
});

test("deleting a group keeps its sources", async ({ page }) => {
  await openGroup(page);
  await page.getByRole("button", { name: "Delete group…" }).click();
  await page.getByRole("button", { name: "Delete group", exact: true }).click();
  await page.waitForURL("**/groups");
  await expect(page.getByRole("link", { name: new RegExp(TITLE) })).toHaveCount(0);
  expect(ownerHas(`groups/${groupUrl.split("/").pop()}.md`)).toBe(false);
  groupUrl = "";
});
