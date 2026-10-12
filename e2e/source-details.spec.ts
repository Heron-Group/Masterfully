import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { makePdf, ownerId, REPO_DIR } from "./fixtures";
import { waitForHydration } from "./helpers";

// The source page's details: a labelled list, and details read from a PDF
// when it's added (offered, never applied without asking). As a fresh user.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `details-${stamp}@example.com`;
let id = "";

async function as(page: Page, next: string) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}
const file = () => readFileSync(path.join(REPO_DIR, "users", ownerId(email), "sources", `${id}.md`), "utf8");

test("details are a labelled list; a new PDF's details are offered and only the ticked ones are used", async ({ page }) => {
  test.setTimeout(90_000);
  await as(page, "/library");
  const res = await page.request.post("/api/upload/sources", { multipart: { title: `Placeholder ${stamp}`, authors: "Mine, Kept" } });
  expect(res.ok()).toBe(true);
  id = ((await res.json()) as { id: string }).id;
  await as(page, `/library/${id}`);

  const details = page.getByRole("group", { name: "Details" });
  for (const label of ["Authors", "Year", "Type", "Groups", "Added"]) await expect(details.getByText(label, { exact: true })).toBeVisible();
  await expect(details.getByLabel("Authors")).toHaveValue("Mine, Kept");

  // Add a PDF whose properties carry a title and authors.
  await page
    .getByRole("region", { name: "PDFs and links" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "PDFs and links" }) }))
    .first()
    .locator('input[type="file"]')
    .setInputFiles({ name: "thinking.pdf", mimeType: "application/pdf", buffer: makePdf(3000, "Body", { Title: `Material Thinking ${stamp}`, Author: "Ann Tester and Bo Writer" }) });

  const offer = page.getByRole("region", { name: "Suggested details" });
  await expect(offer.getByText("Details found in thinking.pdf")).toBeVisible({ timeout: 20_000 });
  const title = offer.getByRole("checkbox", { name: /Title/ });
  const authors = offer.getByRole("checkbox", { name: /Authors/ });
  await expect(title).toBeChecked();
  await expect(offer).toContainText(`Material Thinking ${stamp}`);
  await expect(offer).toContainText(`Now: Placeholder ${stamp}`);
  await expect(offer).toContainText("Tester, Ann; Writer, Bo");
  await expect(file()).toContain(`title: Placeholder ${stamp}`); // nothing saved yet

  await authors.uncheck();
  await offer.getByRole("button", { name: "Use selected" }).click();
  await expect(offer).toHaveCount(0);
  await expect.poll(file).toContain(`title: Material Thinking ${stamp}`);
  expect(file()).toContain("Mine, Kept");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(`Material Thinking ${stamp}`);

  // Asked again later, only what still differs is offered; Dismiss leaves it.
  await page.getByRole("button", { name: "Fill in details from the PDF or link" }).click();
  await expect(offer.getByRole("checkbox", { name: /Authors/ })).toBeVisible({ timeout: 20_000 });
  await expect(offer.getByRole("checkbox", { name: /Title/ })).toHaveCount(0);
  await offer.getByRole("button", { name: "Dismiss" }).click();
  await expect(offer).toHaveCount(0);
  expect(file()).toContain("Mine, Kept");
});
