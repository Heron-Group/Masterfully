import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ownerId, REPO_DIR } from "./fixtures";
import { signIn } from "./helpers";

// The brief's target: the source network laid out in under a second with
// 500 sources and 2,000 links. Run on its own: MAP_PERF=1 npx playwright test e2e/map-performance.spec.ts

test.skip(!process.env.MAP_PERF, "Set MAP_PERF=1 to run");

const SOURCES = 500;
const LINKS = 2000;
const GROUPS = 20;
const email = `map-perf-${Date.now()}@example.com`;

let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

test("the source network lays out 500 sources and 2,000 links in under a second", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "/library", email);
  const dir = path.join(REPO_DIR, "users", ownerId(email));
  try {
    const ids = Array.from({ length: SOURCES }, (_, i) => `perf-${i}`);
    const links = new Map<string, string[]>();
    const seen = new Set<string>();
    while (seen.size < LINKS) {
      const a = Math.floor(random() * SOURCES);
      // Mostly within a group's neighbourhood, some across.
      const b = random() < 0.8 ? (a + 1 + Math.floor(random() * 40)) % SOURCES : Math.floor(random() * SOURCES);
      if (a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      links.set(ids[a], [...(links.get(ids[a]) ?? []), ids[b]]);
    }
    mkdirSync(path.join(dir, "sources"), { recursive: true });
    mkdirSync(path.join(dir, "groups"), { recursive: true });
    ids.forEach((id, i) => {
      const notes = (links.get(id) ?? []).map((to) => `See [this](/library/${to}).`).join("\n");
      writeFileSync(
        path.join(dir, "sources", `${id}.md`),
        `---\nid: ${id}\ntitle: Performance source ${i}\nauthors: []\ntype: article\nadded: 2026-10-11T10:00:00Z\nupdated: 2026-10-11T10:00:00Z\n---\n## Notes\n\n${notes}\n`,
      );
    });
    for (let g = 0; g < GROUPS; g++) {
      const members = ids.filter((_, i) => Math.floor(i / (SOURCES / GROUPS)) === g || (i % 37 === g && random() < 0.5));
      writeFileSync(
        path.join(dir, "groups", `perf-group-${g}.md`),
        `---\nid: perf-group-${g}\ntitle: Group ${g}\ncreated: 2026-10-11T10:00:${String(g).padStart(2, "0")}Z\nupdated: 2026-10-11T10:00:00Z\nsources:\n${members.map((m) => `  - id: ${m}`).join("\n")}\n---\n## Overview\n`,
      );
    }

    const started = Date.now();
    const res = await page.request.get("/api/map");
    const graph = await res.json();
    const apiMs = Date.now() - started;
    expect(graph.sources).toHaveLength(SOURCES);
    expect(graph.links).toHaveLength(LINKS);

    await page.goto("/map");
    const canvas = page.getByTestId("map-canvas");
    await expect(canvas).toHaveAttribute("data-layout-ms", /\d+/, { timeout: 30_000 });
    const layoutMs = Number(await canvas.getAttribute("data-layout-ms"));
    // The full layout follows from a worker without blocking the page.
    const refineStart = Date.now();
    await expect(canvas).toHaveAttribute("data-layout-done", "true", { timeout: 30_000 });
    const refinedMs = Date.now() - refineStart + layoutMs;
    const overlaps = await page.evaluate(() => {
      const el = document.querySelector("[data-testid=map-canvas]") as HTMLElement & { _cyreg: { cy: import("cytoscape").Core } };
      const ps = el._cyreg.cy.nodes(".source").map((n) => n.position());
      let o = 0;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) < 16) o++;
      return o;
    });
    // Panning: frames drawn while dragging the map for a second.
    const box = (await canvas.boundingBox())!;
    const counting = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const end = performance.now() + 1000;
          const tick = () => (performance.now() < end ? (n++, requestAnimationFrame(tick)) : resolve(n));
          requestAnimationFrame(tick);
        }),
    );
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(box.x + 30 + i * 8, box.y + 30 + i * 5);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    const frames = await counting;
    if (process.env.MAP_PERF_SHOT) await page.screenshot({ path: process.env.MAP_PERF_SHOT });
    // Next time, the finished layout comes straight from this browser's cache.
    await page.reload();
    await expect(canvas).toHaveAttribute("data-layout-done", "true", { timeout: 30_000 });
    const cachedMs = Number(await canvas.getAttribute("data-layout-ms"));
    console.log(
      `API ${apiMs} ms · first layout ${layoutMs} ms · full layout ${refinedMs} ms (${overlaps} overlapping) · cached ${cachedMs} ms · frames/s while panning ${frames}`,
    );
    expect(layoutMs).toBeLessThan(1000);
    expect(cachedMs).toBeLessThan(1000);
    expect(overlaps).toBeLessThan(SOURCES * 0.1); // the dense random links make a few near neighbours
  } finally {
    rmSync(path.join(dir, "sources"), { recursive: true, force: true });
    rmSync(path.join(dir, "groups"), { recursive: true, force: true });
  }
});
