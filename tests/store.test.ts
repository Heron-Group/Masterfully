import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStore, type StoreOptions } from "@/lib/content/store";
import { setByHand } from "@/lib/content/schemas";

let root: string;
let dir: string;
let clock: Date;

/** Every file in the folder (relative paths), leaving out the app's own .tmp and .lock. */
async function files(): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string) {
    for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (!rel && e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(child);
      else out.push(child);
    }
  }
  await walk("");
  return out.sort();
}

/** Leftover temporary files or undo copies (there should be none after a change). */
async function scratch(): Promise<string[]> {
  return fs.readdir(path.join(dir, ".tmp")).catch(() => []);
}

async function makeStore(overrides: Partial<StoreOptions> = {}): Promise<ContentStore> {
  const store = new ContentStore({
    dir,
    refreshIntervalMs: 0,
    now: () => clock,
    ...overrides,
  });
  await store.init();
  return store;
}

function tick(seconds = 1) {
  clock = new Date(clock.getTime() + seconds * 1000);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-test-"));
  dir = path.join(root, "content");
  clock = new Date("2026-10-09T14:32:05Z");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("initialisation", () => {
  it("creates settings.md in an empty folder", async () => {
    await makeStore();
    expect(await fs.readFile(path.join(dir, "settings.md"), "utf8")).toContain("updated:");
    expect(await files()).toEqual(["settings.md"]);
  });

  it("uses files that were already in the folder", async () => {
    await fs.mkdir(path.join(dir, "groups"), { recursive: true });
    await fs.writeFile(path.join(dir, "groups", "g.md"), "---\ntitle: G\n---\n");
    const store = await makeStore();
    expect((await store.getGroup("g"))?.title).toBe("G");
  });
});

describe("journal", () => {
  it("posting creates exactly one .md file", async () => {
    const store = await makeStore();
    const entry = await store.createJournalEntry({ body: "First thought" });

    expect(entry.id).toBe("2026-10-09T14-32-05Z");
    expect(entry.path).toBe("journal/2026/10/2026-10-09T14-32-05Z.md");
    expect(await files()).toEqual(["journal/2026/10/2026-10-09T14-32-05Z.md", "settings.md"]);
    expect(await scratch()).toEqual([]);
  });

  it("gives entries in the same second distinct ids", async () => {
    const store = await makeStore();
    const a = await store.createJournalEntry({ body: "a" });
    const b = await store.createJournalEntry({ body: "b" });
    expect(b.id).toBe(`${a.id}-2`);
  });

  it("rejects an empty entry", async () => {
    const store = await makeStore();
    await expect(store.createJournalEntry({ body: "  " })).rejects.toThrow(/text or an attachment/);
  });

  it("pages backwards from the newest entry", async () => {
    const store = await makeStore();
    for (let i = 0; i < 5; i++) {
      await store.createJournalEntry({ body: `n${i}` });
      tick(60);
    }
    const last = await store.listJournal({ limit: 2 });
    expect(last.entries.map((e) => e.body)).toEqual(["n3", "n4"]);
    expect(last.hasMore).toBe(true);
    const older = await store.listJournal({ before: last.entries[0].id, limit: 2 });
    expect(older.entries.map((e) => e.body)).toEqual(["n1", "n2"]);
    const oldest = await store.listJournal({ before: older.entries[0].id, limit: 2 });
    expect(oldest.entries.map((e) => e.body)).toEqual(["n0"]);
    expect(oldest.hasMore).toBe(false);
  });

  it("edits update the updated timestamp only", async () => {
    const store = await makeStore();
    const entry = await store.createJournalEntry({ body: "draft" });
    tick(120);
    const edited = await store.updateJournalEntry(entry.id, { body: "final" });
    expect(edited.created).toBe("2026-10-09T14:32:05Z");
    expect(edited.updated).toBe("2026-10-09T14:34:05Z");
    expect(await fs.readFile(path.join(dir, entry.path), "utf8")).toContain("final");
  });

  it("stores attachments and deletes them with the entry", async () => {
    const store = await makeStore();
    const staged = await store.stageUpload(Buffer.from("fake image"));
    const entry = await store.createJournalEntry({
      body: "",
      attachments: [{ ...staged, name: "Screen Shot.PNG", type: "image/png" }],
    });
    expect(entry.attachments).toEqual([
      {
        file: `attachments/journal/${entry.id}/screen-shot.png`,
        name: "Screen Shot.PNG",
        type: "image/png",
        size: 10,
      },
    ]);
    expect(await files()).toEqual([`attachments/journal/${entry.id}/screen-shot.png`, entry.path, "settings.md"].sort());

    await store.deleteJournalEntry(entry.id);
    await expect(fs.stat(path.join(dir, "attachments"))).rejects.toThrow();
    expect(await store.getJournalEntry(entry.id)).toBeNull();
    expect(await files()).toEqual(["settings.md"]);
    expect(await scratch()).toEqual([]);
  });

  it("adds and removes attachments when editing", async () => {
    const store = await makeStore();
    const a = await store.stageUpload(Buffer.from("a"));
    const entry = await store.createJournalEntry({
      body: "x",
      attachments: [{ ...a, name: "a.pdf", type: "application/pdf" }],
    });
    const b = await store.stageUpload(Buffer.from("b"));
    const edited = await store.updateJournalEntry(entry.id, {
      removeAttachments: [entry.attachments[0].file],
      addAttachments: [{ ...b, name: "a.pdf", type: "application/pdf" }],
    });
    expect(edited.attachments.map((x) => x.file)).toEqual([`attachments/journal/${entry.id}/a.pdf`]);
    expect(await fs.readFile(path.join(dir, edited.attachments[0].file), "utf8")).toBe("b");
  });

  it("never deletes files outside attachments/ named in hand-edited frontmatter", async () => {
    const store = await makeStore();
    const entry = await store.createJournalEntry({ body: "x" });
    const raw = await fs.readFile(path.join(dir, entry.path), "utf8");
    await fs.writeFile(
      path.join(dir, entry.path),
      raw.replace("---\nx", "attachments:\n  - file: settings.md\n---\nx"),
    );
    await store.deleteJournalEntry(entry.id);
    expect(await fs.readFile(path.join(dir, "settings.md"), "utf8")).toContain("---");
  });

  it("refuses to overwrite an entry whose frontmatter is broken", async () => {
    const store = await makeStore();
    const entry = await store.createJournalEntry({ body: "x" });
    await fs.writeFile(path.join(dir, entry.path), "---\ncreated: [broken\n---\nx\n");
    await expect(store.updateJournalEntry(entry.id, { body: "y" })).rejects.toThrow(/can't be read/);
    expect(await fs.readFile(path.join(dir, entry.path), "utf8")).toContain("[broken");
  });
});

describe("index", () => {
  it("rebuilds everything from the files", async () => {
    const store = await makeStore();
    await store.createJournalEntry({ body: "j" });
    const source = await store.createSource({ title: "A book", authors: ["Doe, Jane"], year: 2020 });
    await store.createGroup({ title: "G" });
    await store.addSourceToGroup("g", source.id, "why");

    const fresh = await makeStore();
    expect((await fresh.listJournal()).entries).toHaveLength(1);
    expect((await fresh.getSource(source.id))?.title).toBe("A book");
    expect((await fresh.getGroup("g"))?.sources).toEqual([{ id: source.id, note: "why" }]);

    await store.rebuildIndex();
    expect((await store.listSources()).map((s) => s.id)).toEqual([source.id]);
  });

  it("picks up files edited, added and deleted by hand", async () => {
    const store = await makeStore();
    const s = await store.createSource({ title: "Original" });
    const file = path.join(dir, s.path);
    const raw = await fs.readFile(file, "utf8");
    await fs.writeFile(file, raw.replace("title: Original", "title: Edited in Obsidian"));
    expect((await store.getSource(s.id))?.title).toBe("Edited in Obsidian");

    await fs.writeFile(path.join(dir, "sources", "manual.md"), "No frontmatter at all");
    expect((await store.getSource("manual"))?.notes).toBe("No frontmatter at all");

    await fs.rm(file);
    expect(await store.getSource(s.id)).toBeNull();
  });
});

describe("details set by hand", () => {
  it("records what the user typed; filling in from a PDF or link doesn't count", async () => {
    const store = await makeStore();
    const s = await store.createSource({ title: "Typed", authors: ["Doe, Jane"], setByHand: ["title", "authors"] });
    expect(s.setByHand).toEqual(["title", "authors"]);
    const filled = await store.updateSource(s.id, { year: 2020, type: "book", byHand: false });
    expect(filled.setByHand).toEqual(["title", "authors"]);
    const typed = await store.updateSource(s.id, { year: 2021 });
    expect(typed.setByHand).toEqual(["title", "authors", "year"]);
    expect(await fs.readFile(path.join(dir, s.path), "utf8")).toContain("set_by_hand: [ title, authors, year ]");
    expect((await (await makeStore()).getSource(s.id))?.setByHand).toEqual(["title", "authors", "year"]);
    // A placeholder title (from a PDF's name) can be replaced.
    expect((await store.createSource({ title: "scan 3", setByHand: [] })).setByHand).toEqual([]);
    expect((await store.createSource({ title: "Typed" })).setByHand).toEqual(["title"]);
  });

  it("counts everything already filled in as the user's for older sources", async () => {
    const store = await makeStore();
    await fs.mkdir(path.join(dir, "sources"), { recursive: true });
    await fs.writeFile(path.join(dir, "sources", "old.md"), "---\nid: old\ntitle: Old\nauthors: [ \"Doe, Jane\" ]\ntype: article\n---\n## Notes\n");
    const old = (await store.getSource("old"))!;
    expect(old.setByHand).toBeUndefined();
    expect(setByHand(old)).toEqual(["title", "authors", "type"]); // no year yet, so that can be filled in
    // Filling in keeps that record, so the filled year isn't later mistaken for the user's.
    expect((await store.updateSource("old", { year: 1999, byHand: false })).setByHand).toEqual(["title", "authors", "type"]);
  });
});

describe("archiving", () => {
  it("archives a group with its sources; unarchiving brings back only those", async () => {
    const store = await makeStore();
    const a = await store.createSource({ title: "A" });
    const b = await store.createSource({ title: "B" });
    const c = await store.createSource({ title: "C" });
    await store.createGroup({ title: "G" });
    for (const s of [a, b, c]) await store.addSourceToGroup("g", s.id);
    await store.setSourceArchived(c.id, true); // archived on its own first

    await store.setGroupArchived("g", true);
    expect((await store.getGroup("g"))?.archived).toBeTruthy();
    expect((await store.getSource(a.id))).toMatchObject({ archivedWith: "g" });
    expect((await store.getSource(c.id))?.archivedWith).toBeUndefined();
    const file = await fs.readFile(path.join(dir, a.path), "utf8");
    expect(file).toMatch(/archived: \S+/);
    expect(file).toContain("archived_with: g");

    await store.setGroupArchived("g", false);
    expect((await store.getGroup("g"))?.archived).toBeUndefined();
    expect((await store.getSource(a.id))?.archived).toBeUndefined();
    expect((await store.getSource(b.id))?.archived).toBeUndefined();
    expect((await store.getSource(c.id))?.archived).toBeTruthy(); // still archived

    await store.setSourceArchived(c.id, false);
    expect(await fs.readFile(path.join(dir, c.path), "utf8")).not.toContain("archived");
  });
});

describe("sources and groups", () => {
  it("creates readable ids", async () => {
    const store = await makeStore();
    const s = await store.createSource({
      title: "The Graphic Language of Co-design",
      authors: ["Brody, Ann"],
      year: 2025,
    });
    expect(s.id).toBe("brody-2025-graphic-language-co");
    const again = await store.createSource({
      title: "The Graphic Language of Co-design",
      authors: ["Brody, Ann"],
      year: 2025,
    });
    expect(again.id).toBe("brody-2025-graphic-language-co-2");
  });

  it("never uses ids that clash with page addresses", async () => {
    const store = await makeStore();
    expect((await store.createGroup({ title: "New" })).id).toBe("new-2");
    expect((await store.createSource({ title: "New" })).id).toBe("new-2");
  });

  it("adds a new source to groups and stores its PDF", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "Methods" });
    const pdf = await store.stageUpload(Buffer.from("%PDF-1.7"));
    const s = await store.createSource(
      { title: "Paper", notes: "Notes here" },
      { pdf: { ...pdf, name: "p.pdf", type: "application/pdf" }, groups: ["methods"] },
    );
    expect(s.pdf).toBe(`attachments/sources/${s.id}/p.pdf`);
    expect((await store.getGroup("methods"))?.sources).toEqual([{ id: s.id, note: "" }]);
    expect((await store.getSource(s.id))?.notes).toBe("Notes here");
  });

  it("finds the sources and notes that link to a source", async () => {
    const store = await makeStore();
    const target = await store.createSource({ title: "Target" });
    const lookalike = await store.createSource({ title: "Target 2" }); // id starts the same
    const citing = await store.createSource({ title: "Citing", notes: `Builds on [the target](/library/${target.id}).` });
    await store.createSource({ title: "Other", notes: `See [it](/library/${lookalike.id})` });
    await store.setSourceNotes(target.id, `Self link [me](/library/${target.id})`);
    await store.createNote({ title: "Workshop", text: `As [argued](/library/${target.id}) here.` });

    expect(await store.referencesTo(target.id)).toEqual([
      { kind: "source", id: citing.id, title: "Citing" },
      { kind: "note", id: "workshop", title: "Workshop" },
    ]);
    expect((await store.referencesTo(lookalike.id)).map((r) => r.title)).toEqual(["Other"]);
  });

  it("holds several PDFs and links; the first of each is the main one", async () => {
    const store = await makeStore();
    const first = await store.stageUpload(Buffer.from("%PDF-1"));
    const s = await store.createSource({ title: "Many", url: "https://a.example/1" }, { pdf: { ...first, name: "a.pdf", type: "application/pdf" } });
    const second = await store.stageUpload(Buffer.from("%PDF-2"));
    let next = await store.addSourcePdf(s.id, { ...second, name: "Chapter 2.PDF", type: "application/pdf" });
    expect(next.pdfs).toEqual([`attachments/sources/${s.id}/a.pdf`, `attachments/sources/${s.id}/chapter-2.pdf`]);
    expect(next.pdf).toBe(`attachments/sources/${s.id}/a.pdf`);

    next = await store.setSourceLink(s.id, { to: "https://b.example/2" });
    next = await store.setSourceLink(s.id, { to: "https://b.example/2" }); // no duplicates
    expect(next.links).toEqual(["https://a.example/1", "https://b.example/2"]);
    next = await store.setSourceLink(s.id, { from: "https://b.example/2", to: "https://b.example/two" });
    next = await store.setSourceLink(s.id, { from: "https://a.example/1", to: "" });
    expect(next.links).toEqual(["https://b.example/two"]);
    expect(next.url).toBe("https://b.example/two");
    await expect(store.setSourceLink(s.id, { to: "ftp://nope" })).rejects.toThrow(/http/);

    next = await store.removeSourcePdf(s.id, `attachments/sources/${s.id}/a.pdf`);
    expect(next.pdf).toBe(`attachments/sources/${s.id}/chapter-2.pdf`);
    expect(await fs.stat(path.join(dir, `attachments/sources/${s.id}/a.pdf`)).catch(() => null)).toBeNull();

    // Saved and read back the same.
    await store.rebuildIndex();
    expect((await store.getSource(s.id))?.pdfs).toEqual([`attachments/sources/${s.id}/chapter-2.pdf`]);

    await store.deleteSource(s.id);
    expect(await fs.stat(path.join(dir, `attachments/sources/${s.id}`)).catch(() => null)).toBeNull();
    expect(await scratch()).toEqual([]);
  });

  it("deleting a source removes it from every group and deletes its PDF", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "One" });
    await store.createGroup({ title: "Two" });
    const pdf = await store.stageUpload(Buffer.from("%PDF"));
    const s = await store.createSource(
      { title: "Shared" },
      { pdf: { ...pdf, name: "x.pdf", type: "application/pdf" }, groups: ["one", "two"] },
    );
    await store.deleteSource(s.id);
    expect((await store.getGroup("one"))?.sources).toEqual([]);
    expect((await store.getGroup("two"))?.sources).toEqual([]);
    await expect(fs.stat(path.join(dir, s.pdf!))).rejects.toThrow();
    expect(await files()).toEqual(["groups/one.md", "groups/two.md", "settings.md"]);
  });

  it("deleting a group never deletes its sources", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G" });
    const s = await store.createSource({ title: "Keep me" }, { groups: ["g"] });
    await store.deleteGroup("g");
    expect(await store.getSource(s.id)).not.toBeNull();
    expect(await store.getGroup("g")).toBeNull();
  });

  it("regenerating an AI summary changes only that section", async () => {
    const store = await makeStore();
    const s = await store.createSource({ title: "T", notes: "My notes\n\n## My heading\n\nMore" });
    await store.setSourceAiSummary(s.id, { text: "First", model: "m1" });
    const file = path.join(dir, s.path);
    const before = await fs.readFile(file, "utf8");
    tick(60);
    await store.setSourceAiSummary(s.id, { text: "Second", model: "m2" });
    const after = await fs.readFile(file, "utf8");

    const cut = (t: string) => t.slice(t.indexOf("---\n", 4), t.indexOf("## AI summary"));
    expect(cut(after)).toBe(cut(before));
    expect(after).toContain("Second");
    expect(after).not.toContain("First");
    const summary = (await store.getSource(s.id))?.aiSummary;
    expect(summary).toEqual({ text: "Second", model: "m2", generated: "2026-10-09T14:33:05Z" });
  });

  it("marks a group summary stale when sources change or are re-summarised", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G" });
    const a = await store.createSource({ title: "A" }, { groups: ["g"] });
    tick(60);
    await store.setGroupAiSummary("g", { text: "Themes", model: "m" });
    let group = (await store.getGroup("g"))!;
    expect(store.isGroupSummaryStale(group)).toBe(false);

    tick(60);
    await store.setSourceAiSummary(a.id, { text: "New", model: "m" });
    group = (await store.getGroup("g"))!;
    expect(store.isGroupSummaryStale(group)).toBe(true);

    tick(60);
    await store.setGroupAiSummary("g", { text: "Themes 2", model: "m" });
    expect(store.isGroupSummaryStale((await store.getGroup("g"))!)).toBe(false);

    tick(60);
    const b = await store.createSource({ title: "B" });
    await store.addSourceToGroup("g", b.id);
    expect(store.isGroupSummaryStale((await store.getGroup("g"))!)).toBe(true);
  });

  it("reorders sources and edits group notes", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G" });
    const a = await store.createSource({ title: "A" }, { groups: ["g"] });
    const b = await store.createSource({ title: "B" }, { groups: ["g"] });
    const g = await store.setGroupSources("g", [
      { id: b.id, note: "first now" },
      { id: a.id, note: "" },
    ]);
    expect(g.sources.map((s) => s.id)).toEqual([b.id, a.id]);
    const raw = await fs.readFile(path.join(dir, g.path), "utf8");
    expect(raw).toContain(`sources:\n  - id: ${b.id}\n    note: first now\n  - id: ${a.id}\n`);
    await expect(store.setGroupSources("g", [{ id: "nope", note: "" }])).rejects.toThrow(/Unknown source/);
  });

  it("edits one group note and keeps refs to sources deleted by hand", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G" });
    const a = await store.createSource({ title: "A" }, { groups: ["g"] });
    const b = await store.createSource({ title: "B" }, { groups: ["g"] });
    await store.setGroupSourceNote("g", a.id, "Why A");
    expect((await store.getGroup("g"))?.sources).toEqual([
      { id: a.id, note: "Why A" },
      { id: b.id, note: "" },
    ]);
    await fs.rm(path.join(dir, b.path));
    const g = await store.setGroupSources("g", [
      { id: b.id, note: "" },
      { id: a.id, note: "Why A" },
    ]);
    expect(g.sources.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("rewrites only the overview, keeping the AI summary", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G", overview: "Old" });
    await store.setGroupAiSummary("g", { text: "Gen", model: "m" });
    await store.setGroupOverview("g", "New overview");
    const g = (await store.getGroup("g"))!;
    expect(g.overview).toBe("New overview");
    expect(g.aiSummary?.text).toBe("Gen");
  });
});

describe("notes", () => {
  it("creates a note with attachments, edits it, and deletes it", async () => {
    const store = await makeStore();
    const img = await store.stageUpload(Buffer.from("fake image"));
    const note = await store.createNote({
      title: "Workshop reflections",
      text: "Seven people, two hours.",
      attachments: [{ ...img, name: "map.jpg", type: "image/jpeg" }],
    });
    expect(note.id).toBe("workshop-reflections");
    expect(note.attachments).toEqual([
      { file: "attachments/notes/workshop-reflections/map.jpg", name: "map.jpg", type: "image/jpeg", size: 10 },
    ]);
    expect((await store.createNote({ title: "New" })).id).toBe("new-2");

    await store.renameNote(note.id, "Workshop reflections, week 2");
    await store.setNoteText(note.id, "Updated text");
    const raw = await fs.readFile(path.join(dir, "notes", "workshop-reflections.md"), "utf8");
    expect(raw).toMatch(/title: Workshop reflections, week 2/);
    expect(raw).toContain("## Notes\n\nUpdated text");

    const pdf = await store.stageUpload(Buffer.from("%PDF-1.7"));
    const updated = await store.updateNoteAttachments(note.id, {
      add: [{ ...pdf, name: "paper.pdf", type: "application/pdf" }],
      remove: ["attachments/notes/workshop-reflections/map.jpg"],
    });
    expect(updated.attachments.map((a) => a.name)).toEqual(["paper.pdf"]);
    expect(await fs.stat(path.join(dir, "attachments/notes/workshop-reflections/map.jpg")).catch(() => null)).toBeNull();

    await store.deleteNote(note.id);
    expect(await store.getNote(note.id)).toBeNull();
    expect(await fs.stat(path.join(dir, "attachments/notes/workshop-reflections")).catch(() => null)).toBeNull();
    expect(await files()).toEqual(["notes/new-2.md", "settings.md"]);
    expect(await scratch()).toEqual([]);
  });

  it("reads a hand-written note without headings as its text", async () => {
    const store = await makeStore();
    await fs.mkdir(path.join(dir, "notes"), { recursive: true });
    await fs.writeFile(path.join(dir, "notes", "by-hand.md"), "---\ntitle: By hand\n---\nJust some text.\n");
    const note = (await store.getNote("by-hand"))!;
    expect(note).toMatchObject({ title: "By hand", text: "Just some text.", aiSummary: null });
    expect((await store.listNotes()).map((n) => n.id)).toEqual(["by-hand"]);
  });
});

describe("settings", () => {
  it("stores the research context in the body", async () => {
    const store = await makeStore();
    await store.setResearchContext("How can co-design...?");
    expect((await store.getSettings()).researchContext).toBe("How can co-design...?");
    expect(await fs.readFile(path.join(dir, "settings.md"), "utf8")).toMatch(
      /^---\nupdated: .*\n---\nHow can co-design\.\.\.\?\n$/,
    );
  });
});

describe("rollback", () => {
  it("restores files when a write fails part-way", async () => {
    const store = await makeStore();
    await store.createGroup({ title: "G" });
    const s = await store.createSource({ title: "A" }, { groups: ["g"] });
    const groupFile = await fs.readFile(path.join(dir, "groups/g.md"), "utf8");
    const before = await files();

    // deleteSource rewrites the group first, then fails removing the source.
    const realRm = fs.rm;
    const spy = vi.spyOn(fs, "rm").mockImplementation(async (p, opts) => {
      if (String(p).endsWith(`${s.id}.md`)) throw new Error("disk on fire");
      return realRm(p, opts);
    });
    try {
      await expect(store.deleteSource(s.id)).rejects.toThrow("disk on fire");
    } finally {
      spy.mockRestore();
    }
    expect(await fs.readFile(path.join(dir, "groups/g.md"), "utf8")).toBe(groupFile);
    expect(await files()).toEqual(before);
    expect((await store.getGroup("g"))?.sources).toHaveLength(1);
  });

  it("brings back a removed folder when a delete fails part-way", async () => {
    const store = await makeStore();
    const img = await store.stageUpload(Buffer.from("fake image"));
    const note = await store.createNote({ title: "Kept", attachments: [{ ...img, name: "a.jpg", type: "image/jpeg" }] });
    const before = await files();

    // deleteNote removes the note and its attachment, then fails on the folder.
    const realRm = fs.rm;
    const spy = vi.spyOn(fs, "rm").mockImplementation(async (p, opts) => {
      if (String(p).endsWith(`attachments/notes/${note.id}`)) throw new Error("disk on fire");
      return realRm(p, opts);
    });
    try {
      await expect(store.deleteNote(note.id)).rejects.toThrow("disk on fire");
    } finally {
      spy.mockRestore();
    }
    expect(await files()).toEqual(before);
    expect((await store.getNote(note.id))?.attachments).toHaveLength(1);
  });
});
