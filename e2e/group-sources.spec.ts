import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerId, REPO_DIR } from "./fixtures";
import { waitForHydration } from "./helpers";

// A group's sources: newest published first by default, colour coding,
// and each source's AI overview. Also: names in one format, and a blank
// "Add source" page every time. As a fresh user.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `group-sources-${stamp}@example.com`;
const G = `order-group-${stamp}`;
const ids: Record<string, string> = {};
const title = (x: string) => `Order ${x} ${stamp}`;

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}
const userFile = (rel: string) => path.join(REPO_DIR, "users", ownerId(email), rel);
const read = (rel: string) => readFileSync(userFile(rel), "utf8");
/** Source titles in the order shown on the group page. */
const shownOrder = (page: Page) =>
  page
    .getByRole("button", { name: /^Reorder / })
    .evaluateAll((els) => els.map((el) => (el.getAttribute("aria-label") ?? "").replace(/^Reorder (.*) \(position \d+\)$/, "$1")));

test("set up sources from different years in a group", async ({ page }) => {
  await as(page, "/library");
  for (const [key, year, authors] of [
    ["Old", "2001", "TIM INGOLD"],
    ["New", "2020", "schön, d.a."],
    ["Undated", "", "Sanders EBN"],
  ] as const) {
    const res = await page.request.post("/api/upload/sources", { multipart: { title: title(key), year, authors } });
    ids[key] = ((await res.json()) as { id: string }).id;
  }
  mkdirSync(path.dirname(userFile(`groups/${G}.md`)), { recursive: true });
  // Saved in the order Undated, Old, New (as if dragged that way long ago).
  writeFileSync(
    userFile(`groups/${G}.md`),
    `---\nid: ${G}\ntitle: Order group ${stamp}\ncreated: 2026-10-20T10:00:00Z\nupdated: 2026-10-20T10:00:00Z\nsources:\n  - id: ${ids.Undated}\n  - id: ${ids.Old}\n  - id: ${ids.New}\n---\n## Overview\n`,
  );
  await expect.poll(async () => (await page.request.get(`/groups/${G}`)).status()).toBe(200);
});

test("names show in one format, however they were written", async ({ page }) => {
  await as(page, "/library");
  const row = (key: string) => page.getByRole("listitem").filter({ hasText: title(key) });
  await expect(row("Old")).toContainText("Ingold, Tim");
  await expect(row("New")).toContainText("Schön, D. A.");
  await expect(row("Undated")).toContainText("Sanders, E. B. N.");
});

test("a group lists newest published first; another order or a drag changes it", async ({ page }) => {
  await as(page, `/groups/${G}`);
  await expect(page.getByLabel("Order sources")).toHaveValue("newest");
  expect(await shownOrder(page)).toEqual([title("New"), title("Old"), title("Undated")]);

  await page.getByLabel("Order sources").selectOption("oldest");
  await expect.poll(() => shownOrder(page)).toEqual([title("Old"), title("New"), title("Undated")]);
  await expect.poll(() => read(`groups/${G}.md`)).toContain("order: oldest");

  // "Your order" is the order saved by dragging.
  await page.getByLabel("Order sources").selectOption("manual");
  await expect.poll(() => shownOrder(page)).toEqual([title("Undated"), title("Old"), title("New")]);
  await expect.poll(() => read(`groups/${G}.md`)).toContain("order: manual");

  // Dragging keeps your order (from whichever order was showing).
  test.skip(test.info().project.name !== "desktop", "Dragging with a mouse");
  await page.getByLabel("Order sources").selectOption("newest");
  await expect.poll(() => shownOrder(page)).toEqual([title("New"), title("Old"), title("Undated")]);
  await expect.poll(() => read(`groups/${G}.md`)).toContain("order: newest");
  await page.waitForLoadState("networkidle");
  // The first (New) dragged below the last.
  const handles = page.getByRole("button", { name: /^Reorder / });
  const from = (await handles.nth(0).boundingBox())!;
  const to = (await handles.nth(2).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 30, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByLabel("Order sources")).toHaveValue("manual");
  await expect.poll(() => read(`groups/${G}.md`)).toContain("order: manual");
  await page.reload();
  await waitForHydration(page);
  expect(await shownOrder(page)).toEqual([title("Old"), title("Undated"), title("New")]);
});

test("sources can be colour coded in a group", async ({ page }) => {
  await as(page, `/groups/${G}`);
  await page.getByRole("button", { name: `Colour for ${title("Old")}: none` }).click();
  await page.getByRole("dialog", { name: "Colour code" }).getByRole("radio", { name: "Green" }).click();
  await expect(page.getByRole("button", { name: `Colour for ${title("Old")}: Green` })).toBeVisible();
  await expect.poll(() => read(`groups/${G}.md`)).toMatch(new RegExp(`- id: ${ids.Old}\\n {4}colour: "?#59a14f"?`));

  await page.getByRole("button", { name: `Colour for ${title("Old")}: Green` }).click();
  await page.getByRole("dialog", { name: "Colour code" }).getByRole("button", { name: "No colour" }).click();
  await expect(page.getByRole("button", { name: `Colour for ${title("Old")}: none` })).toBeVisible();
  await expect.poll(() => read(`groups/${G}.md`)).not.toContain("colour:");
});

test("summarising a source adds its short AI overview to the group page", async ({ page }) => {
  await as(page, `/groups/${G}`);
  await expect(page.getByRole("listitem").filter({ hasText: title("New") })).toContainText("No AI overview yet.");
  await as(page, `/library/${ids.New}`);
  await page.getByRole("button", { name: "Summarise" }).click();
  await expect(page.getByText(/AI-generated \d+ \w+ \d{4} · fake-model/)).toBeVisible({ timeout: 30_000 });
  // The overview is kept apart from the summary shown here.
  await expect(page.getByRole("heading", { name: "Key findings and citable claims" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In brief" })).toHaveCount(0);
  expect(read(`sources/${ids.New}.md`)).toMatch(/^ai_overview: .*A simulated overview/m);

  await as(page, `/groups/${G}`);
  await expect(page.getByLabel(`AI overview of ${title("New")}`)).toContainText("A simulated overview");
});

test("Add source opens a blank page every time", async ({ page }) => {
  await as(page, "/library");
  await page.getByRole("link", { name: "Add source" }).click();
  const titleBox = page.getByLabel("Title", { exact: true }).filter({ visible: true });
  await titleBox.fill(title("Fresh"));
  await titleBox.press("Enter");
  await page.waitForURL(/\/library\/(?!new)[^/?]+$/);
  await page.getByRole("link", { name: "Library" }).first().click();
  await page.waitForURL("**/library");
  await page.getByRole("link", { name: "Add source" }).click();
  await page.waitForURL("**/library/new");
  await expect(page.getByText("Give the source a title, or add a PDF or link, to save it")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true }).filter({ visible: true })).toHaveValue("");
});
