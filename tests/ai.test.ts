import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchReadable, isPrivateAddress } from "@/lib/ai/fetch-url";
import { groupPrompt, sourcePrompt } from "@/lib/ai/prompts";
import { summariseGroup, summariseSource } from "@/lib/ai/summarise";
import { ContentStore } from "@/lib/content/store";
import type { AiEvent } from "@/lib/dto";

const meta = { title: "Graphic Language", authors: ["Brody, Ann"], year: 2025, type: "article" };

describe("prompts", () => {
  it("include the details, notes and research context", () => {
    const p = sourcePrompt({ meta, notes: "My own note", researchContext: "How does co-design…?", material: { kind: "pdf" } });
    expect(p).toContain("Title: Graphic Language");
    expect(p).toContain("Authors: Brody, Ann");
    expect(p).toContain("<my_notes>\nMy own note\n</my_notes>");
    expect(p).toContain("How does co-design…?");
    expect(p).toContain("### Notable claims worth citing");
  });

  it("say when there is no research context or notes", () => {
    const p = sourcePrompt({ meta, notes: "", researchContext: "", material: { kind: "metadata-only" } });
    expect(p).toContain("(No notes yet.)");
    expect(p).toContain("hasn't written a research context");
    expect(p).toContain("based on metadata and notes");
  });

  it("group prompts carry each source's group note and earlier summary", () => {
    const p = groupPrompt({
      title: 'Co-design "foundations"',
      overview: "",
      researchContext: "RQ",
      sources: [{ meta, groupNote: "Key vocabulary", notes: "n", aiSummary: "Earlier summary" }],
    });
    expect(p).toContain('<group title="Co-design \'foundations\'">');
    expect(p).toContain("Why it is in this group: Key vocabulary");
    expect(p).toContain("<earlier_ai_summary>\nEarlier summary\n</earlier_ai_summary>");
  });
});

describe("URL fetching", () => {
  it("recognises private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "2606:4700::6810:84e5", "172.32.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses links to the local machine", async () => {
    const result = await fetchReadable("http://localhost:3000/");
    expect(result).toEqual({ ok: false, reason: "the address points to a private network" });
    expect(await fetchReadable("file:///etc/passwd")).toMatchObject({ ok: false });
  });
});

describe("summaries (simulated API)", () => {
  let root: string;
  let store: ContentStore;

  beforeEach(async () => {
    process.env.AI_FAKE = "1";
    root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-ai-"));
    store = new ContentStore({
      dir: path.join(root, "content"),
      branch: "main",
      pushDelayMs: 60_000,
      authorName: "Test",
      authorEmail: "t@example.com",
      refreshIntervalMs: 0,
    });
    await store.init();
  });

  afterEach(async () => {
    delete process.env.AI_FAKE;
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function collect(gen: AsyncGenerator<AiEvent>): Promise<AiEvent[]> {
    const out: AiEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }

  const fake = { backend: { provider: "fake" as const } };

  it("asks for an API key when none is set up", async () => {
    const s = await store.createSource({ title: "No key" });
    const events = await collect(summariseSource(store, s.id, { backend: null }));
    expect(events).toEqual([{ type: "error", code: "not_configured", message: expect.stringContaining("Settings") }]);
  });

  it("streams a summary and rewrites only the AI summary section", async () => {
    const s = await store.createSource({ title: "Only metadata", notes: "My notes\n\n## Sub-heading\n\nKept" });
    const file = path.join(store.dir, s.path);
    const before = await fs.readFile(file, "utf8");
    const events = await collect(summariseSource(store, s.id, fake));
    expect(events[0]).toMatchObject({ type: "notice" });
    expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(5);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", summary: { model: "fake-model" } });
    const after = await fs.readFile(file, "utf8");
    const bodyBefore = before.slice(before.indexOf("## Notes"));
    expect(after).toContain(bodyBefore.trimEnd());
    expect(after).toMatch(/## AI summary\n\n<!-- generated: .*; model: fake-model -->/);
  });

  it("leaves the file untouched when the call fails", async () => {
    const s = await store.createSource({ title: "Broken [fail]" });
    await store.setSourceAiSummary(s.id, { text: "Earlier summary", model: "m" });
    const before = await fs.readFile(path.join(store.dir, s.path), "utf8");
    const events = await collect(summariseSource(store, s.id, { ...fake, mode: "metadata" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "api" });
    expect(await fs.readFile(path.join(store.dir, s.path), "utf8")).toBe(before);
  });

  it("reports refusals clearly", async () => {
    const s = await store.createSource({ title: "Declined [refuse]" });
    const events = await collect(summariseSource(store, s.id, { ...fake, mode: "metadata" }));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refusal" });
  });

  it("summarises a group and clears its stale flag", async () => {
    await store.createGroup({ title: "G", overview: "Mine" });
    const a = await store.createSource({ title: "A" }, { groups: ["g"] });
    const events = await collect(summariseGroup(store, "g", fake));
    expect(events.find((e) => e.type === "notice")).toMatchObject({ message: expect.stringContaining("1 of 1 sources have no AI summary") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const group = (await store.getGroup("g"))!;
    expect(group.overview).toBe("Mine");
    expect(store.isGroupSummaryStale(group)).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    await collect(summariseSource(store, a.id, fake));
    expect(store.isGroupSummaryStale((await store.getGroup("g"))!)).toBe(true);
  });
});
