import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { handRemove, handWrite, workspace } from "./fixtures";
import { signIn, waitForHydration } from "./helpers";

// The Source Map, against a small hand-written set: two sources in a group,
// one linking to the other twice, plus an ungrouped source.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const A = `map-a-${stamp}`;
const B = `map-b-${stamp}`;
const C = `map-c-${stamp}`;
const G = `map-group-${stamp}`;
const TITLE_A = `Map Alpha ${stamp}`;
const TITLE_B = `Map Beta ${stamp}`;
const TITLE_C = `Map Gamma ${stamp}`;
const GROUP = `Map Group ${stamp}`;

const source = (id: string, title: string, notes = "") =>
  `---\nid: ${id}\ntitle: ${title}\nauthors: [ "Tester, Ann" ]\nyear: 2020\ntype: article\nadded: 2026-10-11T10:00:00Z\nupdated: 2026-10-11T10:00:00Z\n---\n## Notes\n\n${notes}\n`;

test.beforeAll(async ({ browser }) => {
  // Sign in once so the owner's folder exists.
  const page = await browser.newPage();
  await signIn(page, "/library");
  await page.close();
  handWrite(`sources/${A}.md`, source(A, TITLE_A, `Builds on [the primer](/library/${B}) and [its sequel](/library/${B}).`));
  handWrite(`sources/${B}.md`, source(B, TITLE_B));
  handWrite(`sources/${C}.md`, source(C, TITLE_C));
  handWrite(
    `groups/${G}.md`,
    `---\nid: ${G}\ntitle: ${GROUP}\ncreated: 2026-10-11T10:00:00Z\nupdated: 2026-10-11T10:00:00Z\nsources:\n  - id: ${A}\n  - id: ${B}\n---\n## Overview\n\nA group for the map test.\n`,
  );
});

test.afterAll(() => {
  for (const f of [`sources/${A}.md`, `sources/${B}.md`, `sources/${C}.md`, `groups/${G}.md`]) handRemove(f);
});

test("the map endpoint returns the signed-in user's sources, links and groups", async ({ page }) => {
  await signIn(page, "/library");
  const res = await page.request.get("/api/map");
  expect(res.ok()).toBe(true);
  const graph = await res.json();
  const link = graph.links.find((l: { from: string; to: string }) => l.from === A && l.to === B);
  expect(link).toMatchObject({ count: 2, labels: ["the primer", "its sequel"] });
  expect(graph.groups.find((g: { id: string }) => g.id === G)).toMatchObject({ title: GROUP, sources: [A, B] });
  expect(graph.sources.find((s: { id: string }) => s.id === C)).toMatchObject({ groups: [] });

  // Another user sees none of it.
  const other = await (await page.context().browser()!.newContext()).newPage();
  await signIn(other, "/library", `map-other-${stamp}@example.com`);
  const theirs = await (await other.request.get("/api/map")).json();
  expect(theirs.sources.some((s: { id: string }) => s.id === A)).toBe(false);
  await other.close();

  // Signed out: refused.
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`${new URL(page.url()).origin}/api/map`)).status()).toBe(401);
  await anon.close();
});

test("the map draws the network; search selects a source and the panel shows its links", async ({ page }) => {
  await signIn(page, "/map");
  await expect(page.getByRole("link", { name: "Map", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("map-canvas").locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Drawing your map…")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Find a source or group" }).fill(`Alpha ${stamp}`);
  await page.getByRole("option").filter({ hasText: TITLE_A }).click();
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel.getByRole("heading", { name: TITLE_A })).toBeVisible();
  await expect(panel).toContainText("Links to");
  await expect(panel).toContainText("“the primer”, “its sequel”");
  await expect(panel.getByRole("link", { name: "Open source" })).toHaveAttribute("href", `/library/${A}`);

  // Following a link in the panel moves to that source.
  await panel.getByRole("button", { name: new RegExp(TITLE_B) }).click();
  await expect(panel.getByRole("heading", { name: TITLE_B })).toBeVisible();
  await expect(panel).toContainText("Linked from");

  // And a group chip to its group.
  await panel.getByRole("button", { name: GROUP }).click();
  await expect(panel.getByRole("heading", { name: GROUP })).toBeVisible();
  await expect(panel).toContainText("2 sources");
  await expect(panel.getByRole("link", { name: "Open group" })).toHaveAttribute("href", `/groups/${G}`);

  await panel.getByRole("button", { name: "Close details" }).click();
  await expect(panel).toHaveCount(0);
});

test("the legend lists groups and hides them as a filter", async ({ page }) => {
  await signIn(page, "/map");
  const legend = page.getByRole("group", { name: "Reading groups" });
  const box = legend.getByRole("checkbox", { name: new RegExp(GROUP) });
  await expect(box).toBeChecked({ timeout: 15_000 });
  await expect(legend.getByText("Not in a group")).toBeVisible();
  await box.uncheck();
  await expect(box).not.toBeChecked();
  // The hidden group's sources are hidden in the graph.
  const hidden = await page.evaluate((id) => {
    const el = document.querySelector("[data-testid=map-canvas]") as HTMLElement & { _cyreg?: { cy?: { $id: (i: string) => { hasClass: (c: string) => boolean } } } };
    return el._cyreg?.cy?.$id(`s:${id}`).hasClass("hidden");
  }, A);
  expect(hidden).toBe(true);
});

test("a group's map colour is chosen on the group page and saved in map-layout.json", async ({ page }) => {
  await signIn(page, `/groups/${G}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: /^Map colour: / }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a colour" });
  await dialog.getByRole("radio", { name: "Teal" }).click();
  await expect(page.getByRole("button", { name: "Map colour: Teal" })).toBeVisible();
  await expect
    .poll(() => JSON.parse(readFileSync(workspace("map-layout.json"), "utf8")).colours[G])
    .toBe("#2a9d8f");
});
