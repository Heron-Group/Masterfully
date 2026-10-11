import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUsage, recordUsage } from "@/lib/ai/usage";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "portal-usage-"));
  process.env.CONTENT_DIR = dir;
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.CONTENT_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("AI usage through Masterfully", () => {
  it("adds up requests, tokens and speech by month and model", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
    await recordUsage("u1", { provider: "anthropic", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 200 });
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    await Promise.all([
      recordUsage("u1", { provider: "anthropic", model: "claude-opus-5-5", inputTokens: 500, outputTokens: 100 }),
      recordUsage("u1", { provider: "anthropic", model: "claude-opus-5-5", inputTokens: 300, outputTokens: 50 }),
      recordUsage("u1", { provider: "openai", model: "gpt-4o-mini-tts", speechChars: 1200 }),
    ]);
    const u = await getUsage("u1", new Date("2026-10-11T00:00:00Z"));
    expect(u.thisMonth).toEqual({ requests: 2, inputTokens: 800, outputTokens: 150, speechRequests: 1, speechChars: 1200 });
    expect(u.lastMonth.requests).toBe(1);
    expect(u.allTime).toMatchObject({ requests: 3, inputTokens: 1800, outputTokens: 350 });
    expect(u.byModel.map((m) => m.model)).toEqual(["claude-opus-5-5", "gpt-4o-mini-tts"]);
    // Kept in the user's own folder.
    expect(JSON.parse(await fs.readFile(path.join(dir, "users", "u1", "ai-usage.json"), "utf8")).months["2026-10"]).toBeTruthy();
  });

  it("is empty for someone who hasn't used anything", async () => {
    const u = await getUsage("nobody");
    expect(u.allTime.requests).toBe(0);
    expect(u.byModel).toEqual([]);
  });
});
