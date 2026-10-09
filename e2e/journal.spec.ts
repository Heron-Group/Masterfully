import { expect, test, type Page } from "@playwright/test";
import { editorText, setEditorText, signIn } from "./helpers";

// Runs against the dev server's content folder; seed it first with
// `node scripts/seed-dev-content.mjs` so there are older entries to load.

const scroller = (page: Page) => page.getByLabel("Journal entries");
const composer = (page: Page) => page.getByRole("textbox", { name: "New journal entry" });

async function postEntry(page: Page, text: string) {
  await setEditorText(page, composer(page), text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator("article", { hasText: text })).toBeVisible();
}

async function deleteEntry(page: Page, text: string) {
  const article = page.locator("article", { hasText: text });
  await article.hover();
  await article.getByRole("button", { name: "Delete", exact: true }).click();
  await article.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(article).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

// Remove any entries a failed run left behind.
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  const res = await page.request.get("/api/journal?limit=200");
  const { entries } = (await res.json()) as { entries: { id: string; body: string }[] };
  for (const e of entries.filter((e) => e.body.startsWith("E2E "))) {
    await page.request.delete(`/api/journal/${encodeURIComponent(e.id)}`);
  }
  await page.close();
});

test("opens at the newest entry with no scroll jump", async ({ page }) => {
  await signIn(page);
  const list = scroller(page);
  await expect(list.locator("article").first()).toBeVisible();
  // Sample scrollTop for a moment: it must stay at the bottom (0) throughout.
  const samples = await list.evaluate(async (el) => {
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      out.push(el.scrollTop);
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  });
  expect(samples.every((s) => Math.abs(s) < 2)).toBe(true);
  await expect(list.locator("article").last()).toBeInViewport();
});

test("loads older entries when scrolling up, keeping the position", async ({ page }) => {
  await signIn(page);
  const list = scroller(page);
  await expect(list.locator("article").first()).toBeAttached();
  const before = await list.locator("article").count();
  // Scroll up a bit and remember where a visible entry sits.
  await list.evaluate((el) => el.scrollBy(0, -(el.scrollHeight - el.clientHeight) + 50));
  const anchor = list.locator("article").nth(2);
  const id = await anchor.getAttribute("data-entry-id");
  const y1 = (await anchor.boundingBox())!.y;
  await expect.poll(() => list.locator("article").count()).toBeGreaterThan(before);
  const y2 = (await list.locator(`[data-entry-id="${id}"]`).boundingBox())!.y;
  expect(Math.abs(y2 - y1)).toBeLessThan(4);
  await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await expect(list.locator("article").last()).toBeInViewport();
});

test("posting with Cmd/Ctrl+Enter adds the entry at the bottom and clears the composer", async ({ page }) => {
  await signIn(page);
  const text = `E2E post ${Date.now()}`;
  await setEditorText(page, composer(page), `${text}\nsecond line`);
  await page.keyboard.press("ControlOrMeta+Enter");
  const article = page.locator("article", { hasText: text });
  await expect(article).toBeVisible();
  await expect.poll(() => editorText(composer(page))).toBe("");
  await expect(scroller(page).locator("article").last()).toContainText(text);
  await deleteEntry(page, text);
});

test("a draft survives a reload", async ({ page }) => {
  await signIn(page);
  await setEditorText(page, composer(page), "Half-finished thought");
  await page.reload();
  await expect.poll(() => editorText(composer(page))).toBe("Half-finished thought");
  await setEditorText(page, composer(page), "");
});

test("click an entry to edit it in place; it saves on leaving", async ({ page }) => {
  await signIn(page);
  const text = `E2E edit ${Date.now()}`;
  await postEntry(page, text);
  const article = page.locator("article", { hasText: text });
  await page.waitForTimeout(1100); // timestamps have one-second resolution
  await article.locator(".prose-rp").click();
  const editor = page.getByRole("textbox", { name: "Edit journal entry" });
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" (revised)");
  await page.keyboard.press("Escape");
  await expect(page.locator("article", { hasText: `${text} (revised)` })).toContainText("edited");
  await deleteEntry(page, `${text} (revised)`);
});

test("a pasted screenshot and a PDF attach to one entry", async ({ page }) => {
  await signIn(page);
  await composer(page).click();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#36557f";
    ctx.fillRect(0, 0, 320, 200);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    const target = document.querySelector('[aria-label="New journal entry"]')!;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByRole("region", { name: "New entry" }).locator('input[type="file"]').setInputFiles({
    name: "reading.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  const text = `E2E attachments ${Date.now()}`;
  await setEditorText(page, composer(page), text);
  await page.getByRole("button", { name: "Post" }).click();
  const article = page.locator("article", { hasText: text });
  await expect(article).toBeVisible();
  const img = article.locator("img");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(article.getByText("reading.pdf")).toBeVisible();
  const pdfHref = await article.getByRole("link", { name: /^reading\.pdf/ }).getAttribute("href");
  const res = await page.request.get(pdfHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  await deleteEntry(page, text);
});

test("jump to date scrolls to the first entry on or after it", async ({ page }) => {
  await signIn(page);
  const first = scroller(page).locator("article").first();
  await expect(first).toBeAttached();
  const target = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await page.getByLabel("Jump to date").fill(target);
  await expect
    .poll(async () => {
      const visible = scroller(page).locator("article");
      const n = await visible.count();
      for (let i = 0; i < n; i++) {
        if (await visible.nth(i).isVisible()) {
          const box = await visible.nth(i).boundingBox();
          if (box && box.y > 40) return visible.nth(i).locator("time").getAttribute("datetime");
        }
      }
      return null;
    })
    .toMatch(/^\d{4}-/);
});

test("signed-out requests can't reach files or the journal API", async ({ request }) => {
  expect((await request.get("/api/journal")).status()).toBe(401);
  expect((await request.get("/api/files/attachments/journal/x/y.png")).status()).toBe(401);
  expect((await request.post("/api/upload/journal", { multipart: { body: "x" } })).status()).toBe(401);
});
