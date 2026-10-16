import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { toIso } from "./frontmatter";
import {
  assertSafeId,
  ContentError,
  journalIdFor,
  slugify,
  sourceSlug,
  uniqueId,
} from "./ids";
import {
  type Attachment,
  type Group,
  type GroupSourceRef,
  type JournalEntry,
  type Note,
  parseGroup,
  parseJournalEntry,
  parseNote,
  parseSettings,
  parseSource,
  serializeGroup,
  serializeJournalEntry,
  serializeNote,
  serializeSettings,
  serializeSource,
  setByHand,
  SOURCE_DETAIL_FIELDS,
  type Settings,
  type Source,
  withPrimary,
  type SourceDetailField,
  type SourceType,
} from "./schemas";
import {
  GROUP_SECTIONS,
  NOTE_SECTIONS,
  replaceSection,
  setAiSummary,
  SOURCE_SECTIONS,
} from "./sections";
import { ContentLock } from "./lock";

export type StoreOptions = {
  /** The folder this store owns, e.g. one user's folder (users/<id>). */
  dir: string;
  /** Shared lock for the folder; one is created if not given. */
  lock?: ContentLock;
  /** Minimum gap between filesystem rescans triggered by reads. */
  refreshIntervalMs?: number;
  /** Override the clock (tests). */
  now?: () => Date;
};

export const DIRS = {
  journal: "journal",
  sources: "sources",
  groups: "groups",
  notes: "notes",
  attachments: "attachments",
} as const;
export const SETTINGS_FILE = "settings.md";

/** Ids that would clash with page addresses (/library/new, /groups/new, /notes/new). */
const RESERVED_IDS = new Set(["new"]);

export type NewSource = {
  title: string;
  authors?: string[];
  year?: number;
  type?: SourceType;
  url?: string;
  notes?: string;
  /** Details the user typed (the title always counts). */
  setByHand?: SourceDetailField[];
};

export type SourcePatch = Partial<Pick<Source, "title" | "authors" | "type" | "url">> & {
  year?: number | null;
  /** The user typed these (the default): reading a PDF or link won't change them later. */
  byHand?: boolean;
};

/**
 * The only code that touches the content folder. Files on disk are the
 * source of truth; the in-memory index is a cache that is rebuilt from them
 * on startup and rescanned (by file mtime) whenever it is read, so edits
 * made outside the app appear on the next page load.
 */
export class ContentStore {
  readonly dir: string;
  private readonly lock: ContentLock;
  private readonly now: () => Date;
  private readonly refreshIntervalMs: number;

  private journal = new Map<string, JournalEntry>();
  private journalSorted: JournalEntry[] | null = null;
  private sources = new Map<string, Source>();
  private groups = new Map<string, Group>();
  private notes = new Map<string, Note>();
  private settingsCache: Settings = { researchContext: "", extra: {} };
  /** relative path → mtimeMs at last parse */
  private mtimes = new Map<string, number>();

  private indexLock = new Mutex();
  private lastRefresh = 0;
  private forceRefresh = true;

  constructor(opts: StoreOptions) {
    this.now = opts.now ?? (() => new Date());
    this.refreshIntervalMs = opts.refreshIntervalMs ?? 500;
    this.dir = path.resolve(opts.dir);
    this.lock = opts.lock ?? new ContentLock(this.dir);
  }

  async init(): Promise<void> {
    await this.lock.exclusive(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      if (!(await exists(this.abs(SETTINGS_FILE)))) {
        const settings: Settings = { researchContext: "", updated: this.stamp(), extra: {} };
        await writeAtomic(this.abs(SETTINGS_FILE), serializeSettings(settings), this.tmpDir());
      }
    });
    await this.refresh({ force: true });
  }

  // --- Index ----------------------------------------------------------------

  /** Rebuild the index from scratch (equivalent to a restart). */
  async rebuildIndex(): Promise<void> {
    await this.indexLock.run(async () => {
      this.journal.clear();
      this.sources.clear();
      this.groups.clear();
      this.notes.clear();
      this.mtimes.clear();
      this.journalSorted = null;
    });
    await this.refresh({ force: true });
  }

  /**
   * Rescan the content folder and re-parse any file whose mtime changed.
   * Cheap (one stat per file), so it runs on reads, throttled.
   */
  async refresh(opts: { force?: boolean } = {}): Promise<void> {
    const due = Date.now() - this.lastRefresh >= this.refreshIntervalMs;
    if (!opts.force && !this.forceRefresh && !due) return;
    await this.indexLock.run(async () => {
      this.forceRefresh = false;
      this.lastRefresh = Date.now();
      await this.scanAll();
    });
  }

  private async scanAll(): Promise<void> {
    const seen = new Set<string>();

    const journalFiles = await listMarkdown(this.abs(DIRS.journal), true);
    for (const abs of journalFiles) {
      const rel = this.rel(abs);
      seen.add(rel);
      const entry = await this.parseIfChanged(rel, (raw, fallbackDate) =>
        parseJournalEntry(raw, { id: stem(rel), path: rel, fallbackDate }),
      );
      if (entry) {
        this.journal.set(entry.id, entry);
        this.journalSorted = null;
      }
    }

    for (const abs of await listMarkdown(this.abs(DIRS.sources), false)) {
      const rel = this.rel(abs);
      seen.add(rel);
      const source = await this.parseIfChanged(rel, (raw, fallbackDate) =>
        parseSource(raw, { id: stem(rel), path: rel, fallbackDate }),
      );
      if (source) this.sources.set(source.id, source);
    }

    for (const abs of await listMarkdown(this.abs(DIRS.groups), false)) {
      const rel = this.rel(abs);
      seen.add(rel);
      const group = await this.parseIfChanged(rel, (raw, fallbackDate) =>
        parseGroup(raw, { id: stem(rel), path: rel, fallbackDate }),
      );
      if (group) this.groups.set(group.id, group);
    }

    for (const abs of await listMarkdown(this.abs(DIRS.notes), false)) {
      const rel = this.rel(abs);
      seen.add(rel);
      const note = await this.parseIfChanged(rel, (raw, fallbackDate) =>
        parseNote(raw, { id: stem(rel), path: rel, fallbackDate }),
      );
      if (note) this.notes.set(note.id, note);
    }

    if (await exists(this.abs(SETTINGS_FILE))) {
      seen.add(SETTINGS_FILE);
      const settings = await this.parseIfChanged(SETTINGS_FILE, (raw) => parseSettings(raw));
      if (settings) this.settingsCache = settings;
    } else {
      this.settingsCache = { researchContext: "", extra: {} };
    }

    // Drop anything whose file has gone.
    for (const rel of [...this.mtimes.keys()]) {
      if (seen.has(rel)) continue;
      this.mtimes.delete(rel);
      this.forgetPath(rel);
    }
  }

  private async parseIfChanged<T>(
    rel: string,
    parse: (raw: string, fallbackDate: string) => T,
  ): Promise<T | null> {
    let stat;
    try {
      stat = await fs.stat(this.abs(rel));
    } catch {
      return null;
    }
    if (this.mtimes.get(rel) === stat.mtimeMs) return null;
    const raw = await fs.readFile(this.abs(rel), "utf8");
    this.mtimes.set(rel, stat.mtimeMs);
    return parse(raw, toIso(stat.mtime));
  }

  private forgetPath(rel: string): void {
    const id = stem(rel);
    if (rel.startsWith(`${DIRS.journal}/`) && this.journal.get(id)?.path === rel) {
      this.journal.delete(id);
      this.journalSorted = null;
    } else if (rel.startsWith(`${DIRS.sources}/`) && this.sources.get(id)?.path === rel) {
      this.sources.delete(id);
    } else if (rel.startsWith(`${DIRS.groups}/`) && this.groups.get(id)?.path === rel) {
      this.groups.delete(id);
    } else if (rel.startsWith(`${DIRS.notes}/`) && this.notes.get(id)?.path === rel) {
      this.notes.delete(id);
    }
  }

  /** Re-read specific files into the index right after the app wrote them. */
  private async reindexPaths(paths: string[]): Promise<void> {
    for (const rel of paths) {
      if (!rel.endsWith(".md")) continue;
      this.mtimes.delete(rel);
      if (!(await exists(this.abs(rel)))) {
        this.forgetPath(rel);
        continue;
      }
      if (rel === SETTINGS_FILE) {
        const s = await this.parseIfChanged(rel, (raw) => parseSettings(raw));
        if (s) this.settingsCache = s;
      } else if (rel.startsWith(`${DIRS.journal}/`)) {
        const e = await this.parseIfChanged(rel, (raw, d) =>
          parseJournalEntry(raw, { id: stem(rel), path: rel, fallbackDate: d }),
        );
        if (e) {
          this.journal.set(e.id, e);
          this.journalSorted = null;
        }
      } else if (rel.startsWith(`${DIRS.sources}/`)) {
        const s = await this.parseIfChanged(rel, (raw, d) =>
          parseSource(raw, { id: stem(rel), path: rel, fallbackDate: d }),
        );
        if (s) this.sources.set(s.id, s);
      } else if (rel.startsWith(`${DIRS.groups}/`)) {
        const g = await this.parseIfChanged(rel, (raw, d) =>
          parseGroup(raw, { id: stem(rel), path: rel, fallbackDate: d }),
        );
        if (g) this.groups.set(g.id, g);
      } else if (rel.startsWith(`${DIRS.notes}/`)) {
        const n = await this.parseIfChanged(rel, (raw, d) =>
          parseNote(raw, { id: stem(rel), path: rel, fallbackDate: d }),
        );
        if (n) this.notes.set(n.id, n);
      }
    }
  }

  // --- Writes ---------------------------------------------------------------

  /**
   * Every change goes through here: files are written inside the folder's
   * lock. If anything throws, every touched file and folder is put back as
   * it was.
   */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.lock.exclusive(() =>
      this.indexLock.run(async () => {
        await this.scanAll(); // make sure ids and lookups see hand edits
        const tx = new Tx(this);
        let result: T;
        try {
          result = await fn(tx);
        } catch (err) {
          await tx.rollback();
          throw err;
        }
        await tx.cleanup();
        await this.reindexPaths(tx.touched);
        return result;
      }),
    );
  }

  /** Absolute path for a path relative to the content root; refuses to escape it. */
  abs(rel: string): string {
    const resolved = path.resolve(this.dir, rel);
    const inside = path.relative(this.dir, resolved);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) {
      throw new ContentError(`Path outside content folder: ${rel}`, 400);
    }
    // Dot folders (.tmp, .lock) are the app's own.
    if (inside.startsWith(".")) {
      throw new ContentError(`Path not allowed: ${rel}`, 400);
    }
    return resolved;
  }

  private rel(abs: string): string {
    return path.relative(this.dir, abs).split(path.sep).join("/");
  }

  /** Scratch space for atomic writes, uploads and undo copies (same disk, so moves are renames). */
  tmpDir(): string {
    return path.join(this.dir, ".tmp");
  }

  /**
   * Stream an upload to a temporary file before taking the write lock, so a
   * slow 50 MB upload never blocks other writes. Pass the result to
   * `Tx.moveIn` inside a write, or `discardUpload` if it is not used.
   */
  async stageUpload(
    data: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | Buffer,
    opts: { maxBytes?: number } = {},
  ): Promise<{ tempPath: string; size: number }> {
    await fs.mkdir(this.tmpDir(), { recursive: true });
    const tempPath = path.join(this.tmpDir(), `upload-${randomUUID()}`);
    let size = 0;
    const max = opts.maxBytes ?? Infinity;
    const source =
      data instanceof Buffer
        ? Readable.from([data])
        : Readable.from(
            Symbol.asyncIterator in data
              ? (data as AsyncIterable<Uint8Array>)
              : iterateWebStream(data as ReadableStream<Uint8Array>),
          );
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > max) throw new ContentError("File is too large", 413);
            yield chunk;
          }
        },
        createWriteStream(tempPath),
      );
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }
    return { tempPath, size };
  }

  async discardUpload(tempPath: string): Promise<void> {
    if (path.dirname(tempPath) === this.tmpDir()) await fs.rm(tempPath, { force: true });
  }

  private stamp(): string {
    return toIso(this.now());
  }

  // --- Journal --------------------------------------------------------------

  private sortedJournal(): JournalEntry[] {
    if (!this.journalSorted) {
      this.journalSorted = [...this.journal.values()].sort(
        (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
      );
    }
    return this.journalSorted;
  }

  /**
   * A page of entries in chronological order (oldest first), ending just
   * before `before` (an entry id) or at the newest entry.
   */
  async listJournal(opts: { before?: string; limit?: number } = {}): Promise<{
    entries: JournalEntry[];
    hasMore: boolean;
  }> {
    await this.refresh();
    const all = this.sortedJournal();
    const limit = opts.limit ?? 50;
    let end = all.length;
    if (opts.before) {
      const i = all.findIndex((e) => e.id === opts.before);
      end = i === -1 ? all.length : i;
    }
    const start = Math.max(0, end - limit);
    return { entries: all.slice(start, end), hasMore: start > 0 };
  }

  /** Entries from the first one created on or after `iso` through the newest. */
  async journalFrom(iso: string): Promise<{ entries: JournalEntry[]; hasMore: boolean }> {
    await this.refresh();
    const all = this.sortedJournal();
    let start = all.findIndex((e) => e.created >= iso);
    if (start === -1) start = Math.max(0, all.length - 1);
    return { entries: all.slice(start), hasMore: start > 0 };
  }

  async getJournalEntry(id: string): Promise<JournalEntry | null> {
    await this.refresh();
    return this.journal.get(id) ?? null;
  }

  journalAttachmentDir(id: string): string {
    assertSafeId(id);
    return `${DIRS.attachments}/journal/${id}`;
  }

  /**
   * Create an entry. `attachments` are staged uploads (see `stageUpload`)
   * that are moved into attachments/journal/<id>/ in the same change.
   */
  async createJournalEntry(input: {
    body: string;
    attachments?: StagedFile[];
  }): Promise<JournalEntry> {
    const body = input.body.trim();
    if (!body && !input.attachments?.length) {
      throw new ContentError("An entry needs text or an attachment", 400);
    }
    return this.write(async (tx) => {
        const now = this.now();
        const id = uniqueId(journalIdFor(now), (c) => this.journal.has(c));
        const created = toIso(now);
        const rel = `${DIRS.journal}/${created.slice(0, 4)}/${created.slice(5, 7)}/${id}.md`;
        const attachments = await this.moveAttachments(tx, this.journalAttachmentDir(id), input.attachments ?? []);
        const entry: JournalEntry = {
          id,
          path: rel,
          created,
          updated: created,
          attachments,
          body,
          extra: {},
        };
        await tx.writeText(rel, serializeJournalEntry(entry));
        return entry;
      },
    );
  }

  /**
   * Edit an entry. `removeAttachments` lists attachment `file` paths to
   * delete; `addAttachments` are staged uploads to add.
   */
  async updateJournalEntry(
    id: string,
    input: { body?: string; addAttachments?: StagedFile[]; removeAttachments?: string[] },
  ): Promise<JournalEntry> {
    return this.write(async (tx) => {
        const entry = this.requireJournal(id);
        const remove = new Set(input.removeAttachments ?? []);
        for (const file of remove) {
          if (entry.attachments.some((a) => a.file === file)) await tx.removeAttachment(file);
        }
        const kept = entry.attachments.filter((a) => !remove.has(a.file));
        const added = await this.moveAttachments(
          tx,
          this.journalAttachmentDir(id),
          input.addAttachments ?? [],
          new Set(kept.map((a) => a.file)),
        );
        const updated: JournalEntry = {
          ...entry,
          body: input.body !== undefined ? input.body.trim() : entry.body,
          attachments: [...kept, ...added],
          updated: this.stamp(),
        };
        if (!updated.body && !updated.attachments.length) {
          throw new ContentError("An entry needs text or an attachment", 400);
        }
        await tx.writeText(entry.path, serializeJournalEntry(updated));
        return updated;
      },
    );
  }

  /** Delete an entry and its attachments folder. */
  async deleteJournalEntry(id: string): Promise<void> {
    await this.write(async (tx) => {
        const entry = this.requireJournal(id);
        await tx.remove(entry.path);
        for (const a of entry.attachments) await tx.removeAttachment(a.file);
        await tx.remove(this.journalAttachmentDir(id));
      },
    );
  }

  private requireJournal(id: string): JournalEntry {
    const entry = this.journal.get(id);
    if (!entry) throw new ContentError("Journal entry not found", 404);
    if (entry.problem) throw unreadable(entry.path, entry.problem);
    return entry;
  }

  private async moveAttachments(
    tx: Tx,
    dir: string,
    files: StagedFile[],
    taken: Set<string> = new Set(),
  ): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const f of files) {
      const name = safeFileName(f.name);
      const file = uniqueFileName(dir, name, (p) => taken.has(p));
      taken.add(file);
      await tx.moveIn(f.tempPath, file);
      out.push({ file, name: f.name, type: f.type || "application/octet-stream", size: f.size });
    }
    return out;
  }

  // --- Sources --------------------------------------------------------------

  async listSources(): Promise<Source[]> {
    await this.refresh();
    return [...this.sources.values()].sort(
      (a, b) => b.added.localeCompare(a.added) || a.id.localeCompare(b.id),
    );
  }

  async getSource(id: string): Promise<Source | null> {
    await this.refresh();
    return this.sources.get(id) ?? null;
  }

  async createSource(
    input: NewSource,
    opts: { pdf?: StagedFile; groups?: string[] } = {},
  ): Promise<Source> {
    const title = input.title.trim();
    if (!title) throw new ContentError("A source needs a title", 400);
    return this.write(async (tx) => {
        const authors = (input.authors ?? []).map((a) => a.trim()).filter(Boolean);
        const id = uniqueId(
          sourceSlug({ title, authors, year: input.year }),
          (c) => this.sources.has(c) || RESERVED_IDS.has(c) || tx.has(`${DIRS.sources}/${c}.md`),
        );
        const rel = `${DIRS.sources}/${id}.md`;
        let pdf: string | undefined;
        if (opts.pdf) {
          pdf = this.sourcePdfPath(id, opts.pdf.name, []);
          await tx.moveIn(opts.pdf.tempPath, pdf);
        }
        const now = this.stamp();
        const notes = (input.notes ?? "").trim();
        const source: Source = {
          id,
          path: rel,
          title,
          authors,
          year: input.year,
          type: input.type ?? "other",
          links: input.url?.trim() ? [input.url.trim()] : [],
          pdfs: pdf ? [pdf] : [],
          url: input.url?.trim() || undefined,
          pdf,
          added: now,
          updated: now,
          notes,
          aiSummary: null,
          setByHand: SOURCE_DETAIL_FIELDS.filter((f) => f === "title" || (input.setByHand ?? []).includes(f)),
          body: replaceSection("", "Notes", notes, SOURCE_SECTIONS, { position: "start" }),
          extra: {},
        };
        await tx.writeText(rel, serializeSource(source));
        for (const groupId of opts.groups ?? []) {
          const group = this.requireGroup(groupId);
          if (group.sources.some((s) => s.id === id)) continue;
          await this.writeGroup(tx, {
            ...group,
            sources: [...group.sources, { id, note: "" }],
            sourcesChanged: now,
          });
        }
        return source;
      },
    );
  }

  /**
   * Change some of a source's details. Keys left out are unchanged; `year:
   * null` clears the year, and `url` replaces the first link (`""` removes
   * it). An empty title is ignored.
   */
  async updateSource(id: string, patch: SourcePatch): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      const next: Source = {
        ...source,
        title: patch.title?.trim() || source.title,
        authors: patch.authors ? patch.authors.map((a) => a.trim()).filter(Boolean) : source.authors,
        year: "year" in patch ? (patch.year ?? undefined) : source.year,
        type: patch.type ?? source.type,
        updated: this.stamp(),
      };
      // Record what the user typed; filling in from a PDF or link keeps the record as it was.
      const touched = patch.byHand === false ? [] : SOURCE_DETAIL_FIELDS.filter((f) => f in patch);
      next.setByHand = SOURCE_DETAIL_FIELDS.filter((f) => touched.includes(f) || setByHand(source).includes(f));
      if ("url" in patch) {
        const url = patch.url?.trim();
        const rest = source.links.slice(1).filter((l) => l !== url);
        next.links = url ? [url, ...rest] : rest;
      }
      const saved = withPrimary(next);
      await tx.writeText(source.path, serializeSource(saved));
      return saved;
    });
  }

  /** Add a link (to the end), change one, or remove one. `from` is the link being changed. */
  async setSourceLink(id: string, change: { from?: string; to?: string }): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      const to = change.to?.trim();
      if (to && !/^https?:\/\//i.test(to)) throw new ContentError("The link should start with http:// or https://", 400);
      let links = [...source.links];
      const at = change.from ? links.indexOf(change.from) : -1;
      if (change.from && at < 0) throw new ContentError("That link isn't on this source any more", 404);
      if (at >= 0) {
        if (to) links[at] = to;
        else links.splice(at, 1);
      } else if (to) {
        links.push(to);
      }
      links = [...new Set(links)];
      const next = withPrimary({ ...source, links, updated: this.stamp() });
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /** Rewrite only the `## Notes` section. */
  async setSourceNotes(id: string, notes: string): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      const body = replaceSection(source.body, "Notes", notes, SOURCE_SECTIONS, {
        position: "start",
        preambleFallback: true,
      });
      const next = { ...source, body, notes: notes.trim(), updated: this.stamp() };
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /**
   * Where a new PDF goes: attachments/sources/<id>/<its own name>.pdf.
   * (Sources from before several PDFs were allowed may also have
   * attachments/sources/<id>.pdf, which keeps working.)
   */
  private sourcePdfPath(id: string, name: string, taken: string[]): string {
    const file = safeFileName(/\.pdf$/i.test(name) ? name : `${name || "document"}.pdf`);
    return uniqueFileName(`${DIRS.attachments}/sources/${id}`, file, (p) => taken.includes(p));
  }

  /** Add a PDF to a source (it can have any number). */
  async addSourcePdf(id: string, pdf: StagedFile): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      const path = this.sourcePdfPath(id, pdf.name, source.pdfs);
      await tx.moveIn(pdf.tempPath, path);
      const next = withPrimary({ ...source, pdfs: [...source.pdfs, path], updated: this.stamp() });
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /** Remove one of a source's PDFs (and its file). */
  async removeSourcePdf(id: string, file: string): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      if (!source.pdfs.includes(file)) throw new ContentError("That PDF isn't on this source any more", 404);
      await tx.removeAttachment(file);
      const next = withPrimary({ ...source, pdfs: source.pdfs.filter((p) => p !== file), updated: this.stamp() });
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /** Rewrite only the `## AI summary` section. */
  async setSourceAiSummary(id: string, summary: { text: string; model: string }): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      const generated = this.stamp();
      const body = setAiSummary(source.body, { ...summary, generated }, SOURCE_SECTIONS);
      const next = { ...source, body, updated: generated };
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /** Delete a source, its PDFs, and its membership of every group, all or nothing. */
  async deleteSource(id: string): Promise<void> {
    await this.write(async (tx) => {
      const source = this.requireSource(id);
      const now = this.stamp();
      for (const group of this.groups.values()) {
        if (!group.sources.some((s) => s.id === id)) continue;
        if (group.problem) throw unreadable(group.path, group.problem);
        await this.writeGroup(tx, {
          ...group,
          sources: group.sources.filter((s) => s.id !== id),
          sourcesChanged: now,
        });
      }
      for (const pdf of source.pdfs) await tx.removeAttachment(pdf);
      await tx.remove(`${DIRS.attachments}/sources/${id}`);
      await tx.remove(source.path);
    });
  }

  /**
   * Sources and notes whose text links to this source ([text](/library/<id>)),
   * for "Referenced by" on its page. A source doesn't count as referencing itself.
   */
  async referencesTo(id: string): Promise<Array<{ kind: "source" | "note"; id: string; title: string }>> {
    await this.refresh();
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const link = new RegExp(`\\]\\(\\s*/library/${escaped}(?=[\\s)#?])`);
    const out: Array<{ kind: "source" | "note"; id: string; title: string }> = [];
    for (const s of this.sources.values()) {
      if (s.id !== id && link.test(s.body)) out.push({ kind: "source", id: s.id, title: s.title });
    }
    for (const n of this.notes.values()) {
      if (link.test(n.body)) out.push({ kind: "note", id: n.id, title: n.title });
    }
    return out.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "source" ? -1 : 1));
  }

  private requireSource(id: string): Source {
    const source = this.sources.get(id);
    if (!source) throw new ContentError("Source not found", 404);
    if (source.problem) throw unreadable(source.path, source.problem);
    return source;
  }

  // --- Groups ---------------------------------------------------------------

  async listGroups(): Promise<Group[]> {
    await this.refresh();
    return [...this.groups.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async getGroup(id: string): Promise<Group | null> {
    await this.refresh();
    return this.groups.get(id) ?? null;
  }

  async groupsForSource(sourceId: string): Promise<Group[]> {
    return (await this.listGroups()).filter((g) => g.sources.some((s) => s.id === sourceId));
  }

  async createGroup(input: { title: string; overview?: string }): Promise<Group> {
    const title = input.title.trim();
    if (!title) throw new ContentError("A group needs a title", 400);
    return this.write(async (tx) => {
        const id = uniqueId(slugify(title) || "group", (c) => this.groups.has(c) || RESERVED_IDS.has(c));
        const now = this.stamp();
        const overview = (input.overview ?? "").trim();
        const group: Group = {
          id,
          path: `${DIRS.groups}/${id}.md`,
          title,
          created: now,
          updated: now,
          sources: [],
          overview,
          aiSummary: null,
          body: replaceSection("", "Overview", overview, GROUP_SECTIONS, { position: "start" }),
          extra: {},
        };
        await this.writeGroup(tx, group, false);
        return group;
      },
    );
  }

  async renameGroup(id: string, title: string): Promise<Group> {
    if (!title.trim()) throw new ContentError("A group needs a title", 400);
    return this.write((tx) =>
      this.writeGroup(tx, { ...this.requireGroup(id), title: title.trim() }),
    );
  }

  /** Rewrite only the `## Overview` section. */
  async setGroupOverview(id: string, overview: string): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(id);
      const body = replaceSection(group.body, "Overview", overview, GROUP_SECTIONS, {
        position: "start",
        preambleFallback: true,
      });
      return this.writeGroup(tx, { ...group, body, overview: overview.trim() });
    });
  }

  /**
   * Replace the group's ordered source list (used for add, remove, reorder
   * and editing group-specific notes). Unknown source ids are rejected.
   */
  async setGroupSources(id: string, refs: GroupSourceRef[]): Promise<Group> {
    return this.write((tx) =>
      this.applyGroupSources(tx, this.requireGroup(id), refs),
    );
  }

  async addSourceToGroup(groupId: string, sourceId: string, note = ""): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(groupId);
      if (group.sources.some((s) => s.id === sourceId)) return group;
      return this.applyGroupSources(tx, group, [...group.sources, { id: sourceId, note }]);
    });
  }

  async removeSourceFromGroup(groupId: string, sourceId: string): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(groupId);
      return this.applyGroupSources(
        tx,
        group,
        group.sources.filter((s) => s.id !== sourceId),
      );
    });
  }

  private async applyGroupSources(tx: Tx, group: Group, refs: GroupSourceRef[]): Promise<Group> {
      const seen = new Set<string>();
      const clean: GroupSourceRef[] = [];
      for (const ref of refs) {
        if (seen.has(ref.id)) continue;
        // A reference already in the group may point at a source deleted by
        // hand; keep it rather than refusing every edit to the group.
        const alreadyHere = group.sources.some((s) => s.id === ref.id);
        if (!this.sources.has(ref.id) && !alreadyHere) {
          throw new ContentError(`Unknown source: ${ref.id}`, 400);
        }
        seen.add(ref.id);
        clean.push({ id: ref.id, note: (ref.note ?? "").trim() });
      }
      const membershipChanged =
        clean.length !== group.sources.length ||
        clean.some((r, i) => r.id !== group.sources[i]?.id);
      return this.writeGroup(tx, {
        ...group,
        sources: clean,
        sourcesChanged: membershipChanged ? this.stamp() : group.sourcesChanged,
      });
  }

  /** Change the group-specific note for one source. */
  async setGroupSourceNote(groupId: string, sourceId: string, note: string): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(groupId);
      if (!group.sources.some((s) => s.id === sourceId)) {
        throw new ContentError("That source isn't in this group", 404);
      }
      return this.writeGroup(tx, {
        ...group,
        sources: group.sources.map((s) => (s.id === sourceId ? { ...s, note: note.trim() } : s)),
      });
    });
  }

  /** Rewrite only the `## AI summary` section. */
  async setGroupAiSummary(id: string, summary: { text: string; model: string }): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(id);
      const generated = this.stamp();
      const body = setAiSummary(group.body, { ...summary, generated }, GROUP_SECTIONS);
      return this.writeGroup(tx, { ...group, body, aiSummary: { ...summary, generated } });
    });
  }

  /** Archive or unarchive a source on its own (hidden from the library, groups and map by default). */
  async setSourceArchived(id: string, archived: boolean): Promise<Source> {
    return this.write(async (tx) => {
      const source = this.requireSource(id);
      if (!!source.archived === archived) return source;
      const next = { ...source, archived: archived ? this.stamp() : undefined, archivedWith: undefined, updated: this.stamp() };
      await tx.writeText(source.path, serializeSource(next));
      return next;
    });
  }

  /**
   * Archive a group and every source in it that isn't archived already
   * (marked as archived with this group). Unarchiving brings back the group
   * and just those sources; ones archived separately stay archived.
   */
  async setGroupArchived(id: string, archived: boolean): Promise<Group> {
    return this.write(async (tx) => {
      const group = this.requireGroup(id);
      const now = this.stamp();
      for (const ref of group.sources) {
        const source = this.sources.get(ref.id);
        if (!source || source.problem) continue;
        if (archived && !source.archived) {
          await tx.writeText(source.path, serializeSource({ ...source, archived: now, archivedWith: id, updated: now }));
        } else if (!archived && source.archived && source.archivedWith === id) {
          await tx.writeText(source.path, serializeSource({ ...source, archived: undefined, archivedWith: undefined, updated: now }));
        }
      }
      return this.writeGroup(tx, { ...group, archived: archived ? now : undefined });
    });
  }

  /** Deleting a group never deletes its sources. */
  async deleteGroup(id: string): Promise<void> {
    await this.write(async (tx) => {
      const group = this.groups.get(id);
      if (!group) throw new ContentError("Group not found", 404);
      await tx.remove(group.path);
    });
  }

  private requireGroup(id: string): Group {
    const group = this.groups.get(id);
    if (!group) throw new ContentError("Group not found", 404);
    if (group.problem) throw unreadable(group.path, group.problem);
    return group;
  }

  private async writeGroup(tx: Tx, group: Group, touch = true): Promise<Group> {
    const next = touch ? { ...group, updated: this.stamp() } : group;
    await tx.writeText(next.path, serializeGroup(next));
    return next;
  }

  /**
   * A group summary is stale if, since it was generated, the group's
   * sources changed or any member source was re-summarised.
   */
  isGroupSummaryStale(group: Group): boolean {
    const generated = group.aiSummary?.generated;
    if (!generated) return false;
    if (group.sourcesChanged && group.sourcesChanged > generated) return true;
    return group.sources.some((ref) => {
      const s = this.sources.get(ref.id)?.aiSummary?.generated;
      return !!s && s > generated;
    });
  }

  // --- Notes ----------------------------------------------------------------

  /** Most recently changed first. */
  async listNotes(): Promise<Note[]> {
    await this.refresh();
    return [...this.notes.values()].sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  }

  async getNote(id: string): Promise<Note | null> {
    await this.refresh();
    return this.notes.get(id) ?? null;
  }

  noteAttachmentDir(id: string): string {
    assertSafeId(id);
    return `${DIRS.attachments}/notes/${id}`;
  }

  /** Create a note; its file name comes from the title and never changes. */
  async createNote(input: { title: string; text?: string; attachments?: StagedFile[] }): Promise<Note> {
    const title = input.title.trim();
    if (!title) throw new ContentError("A note needs a title", 400);
    return this.write(async (tx) => {
        const id = uniqueId(
          slugify(title) || "note",
          (c) => this.notes.has(c) || RESERVED_IDS.has(c) || tx.has(`${DIRS.notes}/${c}.md`),
        );
        const now = this.stamp();
        const text = (input.text ?? "").trim();
        const note: Note = {
          id,
          path: `${DIRS.notes}/${id}.md`,
          title,
          created: now,
          updated: now,
          attachments: await this.moveAttachments(tx, this.noteAttachmentDir(id), input.attachments ?? []),
          text,
          aiSummary: null,
          body: replaceSection("", "Notes", text, NOTE_SECTIONS, { position: "start" }),
          extra: {},
        };
        await tx.writeText(note.path, serializeNote(note));
        return note;
      },
    );
  }

  async renameNote(id: string, title: string): Promise<Note> {
    if (!title.trim()) throw new ContentError("A note needs a title", 400);
    return this.write(async (tx) => {
      const next = { ...this.requireNote(id), title: title.trim(), updated: this.stamp() };
      await tx.writeText(next.path, serializeNote(next));
      return next;
    });
  }

  /** Rewrite only the `## Notes` section (the note's text). */
  async setNoteText(id: string, text: string): Promise<Note> {
    return this.write(async (tx) => {
      const note = this.requireNote(id);
      const body = replaceSection(note.body, "Notes", text, NOTE_SECTIONS, {
        position: "start",
        preambleFallback: true,
      });
      const next = { ...note, body, text: text.trim(), updated: this.stamp() };
      await tx.writeText(note.path, serializeNote(next));
      return next;
    });
  }

  /** Add staged uploads and/or remove attachments (by `file` path). */
  async updateNoteAttachments(id: string, input: { add?: StagedFile[]; remove?: string[] }): Promise<Note> {
    return this.write(async (tx) => {
      const note = this.requireNote(id);
      const remove = new Set(input.remove ?? []);
      for (const file of remove) {
        if (note.attachments.some((a) => a.file === file)) await tx.removeAttachment(file);
      }
      const kept = note.attachments.filter((a) => !remove.has(a.file));
      const added = await this.moveAttachments(
        tx,
        this.noteAttachmentDir(id),
        input.add ?? [],
        new Set(kept.map((a) => a.file)),
      );
      const next = { ...note, attachments: [...kept, ...added], updated: this.stamp() };
      await tx.writeText(note.path, serializeNote(next));
      return next;
    });
  }

  /** Rewrite only the `## AI summary` section. */
  async setNoteAiSummary(id: string, summary: { text: string; model: string }): Promise<Note> {
    return this.write(async (tx) => {
      const note = this.requireNote(id);
      const generated = this.stamp();
      const body = setAiSummary(note.body, { ...summary, generated }, NOTE_SECTIONS);
      const next = { ...note, body, updated: generated };
      await tx.writeText(note.path, serializeNote(next));
      return next;
    });
  }

  /** Delete a note and its attachments. */
  async deleteNote(id: string): Promise<void> {
    await this.write(async (tx) => {
      const note = this.requireNote(id);
      await tx.remove(note.path);
      for (const a of note.attachments) await tx.removeAttachment(a.file);
      await tx.remove(this.noteAttachmentDir(id));
    });
  }

  private requireNote(id: string): Note {
    const note = this.notes.get(id);
    if (!note) throw new ContentError("Note not found", 404);
    if (note.problem) throw unreadable(note.path, note.problem);
    return note;
  }

  // --- Settings -------------------------------------------------------------

  async getSettings(): Promise<Settings> {
    await this.refresh();
    return this.settingsCache;
  }

  async setResearchContext(text: string): Promise<Settings> {
    return this.write(async (tx) => {
      const next: Settings = { ...this.settingsCache, researchContext: text.trim(), updated: this.stamp() };
      await tx.writeText(SETTINGS_FILE, serializeSettings(next));
      return next;
    });
  }

  // --- Files & sync ---------------------------------------------------------

  /**
   * Absolute path of an attachment or PDF for serving, or null. Only files
   * under attachments/ can be served.
   */
  async attachmentPath(rel: string): Promise<string | null> {
    if (!rel.startsWith(`${DIRS.attachments}/`)) return null;
    let abs: string;
    try {
      abs = this.abs(rel);
    } catch {
      return null;
    }
    const stat = await fs.stat(abs).catch(() => null);
    return stat?.isFile() ? abs : null;
  }

}

export type StagedFile = { tempPath: string; name: string; type: string; size: number };

/** File operations within one write; tracks touched paths so they can be undone. */
class Tx {
  readonly touched: string[] = [];
  /** path → copy kept aside (null: it didn't exist before this change) */
  private backups = new Map<string, string | null>();

  constructor(private readonly store: ContentStore) {}

  has(rel: string): boolean {
    return this.touched.includes(rel);
  }

  /** Before a file is written, keep a copy of what was there (or note it was new). */
  private async track(rel: string): Promise<void> {
    if (!this.touched.includes(rel)) this.touched.push(rel);
    if (this.backups.has(rel)) return;
    const abs = this.store.abs(rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat?.isFile()) {
      await fs.mkdir(this.store.tmpDir(), { recursive: true });
      const backup = path.join(this.store.tmpDir(), `backup-${randomUUID()}`);
      await fs.copyFile(abs, backup);
      this.backups.set(rel, backup);
    } else {
      this.backups.set(rel, null);
    }
  }

  async writeText(rel: string, text: string): Promise<void> {
    await this.track(rel);
    await writeAtomic(this.store.abs(rel), text, this.store.tmpDir());
  }

  /** Move a staged upload into place (same filesystem, so it is a rename). */
  async moveIn(tempPath: string, rel: string): Promise<void> {
    await this.track(rel);
    const abs = this.store.abs(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.rename(tempPath, abs);
  }

  /**
   * Attachment paths come from frontmatter, which may be hand-edited, so
   * only ever delete files under attachments/.
   */
  async removeAttachment(rel: string): Promise<void> {
    if (!rel.startsWith(`${DIRS.attachments}/`) || rel.split("/").includes("..")) return;
    await this.remove(rel);
  }

  /** Remove a file or folder, keeping it aside until the change succeeds. */
  async remove(rel: string): Promise<void> {
    const abs = this.store.abs(rel);
    if (!this.touched.includes(rel)) this.touched.push(rel);
    if (!this.backups.has(rel)) {
      const stat = await fs.stat(abs).catch(() => null);
      if (stat) {
        await fs.mkdir(this.store.tmpDir(), { recursive: true });
        const aside = path.join(this.store.tmpDir(), `removed-${randomUUID()}`);
        await fs.rename(abs, aside);
        this.backups.set(rel, aside);
      } else {
        this.backups.set(rel, null);
      }
    }
    await fs.rm(abs, { recursive: true, force: true });
    await removeEmptyParents(path.dirname(abs), this.store.dir);
  }

  /** Put files and folders back as they were before this change. */
  async rollback(): Promise<void> {
    // Newest first, so a folder comes back before files are restored inside it.
    for (const [rel, backup] of [...this.backups].reverse()) {
      const abs = this.store.abs(rel);
      // Clear whatever this change put there (if anything) before restoring.
      if (await exists(abs)) await fs.rm(abs, { recursive: true, force: true });
      if (backup) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.rename(backup, abs);
      }
    }
    this.backups.clear();
  }

  async cleanup(): Promise<void> {
    for (const backup of this.backups.values()) {
      if (backup) await fs.rm(backup, { recursive: true, force: true });
    }
  }
}

// --- helpers ------------------------------------------------------------------

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
}

async function exists(abs: string): Promise<boolean> {
  return fs
    .stat(abs)
    .then(() => true)
    .catch(() => false);
}

async function writeAtomic(abs: string, text: string, tmpDir: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `write-${randomUUID()}`);
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, abs);
}

async function listMarkdown(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory() && recursive) out.push(...(await listMarkdown(abs, true)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

async function removeEmptyParents(dir: string, root: string): Promise<void> {
  let current = dir;
  while (current.startsWith(root) && current !== root) {
    const entries = await fs.readdir(current).catch(() => null);
    if (!entries || entries.length) return;
    await fs.rmdir(current).catch(() => {});
    current = path.dirname(current);
  }
}

function stem(rel: string): string {
  return path.posix.basename(rel, ".md");
}

function safeFileName(name: string): string {
  const base = path.posix.basename(name.replace(/\\/g, "/"));
  const ext = path.posix.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const stemPart = slugify(base.slice(0, base.length - path.posix.extname(base).length), 12);
  return `${stemPart || "file"}${ext}`;
}

function uniqueFileName(dir: string, name: string, taken: (p: string) => boolean): string {
  const ext = path.posix.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = `${dir}/${name}`;
  for (let n = 2; taken(candidate); n++) candidate = `${dir}/${base}-${n}${ext}`;
  return candidate;
}

function unreadable(rel: string, problem: string): ContentError {
  return new ContentError(
    `${rel} has frontmatter that can't be read (${problem}). Fix it in a text editor first; the app won't overwrite it.`,
    409,
  );
}

async function* iterateWebStream(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
