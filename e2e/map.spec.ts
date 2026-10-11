import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { handRemove, handWrite, workspace } from "./fixtures";
import { signIn, waitForHydration } from "./helpers";

// The Source Map, against a small hand-written set with known answers:
//   G1 = A, B, F    G2 = B, D    G3 = E      C is in no group
//   A → B (twice, two phrases), B → D, D → E
// so B is shared (G1, G2), D → E is a bridge link (G2/G3), G1↔G2 and
// G2↔G3 cross over (strength 1 each), C is isolated and F is unlinked.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const id = (x: string) => `map-${x}-${stamp}`;
const [A, B, C, D, E, F] = ["a", "b", "c", "d", "e", "f"].map(id);
const [G1, G2, G3] = ["g1", "g2", "g3"].map((g) => `map-${g}-${stamp}`);
const title = (x: string) => `Map ${x} ${stamp}`;
const groupTitle = (x: string) => `Map Group ${x} ${stamp}`;

const source = (sid: string, t: string, notes = "") =>
  `---\nid: ${sid}\ntitle: ${t}\nauthors: [ "Tester, Ann" ]\nyear: 2020\ntype: article\nadded: 2026-10-11T10:00:00Z\nupdated: 2026-10-11T10:00:00Z\n---\n## Notes\n\n${notes}\n`;
const group = (gid: string, t: string, members: string[]) =>
  `---\nid: ${gid}\ntitle: ${t}\ncreated: 2026-10-11T10:00:00Z\nupdated: 2026-10-11T10:00:00Z\nsources:\n${members.map((m) => `  - id: ${m}`).join("\n")}\n---\n## Overview\n\nA group for the map test.\n`;

const FILES = [...[A, B, C, D, E, F].map((s) => `sources/${s}.md`), ...[G1, G2, G3].map((g) => `groups/${g}.md`)];
const layoutFile = () => workspace("map-layout.json");
const readLayout = () => (existsSync(layoutFile()) ? JSON.parse(readFileSync(layoutFile(), "utf8")) : {});

test.beforeAll(async ({ browser }) => {
  // Sign in once so the owner's folder exists.
  const page = await browser.newPage();
  await signIn(page, "/library");
  await page.close();
  handWrite(`sources/${A}.md`, source(A, title("Alpha"), `Builds on [the primer](/library/${B}) and [its sequel](/library/${B}).`));
  handWrite(`sources/${B}.md`, source(B, title("Beta"), `Answered by [Delta](/library/${D}).`));
  handWrite(`sources/${C}.md`, source(C, title("Gamma")));
  handWrite(`sources/${D}.md`, source(D, title("Delta"), `Leads to [Epsilon](/library/${E}).`));
  handWrite(`sources/${E}.md`, source(E, title("Epsilon")));
  handWrite(`sources/${F}.md`, source(F, title("Phi")));
  handWrite(`groups/${G1}.md`, group(G1, groupTitle("One"), [A, B, F]));
  handWrite(`groups/${G2}.md`, group(G2, groupTitle("Two"), [B, D]));
  handWrite(`groups/${G3}.md`, group(G3, groupTitle("Three"), [E]));
});

test.afterAll(() => {
  for (const f of FILES) handRemove(f);
  // Leave the owner's map layout as it was, apart from this run's entries.
  const layout = readLayout();
  if (!layout.version) return;
  for (const g of [G1, G2, G3]) delete layout.colours?.[g];
  for (const view of Object.keys(layout.pins ?? {})) {
    for (const node of Object.keys(layout.pins[view])) if (node.includes(String(stamp))) delete layout.pins[view][node];
  }
  layout.lastView = "network";
  writeFileSync(layoutFile(), JSON.stringify(layout, null, 2));
});

/** Ask the page's Cytoscape instance something. */
function cyEval<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([body, a]) => {
      const el = document.querySelector("[data-testid=map-canvas]") as HTMLElement & { _cyreg?: { cy?: unknown } };
      return new Function("cy", "arg", body)(el._cyreg?.cy, a);
    },
    [fn, arg] as const,
  );
}

/** Wait for the map in a view to be drawn with the fixture's nodes. */
async function mapReady(page: Page, view: "network" | "groups" = "network") {
  await expect(page.getByTestId("map-canvas")).toHaveAttribute("data-view", view);
  await expect.poll(() => cyEval<number>(page, `return cy && !cy.destroyed() ? cy.$id(arg).length : 0`, view === "network" ? `s:${A}` : `g:${G1}`), { timeout: 15_000 }).toBe(1);
}

async function openMap(page: Page) {
  await signIn(page, "/map");
  await mapReady(page, (await page.getByTestId("map-canvas").getAttribute("data-view")) as "network" | "groups");
  if ((await page.getByTestId("map-canvas").getAttribute("data-view")) !== "network") {
    await page.getByRole("button", { name: "Source network" }).click();
    await mapReady(page);
  }
}

const panel = (page: Page, name = "Details") => page.getByRole("complementary", { name });
const toggle = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("the map endpoint returns the user's sources, links, groups and crossover", async ({ page }) => {
  await signIn(page, "/library");
  const res = await page.request.get("/api/map");
  expect(res.ok()).toBe(true);
  const graph = await res.json();
  expect(graph.links.find((l: { from: string; to: string }) => l.from === A && l.to === B)).toMatchObject({ count: 2, labels: ["the primer", "its sequel"] });
  expect(graph.groups.find((g: { id: string }) => g.id === G1)).toMatchObject({ title: groupTitle("One"), sources: [A, B, F] });
  expect(graph.crossover.shared).toContainEqual({ source: B, groups: [G1, G2] });
  expect(graph.crossover.bridges).toContainEqual({ a: D, b: E, aGroups: [G2], bGroups: [G3] });
  const pair = (a: string, b: string) => graph.crossover.pairs.find((p: { a: string; b: string }) => p.a === a && p.b === b);
  expect(pair(G1, G2)).toMatchObject({ shared: [B], bridges: [], strength: 1 });
  expect(pair(G2, G3)).toMatchObject({ shared: [], strength: 1 });
  const s = (x: string) => graph.sources.find((y: { id: string }) => y.id === x);
  expect(s(C)).toMatchObject({ isolated: true, groups: [] });
  expect(s(F)).toMatchObject({ unlinked: true });

  // Another user sees none of it.
  const other = await (await page.context().browser()!.newContext()).newPage();
  await signIn(other, "/library", `map-other-${stamp}@example.com`);
  const theirs = await (await other.request.get("/api/map")).json();
  expect(theirs.sources.some((x: { id: string }) => x.id === A)).toBe(false);
  await other.close();

  // Signed out: refused.
  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`${new URL(page.url()).origin}/api/map`)).status()).toBe(401);
  await anon.close();
});

test("search selects a source; the panel shows its links and groups", async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole("link", { name: "Map", exact: true }).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("definition").first()).toBeVisible(); // the summary bar

  await page.getByRole("combobox", { name: "Find a source or group" }).fill(`Alpha ${stamp}`);
  await page.getByRole("option").filter({ hasText: title("Alpha") }).click();
  const details = panel(page);
  await expect(details.getByRole("heading", { name: title("Alpha") })).toBeVisible();
  await expect(details).toContainText("“the primer”, “its sequel”");
  await expect(details.getByRole("link", { name: "Open source" })).toHaveAttribute("href", `/library/${A}`);

  await details.getByRole("button", { name: new RegExp(title("Beta")) }).click();
  await expect(details.getByRole("heading", { name: title("Beta") })).toBeVisible();
  await expect(details).toContainText("Shared");
  await details.getByRole("button", { name: groupTitle("Two") }).click();
  await expect(details.getByRole("heading", { name: groupTitle("Two") })).toBeVisible();
  await expect(details.getByRole("link", { name: "Open group" })).toHaveAttribute("href", `/groups/${G2}`);
  await details.getByRole("button", { name: "Close details" }).click();
  await expect(details).toHaveCount(0);
});

test("the legend hides groups; a source stays while any of its groups is shown", async ({ page }) => {
  await openMap(page);
  const legend = page.getByRole("group", { name: "Reading groups" });
  const expand = legend.getByRole("button", { name: "Reading groups" });
  if ((await expand.getAttribute("aria-expanded")) === "false") await expand.click();
  const hidden = (node: string) => cyEval<boolean>(page, `return cy.$id(arg).hasClass("hidden")`, node);
  await legend.getByRole("checkbox", { name: new RegExp(groupTitle("One")) }).uncheck();
  await expect.poll(() => hidden(`s:${A}`)).toBe(true);
  expect(await hidden(`s:${B}`)).toBe(false); // still in G2
  await legend.getByRole("checkbox", { name: "Not in a group" }).uncheck();
  await expect.poll(() => hidden(`s:${C}`)).toBe(true);
});

test("Crossover mode highlights shared sources and bridge links and lists them", async ({ page }) => {
  await openMap(page);
  await toggle(page, "Crossover").click();
  const list = panel(page, "Crossovers");
  await expect(list.getByRole("heading", { name: "Crossovers" })).toBeVisible();
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("xhl")`, `s:${B}`)).toBe(true);
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("xhl")`, `l:${D}>${E}`)).toBe(true);
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("dim")`, `s:${C}`)).toBe(true);

  // The pair G1 ↔ G2 opens to show exactly its shared source.
  const pair = list.locator("details").filter({ hasText: groupTitle("One") }).filter({ hasText: groupTitle("Two") });
  await pair.locator("summary").click();
  await expect(pair.getByRole("button", { name: title("Beta") })).toBeVisible();
  // Bridge links read "A (Group X) ↔ B (Group Y)".
  await expect(list.getByRole("listitem").filter({ hasText: `${title("Delta")} (${groupTitle("Two")}) ↔ ${title("Epsilon")} (${groupTitle("Three")})` }).first()).toBeVisible();
  await toggle(page, "Crossover").click();
  await expect(list).toHaveCount(0);
});

test("Gaps mode shows isolated and unlinked sources", async ({ page }) => {
  await openMap(page);
  await toggle(page, "Gaps").click();
  const list = panel(page, "Gaps");
  await expect(list.getByRole("button", { name: title("Gamma") })).toBeVisible();
  await expect(list.getByRole("button", { name: new RegExp(title("Phi")) })).toBeVisible();
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("gap") && cy.$id(arg).hasClass("isolated")`, `s:${C}`)).toBe(true);
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("gap")`, `s:${F}`)).toBe(true);
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("gap")`, `s:${A}`)).toBe(false);
});

test("group overview: lines scaled by crossover; a line lists what's behind it; it reopens on the last view", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "Group overview" }).click();
  await mapReady(page, "groups");
  expect(await cyEval<number>(page, `return cy.$id(arg).data("strength")`, `x:${G1}>${G2}`)).toBe(1);
  expect(await cyEval<number>(page, `return cy.nodes(".source").length`)).toBe(0);

  await cyEval(page, `cy.$id(arg).emit("tap")`, `x:${G1}>${G2}`);
  const details = panel(page);
  await expect(details).toContainText("Strength 1: 1 shared source and 0 bridge links.");
  await expect(details.getByRole("button", { name: title("Beta") })).toBeVisible();
  await cyEval(page, `cy.$id(arg).emit("tap")`, `x:${G2}>${G3}`);
  await expect(details).toContainText(`${title("Delta")} (${groupTitle("Two")}) ↔ ${title("Epsilon")} (${groupTitle("Three")})`);

  await expect.poll(() => readLayout().lastView).toBe("groups");
  await page.reload();
  await mapReady(page, "groups");

  // Double-clicking a group opens the network focused on it.
  await cyEval(page, `cy.$id(arg).emit("dbltap")`, `g:${G3}`);
  await mapReady(page, "network");
  await expect(page.getByText(`Focused on ${groupTitle("Three")}`)).toBeVisible();
  await expect.poll(() => cyEval<boolean>(page, `return cy.$id(arg).hasClass("unfocused")`, `s:${A}`)).toBe(true);
  expect(await cyEval<boolean>(page, `return cy.$id(arg).hasClass("unfocused")`, `s:${E}`)).toBe(false);
});

test("focus mode shows a source's neighbours 1 or 2 steps away; Escape returns", async ({ page }) => {
  await openMap(page);
  const unfocused = (x: string) => cyEval<boolean>(page, `return cy.$id(arg).hasClass("unfocused")`, `s:${x}`);
  await cyEval(page, `cy.$id(arg).emit("dbltap")`, `s:${A}`);
  await expect(page.getByText(`Focused on ${title("Alpha")}`)).toBeVisible();
  await expect.poll(() => unfocused(C)).toBe(true);
  expect(await unfocused(B)).toBe(false);
  expect(await unfocused(D)).toBe(true);
  await page.getByRole("button", { name: "2 steps" }).click();
  await expect.poll(() => unfocused(D)).toBe(false);
  expect(await unfocused(E)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByText(`Focused on ${title("Alpha")}`)).toHaveCount(0);
  await expect.poll(() => unfocused(C)).toBe(false);
});

test("a dragged node stays pinned after a reload; Reset layout forgets it", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "Dragging with a mouse");
  await openMap(page);
  const before = await cyEval<{ x: number; y: number }>(page, `const n = cy.$id(arg); const b = cy.container().getBoundingClientRect(); const p = n.renderedPosition(); return { x: b.left + p.x, y: b.top + p.y }`, `s:${C}`);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 40, { steps: 8 });
  await page.mouse.up();
  const pinned = await cyEval<{ x: number; y: number }>(page, `const p = cy.$id(arg).position(); return { x: p.x, y: p.y }`, `s:${C}`);
  await expect.poll(() => readLayout().pins?.network?.[`s:${C}`], { timeout: 5000 }).toBeTruthy();

  await page.reload();
  await mapReady(page);
  const after = await cyEval<{ x: number; y: number }>(page, `const p = cy.$id(arg).position(); return { x: p.x, y: p.y }`, `s:${C}`);
  expect(Math.abs(after.x - pinned.x)).toBeLessThan(1);
  expect(Math.abs(after.y - pinned.y)).toBeLessThan(1);

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect.poll(() => readLayout().pins?.network).toBeUndefined();
  await expect(page.getByRole("button", { name: "Reset layout" })).toHaveCount(0);
});

test("export saves SVG with editable text and the legend, and PNG", async ({ page }) => {
  test.skip(test.info().project.name === "mobile-safari", "Downloads in WebKit");
  await openMap(page);
  await page.getByRole("button", { name: "Export" }).click();
  const [svgDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /SVG/ }).click()]);
  expect(svgDownload.suggestedFilename()).toMatch(/^source-map-network-\d{4}-\d{2}-\d{2}\.svg$/);
  const svg = readFileSync(await svgDownload.path(), "utf8");
  expect(svg).toContain('<g id="Legend">');
  expect(svg).toContain(`>${groupTitle("One")}</text>`);
  expect(svg).toMatch(/<text[^>]*>Source map · Source network<\/text>/);
  expect(svg).toContain(new Date().getFullYear().toString());

  await page.getByRole("button", { name: "Export" }).click();
  const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /PNG/ }).click()]);
  const png = readFileSync(await pngDownload.path());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.length).toBeGreaterThan(5000);
});

test("a group's map colour is chosen on the group page and saved in map-layout.json", async ({ page }) => {
  await signIn(page, `/groups/${G1}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: /^Map colour: / }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a colour" });
  await dialog.getByRole("radio", { name: "Teal" }).click();
  await expect(page.getByRole("button", { name: "Map colour: Teal" })).toBeVisible();
  await expect.poll(() => readLayout().colours?.[G1]).toBe("#2a9d8f");
});
