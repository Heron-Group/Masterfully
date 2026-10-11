import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { makePdf, ownerId, REPO_DIR } from "./fixtures";
import { waitForHydration } from "./helpers";

// A source with several PDFs and links, as a fresh user.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `materials-${stamp}@example.com`;
let id = "";

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}
const file = () => readFileSync(path.join(REPO_DIR, "users", ownerId(email), "sources", `${id}.md`), "utf8");

test("add several PDFs and links, read each, remove one", async ({ page }) => {
  test.setTimeout(90_000);
  await as(page, "/library");
  const res = await page.request.post("/api/upload/sources", {
    multipart: {
      title: `Many materials ${stamp}`,
      url: "https://example.org/first",
      pdf: { name: "first.pdf", mimeType: "application/pdf", buffer: makePdf(2000, "First PDF") },
    },
  });
  id = (await res.json()).id;

  await as(page, `/library/${id}`);
  const material = page.locator("section").filter({ has: page.getByRole("heading", { name: "PDFs and links" }) });

  // Two more PDFs at once, and a second link.
  await material.locator('input[type="file"]').setInputFiles([
    { name: "Chapter two.pdf", mimeType: "application/pdf", buffer: makePdf(2000, "Second PDF") },
    { name: "appendix.pdf", mimeType: "application/pdf", buffer: makePdf(2000, "Third PDF") },
  ]);
  await expect(material.getByRole("button", { name: "Read PDF" })).toHaveCount(3, { timeout: 30_000 });
  await material.getByRole("button", { name: "Add a link" }).click();
  await material.getByLabel("Link", { exact: true }).fill("https://example.org/second");
  await material.getByLabel("Link", { exact: true }).press("Enter");
  await expect(material.getByRole("button", { name: "Read web page" })).toHaveCount(2);

  await expect.poll(file).toMatch(/links:\n  - https:\/\/example\.org\/first\n  - https:\/\/example\.org\/second/);
  expect(file()).toContain(`pdfs:\n  - attachments/sources/${id}/first.pdf\n  - attachments/sources/${id}/chapter-two.pdf\n  - attachments/sources/${id}/appendix.pdf`);

  // Each PDF opens in the reading panel, with a tab per PDF and link.
  await material.getByRole("button", { name: "Read PDF" }).nth(1).click();
  const panel = page.getByRole("complementary", { name: /^Reading:/ });
  await expect(panel.getByRole("tab")).toHaveCount(5);
  await expect(panel.locator(".textLayer")).toContainText("Second PDF", { timeout: 30_000 });
  expect(page.url()).toContain("read=pdf-2");
  await panel.getByRole("tab", { name: "appendix.pdf" }).click();
  await expect(panel.locator(".textLayer")).toContainText("Third PDF", { timeout: 30_000 });
  await panel.getByRole("button", { name: "Close reading panel" }).click();

  // Remove the first PDF: the next becomes the main one.
  await material.getByRole("button", { name: "Remove first.pdf" }).click();
  await page.getByRole("alertdialog", { name: "Remove PDF" }).getByRole("button", { name: "Remove" }).click();
  await expect(material.getByRole("button", { name: "Read PDF" })).toHaveCount(2);
  await expect.poll(file).toContain(`pdfs:\n  - attachments/sources/${id}/chapter-two.pdf\n  - attachments/sources/${id}/appendix.pdf`);
});
