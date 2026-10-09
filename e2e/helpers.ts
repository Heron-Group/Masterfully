import type { Page } from "@playwright/test";

export const DEV_PASSWORD = process.env.E2E_PASSWORD ?? "devpassword-123";

export async function signIn(page: Page, next = "/journal") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByPlaceholder("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
}
