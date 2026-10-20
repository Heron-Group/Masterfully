import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerId, REPO_DIR } from "./fixtures";
import { waitForHydration } from "./helpers";

// Archiving sources and reading groups, as a fresh user: A and B are in
// group G (A links to B), C is on its own.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `archive-${stamp}@example.com`;
const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
const G = `archive-group-${stamp}`;
const GROUP = `Archive group ${stamp}`;
const title = (x: string) => `Archive ${x} ${stamp}`;

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}
const userFile = (rel: string) => path.join(REPO_DIR, "users", ownerId(email), rel);
const read = (rel: string) => readFileSync(userFile(rel), "utf8");
const row = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: text });

test("set up three sources and a group", async ({ page }) => {
  await as(page, "/library");
  for (const x of ["c", "b", "a"] as const) {
    const notes = x === "a" ? `Builds on [B](/library/${ids.b}).` : "";
    const res = await page.request.post("/api/upload/sources", { multipart: { title: title(x.toUpperCase()), notes } });
    ids[x] = ((await res.json()) as { id: string }).id;
  }
  mkdirSync(path.dirname(userFile(`groups/${G}.md`)), { recursive: true });
  writeFileSync(
    userFile(`groups/${G}.md`),
    `---\nid: ${G}\ntitle: ${GROUP}\ncreated: 2026-10-16T10:00:00Z\nupdated: 2026-10-16T10:00:00Z\nsources:\n  - id: ${ids.a}\n    note: Why A matters\n  - id: ${ids.b}\n---\n## Overview\n`,
  );
  // The app picks up files written by hand on its next scan (at most every half second).
  await expect.poll(async () => (await page.request.get(`/groups/${G}`)).status()).toBe(200);
});

test("a group's sources show as in the library, still reorderable and removable", async ({ page }) => {
  await as(page, `/groups/${G}`);
  const a = row(page, title("A"));
  await expect(a.getByText("Links to 1")).toBeVisible();
  await expect(a.getByText("Annotated")).toBeVisible();
  await expect(row(page, title("B")).getByText("Linked from 1")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Reorder ${title("A")}`) })).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove ${title("B")} from this group` })).toBeVisible();
  await expect(a.getByText("No AI overview yet.")).toBeVisible();
});

test("an archived source is hidden from the library unless asked for", async ({ page }) => {
  await as(page, `/library/${ids.c}`);
  await page.getByRole("button", { name: "Archive source" }).click();
  await expect(page.getByText(/Archived \d+ \w+ \d{4}\. This source is hidden/)).toBeVisible();
  await expect.poll(() => read(`sources/${ids.c}.md`)).toMatch(/^archived: /m);

  await page.goto("/library");
  await expect(row(page, title("A"))).toBeVisible();
  await expect(row(page, title("C"))).toHaveCount(0);
  await expect(page.getByText("1 archived not shown")).toBeVisible();
  await page.getByLabel("Show archived").selectOption("archived");
  await expect(row(page, title("C")).getByText("Archived")).toBeVisible();
  await expect(row(page, title("A"))).toHaveCount(0);
  await page.getByLabel("Show archived").selectOption("all");
  await expect(row(page, title("A"))).toBeVisible();
  await expect(row(page, title("C"))).toBeVisible();
});

test("archiving a group archives its sources; groups, library and map hide them", async ({ page }) => {
  await as(page, `/groups/${G}`);
  await page.getByRole("button", { name: "Archive group…" }).click();
  await page.getByRole("alertdialog", { name: "Archive group" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText(/This group \(and the sources archived with it\) is hidden/)).toBeVisible();
  await expect.poll(() => read(`sources/${ids.a}.md`)).toContain(`archived_with: ${G}`);

  await page.goto("/groups");
  await expect(row(page, GROUP)).toHaveCount(0);
  await expect(page.getByText("1 archived not shown")).toBeVisible();
  await page.getByLabel("Show archived").selectOption("archived");
  await expect(row(page, GROUP).getByText("Archived")).toBeVisible();
  await page.getByLabel("Search groups").fill("nothing like this");
  await expect(page.getByText("No groups match.")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByText("3 archived not shown")).toBeVisible();

  // The map leaves them out, unless archived items are shown.
  const current = await (await page.request.get("/api/map")).json();
  expect(current.sources).toHaveLength(0);
  expect(current.groups).toHaveLength(0);
  const all = await (await page.request.get("/api/map?archived=1")).json();
  expect(all.sources.map((s: { id: string }) => s.id).sort()).toEqual(Object.values(ids).sort());
  expect(all.groups[0]).toMatchObject({ id: G, archived: true });
  await page.goto("/map");
  await page.getByRole("button", { name: "Show archived sources" }).click();
  await expect(page.getByRole("button", { name: "Show archived", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const el = document.querySelector("[data-testid=map-canvas]") as (HTMLElement & { _cyreg?: { cy?: { $id: (i: string) => { hasClass: (c: string) => boolean; length: number } } } }) | null;
        const node = el?._cyreg?.cy?.$id(`s:${id}`);
        return !!node?.length && node.hasClass("archived");
      }, ids.a),
    )
    .toBe(true);
});

test("unarchiving the group brings back only the sources archived with it", async ({ page }) => {
  await as(page, `/groups/${G}`);
  await page.getByRole("button", { name: "Unarchive" }).click();
  await expect(page.getByRole("button", { name: "Unarchive" })).toHaveCount(0);
  await page.goto("/library");
  await expect(row(page, title("A"))).toBeVisible();
  await expect(row(page, title("B"))).toBeVisible();
  await expect(row(page, title("C"))).toHaveCount(0); // archived on its own
  await expect(page.getByText("1 archived not shown")).toBeVisible();
});
