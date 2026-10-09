import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page, request }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary$/);
  expect((await request.get("/api/sync")).status()).toBe(401);
});

test("a wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toHaveText("That password isn't right.");
});

test("signing in returns to the requested page, signing out ends the session", async ({ page }) => {
  await signIn(page, "/library");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Journal entries")).toBeVisible();
  expect((await page.request.get("/api/sync")).status()).toBe(200);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/login/);
});

test("theme toggle switches and persists", async ({ page }) => {
  await signIn(page);
  const html = page.locator("html");
  await page.getByRole("button", { name: /Theme:/ }).click(); // system → light
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Theme:/ }).click(); // light → dark
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});
