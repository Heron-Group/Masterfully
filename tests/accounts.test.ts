import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Accounts, type Identity } from "@/lib/accounts";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/ai/user-config";
import { GitSync } from "@/lib/content/git";
import { ContentStore } from "@/lib/content/store";

let root: string;
let dir: string;
let git: GitSync;
const stores: ContentStore[] = [];

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

const google = (sub: string, email: string, verified = true): Identity => ({
  provider: "google",
  subject: sub,
  email,
  emailVerified: verified,
});

function workspace(id: string, name = id) {
  const store = new ContentStore({
    git,
    repoDir: dir,
    prefix: `users/${id}`,
    author: { name, email: `${id}@example.com` },
    refreshIntervalMs: 0,
  });
  stores.push(store);
  return store;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-accounts-"));
  dir = path.join(root, "content");
  git = new GitSync({ dir, branch: "main", pushDelayMs: 60_000, authorName: "Portal", authorEmail: "portal@example.com" });
  await git.ensureRepo();
});

afterEach(async () => {
  for (const s of stores.splice(0)) s.dispose();
  git.dispose();
  await fs.rm(root, { recursive: true, force: true });
});

describe("accounts", () => {
  it("creates an account on first sign-in and finds it again", async () => {
    const accounts = new Accounts({ dir, git });
    const a = await accounts.signIn(google("g1", "Ada@Example.com"), { name: "Ada" });
    expect(a).toMatchObject({ name: "Ada", email: "Ada@Example.com" });
    expect(a.id).toMatch(/^u[0-9a-f]{10}$/);
    expect(await fs.readFile(path.join(dir, "accounts", `${a.id}.md`), "utf8")).toContain("provider: google");
    expect(sh("log", "-1", "--format=%s")).toBe(`account: create ${a.id}`);

    const again = await new Accounts({ dir, git }).signIn(google("g1", "ada@example.com"), {});
    expect(again.id).toBe(a.id);
    expect(await accounts.list()).toHaveLength(1);
  });

  it("links a second provider only by verified email", async () => {
    const accounts = new Accounts({ dir, git });
    const a = await accounts.signIn(google("g1", "ada@example.com"), { name: "Ada" });
    const ms: Identity = { provider: "microsoft", subject: "m1", email: "ADA@example.com", emailVerified: true };
    const linked = await accounts.signIn(ms, {});
    expect(linked.id).toBe(a.id);
    expect(linked.identities.map((i) => i.provider)).toEqual(["google", "microsoft"]);

    // An unverified address (e.g. a work tenant) never joins someone else's account.
    const work: Identity = { provider: "microsoft", subject: "m2", email: "ada@example.com", emailVerified: false };
    const other = await accounts.signIn(work, {});
    expect(other.id).not.toBe(a.id);
  });

  it("moves single-user content into the owner's workspace once", async () => {
    await fs.mkdir(path.join(dir, "journal", "2026", "10"), { recursive: true });
    await fs.writeFile(path.join(dir, "journal", "2026", "10", "entry.md"), "---\ncreated: 2026-10-09T10:00:00Z\n---\n\nHello\n");
    await fs.writeFile(path.join(dir, "settings.md"), "---\nupdated: 2026-10-09T10:00:00Z\n---\n\nMy PhD\n");
    await git.exclusive(() => git.commitPaths(["journal", "settings.md"], "old content"));

    const accounts = new Accounts({ dir, git }, "owner@example.com");
    const stranger = await accounts.signIn(google("g2", "someone@example.com"), {});
    expect(await fs.stat(path.join(dir, "settings.md")).catch(() => null)).not.toBeNull(); // not theirs

    const owner = await accounts.signIn(google("g1", "owner@example.com"), { name: "Owner" });
    expect(accounts.isOwner(owner)).toBe(true);
    expect(accounts.isOwner(stranger)).toBe(false);
    expect(await fs.stat(path.join(dir, "settings.md")).catch(() => null)).toBeNull();
    expect(await fs.readFile(path.join(dir, "users", owner.id, "settings.md"), "utf8")).toContain("My PhD");
    expect(sh("status", "--porcelain")).toBe("");

    const store = workspace(owner.id);
    await store.init();
    expect((await store.getSettings()).researchContext).toBe("My PhD");
    expect((await store.listJournal()).entries).toHaveLength(1);
  });
});

describe("workspaces", () => {
  it("keeps each user's content in their own folder, committed as them", async () => {
    const a = workspace("ua", "Ada");
    const b = workspace("ub", "Bo");
    await a.init();
    await b.init();
    const src = await a.createSource({ title: "Only Ada's" });
    expect(src.path).toBe(`sources/${src.id}.md`);
    expect(await fs.stat(path.join(dir, "users", "ua", src.path))).toBeTruthy();
    expect(await b.listSources()).toHaveLength(0);
    expect(await b.getSource(src.id)).toBeNull();
    expect(sh("log", "-1", "--format=%an <%ae>")).toBe("Ada <ua@example.com>");
    expect(sh("show", "--name-only", "--format=", "HEAD")).toBe(`users/ua/sources/${src.id}.md`);
  });

  it("refuses paths that escape the workspace", async () => {
    const a = workspace("ua");
    await a.init();
    await fs.mkdir(path.join(dir, "users", "ub", "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "users", "ub", "attachments", "secret.pdf"), "x");
    expect(await a.attachmentPath("../ub/attachments/secret.pdf")).toBeNull();
    expect(await a.attachmentPath("attachments/../../ub/attachments/secret.pdf")).toBeNull();
  });
});

describe("API key encryption", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips and rejects a wrong key or tampering", () => {
    const enc = encryptSecret("sk-ant-api03-secret-value", key);
    expect(enc.data).not.toContain("secret");
    expect(decryptSecret(enc, key)).toBe("sk-ant-api03-secret-value");
    expect(decryptSecret(enc, Buffer.alloc(32, 8))).toBeNull();
    const flipped = Buffer.from(enc.data, "base64");
    flipped[0] ^= 1;
    expect(decryptSecret({ ...enc, data: flipped.toString("base64") }, key)).toBeNull();
  });

  it("shows only a hint of the key", () => {
    expect(keyHint("sk-ant-api03-abcdefgh1234")).toBe("sk-ant-…1234");
    expect(keyHint("sk-proj-zzzz9876")).toBe("sk-proj-…9876");
  });
});
