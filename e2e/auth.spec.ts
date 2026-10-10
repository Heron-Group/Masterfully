import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page, request }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary$/);
  expect((await request.get("/api/sync")).status()).toBe(401);
});

test("the login page offers only Google and Microsoft", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Microsoft" })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
});

test("signing in returns to the requested page, signing out ends the session", async ({ page }) => {
  await signIn(page, "/library");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add source" })).toBeVisible();
  expect((await page.request.get("/api/sync")).status()).toBe(200);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/login/);
});

test("colour mode is set in Settings and persists", async ({ page }) => {
  await signIn(page, "/settings");
  const html = page.locator("html");
  // No status or theme controls in the app shell any more.
  await expect(page.getByText("Local only")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Theme/ })).toHaveCount(0);
  const mode = page.getByRole("radiogroup", { name: "Colour mode" });
  await expect(mode.getByRole("radio", { name: "Match system" })).toHaveAttribute("aria-checked", "true");
  await mode.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.goto("/journal");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.goto("/settings");
  await expect(mode.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await mode.getByRole("radio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await mode.getByRole("radio", { name: "Match system" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});
