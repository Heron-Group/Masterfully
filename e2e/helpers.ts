import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

/** OWNER_EMAIL from the environment or .env.local: the account the specs use. */
export const OWNER_EMAIL =
  process.env.OWNER_EMAIL ??
  readFileSync(".env.local", "utf8").match(/^OWNER_EMAIL=(.+)$/m)?.[1]?.trim() ??
  "owner@example.com";

/**
 * Sign in as a user through the development sign-in (AUTH_DEV_LOGIN=1),
 * which stands in for Google/Microsoft. By default, as the owner.
 */
export async function signIn(page: Page, next = "/journal", email = OWNER_EMAIL) {
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  // This is a full page load (as after Google/Microsoft): wait until the
  // page is hydrated, or early clicks and scrolls are lost.
  await page.waitForLoadState("networkidle");
}

/** Text of a live (CodeMirror) editor, or "" when only the placeholder shows. */
export async function editorText(editor: Locator): Promise<string> {
  return editor.evaluate((el) =>
    el.querySelector(".cm-placeholder")
      ? ""
      : [...el.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n"),
  );
}

/** Replace a live editor's whole text (multi-line safe). */
export async function setEditorText(page: Page, editor: Locator, text: string) {
  await editor.click();
  // Select all with the platform's own shortcut: Cmd+A on Apple devices
  // (where Ctrl+A only moves to the line start), Ctrl+A elsewhere.
  // (CodeMirror decides by the real engine/platform, not the user agent, so
  // Chromium emulating an iPhone still uses Ctrl.)
  const apple = await page.evaluate(() => /Apple/.test(navigator.vendor) || /Mac/.test(navigator.platform));
  await page.keyboard.press(apple ? "Meta+a" : "Control+a");
  await page.keyboard.press("Backspace");
  // On iOS, CodeMirror applies Backspace about 50 ms later; typing sooner
  // (as only a script can) would have the late Backspace eat a character.
  await page.waitForTimeout(120);
  // Line by line with Enter, as a person types (Playwright's multi-line
  // insertText is dropped by WebKit in contenteditable editors).
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    if (line) await page.keyboard.insertText(line);
  }
}
