import type { Locator, Page } from "@playwright/test";

export const DEV_PASSWORD = process.env.E2E_PASSWORD ?? "devpassword-123";

export async function signIn(page: Page, next = "/journal") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByPlaceholder("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
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
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.insertText(text);
}
