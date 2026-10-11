import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "./fixtures";
import { waitForHydration } from "./helpers";

// Read aloud in the reading panel, on a PDF. The device voice is replaced by
// a stand-in that records what it was asked to say; the natural voice runs
// against the AI_FAKE stand-in (silent audio), so no API is called.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `listener-${stamp}@example.com`;
// One line in a large font, so it must fit across the page.
const TEXT = "Making is thinking. It is not illustration.";
let sourceId = "";

async function asListener(page: Page, next: string) {
  // A silent speech engine that records each sentence.
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const synth = {
      speaking: false,
      getVoices: () => [],
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 60);
      },
      cancel() {},
      pause() {},
      resume() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  });
  await page.goto(`/api/auth/dev?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL(`**${next}`);
  await waitForHydration(page);
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

async function openReader(page: Page) {
  await asListener(page, `/library/${sourceId}?read=pdf`);
  const panel = page.getByRole("complementary", { name: /^Reading:/ });
  await expect(panel.getByText("Page 1 of 1")).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(".textLayer")).toContainText("Making is thinking", { timeout: 30_000 });
  return panel;
}

test("set up a source with a PDF", async ({ page }) => {
  await asListener(page, "/library");
  const res = await page.request.post("/api/upload/sources", {
    multipart: { title: `Listening test ${stamp}`, pdf: { name: "t.pdf", mimeType: "application/pdf", buffer: makePdf(2000, TEXT) } },
  });
  expect(res.ok()).toBe(true);
  sourceId = (await res.json()).id;
});

test("read all: shows the listening time, reads every sentence, counts down", async ({ page }) => {
  const panel = await openReader(page);
  await panel.getByRole("button", { name: "Listen" }).click();
  const bar = panel.getByRole("region", { name: "Read aloud" });
  await expect(bar.getByRole("button", { name: /Read all · About 5 sec/ })).toBeVisible();
  await bar.getByRole("button", { name: /Read all/ }).click();
  await expect(bar.getByTestId("read-remaining")).toHaveText(/\d+:\d\d left/);
  await expect.poll(() => spoken(page)).toEqual(["Making is thinking.", "It is not illustration."]);
  // Finished: back to the start buttons.
  await expect(bar.getByRole("button", { name: /Read all/ })).toBeVisible();
});

test("select some text and read just that", async ({ page }) => {
  const panel = await openReader(page);
  // Select the first sentence in the PDF's text layer.
  await panel.locator(".textLayer").evaluate((layer) => {
    const text = [...layer.querySelectorAll("span")].map((s) => s.firstChild).find((n) => n?.textContent?.includes("Making"));
    const range = document.createRange();
    range.setStart(text!, text!.textContent!.indexOf("Making"));
    range.setEnd(text!, text!.textContent!.indexOf("thinking.") + "thinking.".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.getByRole("button", { name: "Read aloud" }).click();
  await expect.poll(() => spoken(page)).toEqual(["Making is thinking."]);
  await expect(panel.getByRole("region", { name: "Read aloud" })).toBeVisible();
});

test("the natural voice uses the OpenAI key and fetches audio", async ({ page }) => {
  test.setTimeout(90_000); // opens the reader twice and saves a key
  // Without a key the option says what's needed.
  let panel = await openReader(page);
  await panel.getByRole("button", { name: "Listen" }).click();
  await expect(panel.getByRole("option", { name: /add an OpenAI key in Settings/ })).toBeAttached();

  // Save a key (AI_FAKE=1 skips checking it), then choose the natural voice.
  // (On phones the panel covers the page, so close it first.)
  await panel.getByRole("button", { name: "Close reading panel" }).click();
  await page.getByRole("button", { name: "Settings" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "AI summaries" }).click();
  await dialog.getByRole("radio", { name: "OpenAI" }).click();
  await dialog.getByLabel("OpenAI API key").fill("sk-test-voice-1234");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByTestId("key-hint")).toBeVisible();
  await page.keyboard.press("Escape");

  panel = await openReader(page);
  await panel.getByRole("button", { name: "Listen" }).click();
  const bar = panel.getByRole("region", { name: "Read aloud" });
  await bar.getByLabel("Voice").selectOption("natural");
  await expect(bar.getByText(/billed to your OpenAI key/)).toBeVisible();
  const audio = page.waitForResponse((r) => r.url().endsWith("/api/tts") && r.request().method() === "POST");
  await bar.getByRole("button", { name: /Read all/ }).click();
  const res = await audio;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("audio/wav");
  expect(await spoken(page)).toEqual([]); // the device voice wasn't used
});
