import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Accounts, type Identity } from "@/lib/accounts";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/ai/user-config";
import { ContentLock } from "@/lib/content/lock";
import { migrateToUserFolders } from "@/lib/content/migrate";
import { ContentStore } from "@/lib/content/store";

let root: string;
let dir: string;
let lock: ContentLock;

const google = (sub: string, email: string, verified = true): Identity => ({
  provider: "google",
  subject: sub,
  email,
  emailVerified: verified,
});

function workspace(id: string) {
  return new ContentStore({ dir: path.join(dir, "users", id), refreshIntervalMs: 0 });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "portal-accounts-"));
  dir = path.join(root, "content");
  await fs.mkdir(dir, { recursive: true });
  lock = new ContentLock(dir);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("accounts", () => {
  it("creates an account on first sign-in and finds it again", async () => {
    const accounts = new Accounts({ dir, lock });
    const a = await accounts.signIn(google("g1", "Ada@Example.com"), { name: "Ada" });
    expect(a).toMatchObject({ name: "Ada", email: "Ada@Example.com" });
    expect(a.id).toMatch(/^u[0-9a-f]{10}$/);
    expect(await fs.readFile(path.join(dir, "users", a.id, "account.md"), "utf8")).toContain("provider: google");

    const again = await new Accounts({ dir, lock }).signIn(google("g1", "ada@example.com"), {});
    expect(again.id).toBe(a.id);
    expect(await accounts.list()).toHaveLength(1);
  });

  it("links a second provider only by verified email", async () => {
    const accounts = new Accounts({ dir, lock });
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

    const accounts = new Accounts({ dir, lock }, "owner@example.com");
    const stranger = await accounts.signIn(google("g2", "someone@example.com"), {});
    expect(await fs.stat(path.join(dir, "settings.md")).catch(() => null)).not.toBeNull(); // not theirs

    const owner = await accounts.signIn(google("g1", "owner@example.com"), { name: "Owner" });
    expect(accounts.isOwner(owner)).toBe(true);
    expect(accounts.isOwner(stranger)).toBe(false);
    expect(await fs.stat(path.join(dir, "settings.md")).catch(() => null)).toBeNull();
    expect(await fs.readFile(path.join(dir, "users", owner.id, "settings.md"), "utf8")).toContain("My PhD");

    const store = workspace(owner.id);
    await store.init();
    expect((await store.getSettings()).researchContext).toBe("My PhD");
    expect((await store.listJournal()).entries).toHaveLength(1);
  });
});

describe("workspaces", () => {
  it("keeps each user's content in their own folder", async () => {
    const a = workspace("ua");
    const b = workspace("ub");
    await a.init();
    await b.init();
    const src = await a.createSource({ title: "Only Ada's" });
    expect(src.path).toBe(`sources/${src.id}.md`);
    expect(await fs.stat(path.join(dir, "users", "ua", src.path))).toBeTruthy();
    expect(await b.listSources()).toHaveLength(0);
    expect(await b.getSource(src.id)).toBeNull();
  });

  it("refuses paths that escape the workspace", async () => {
    const a = workspace("ua");
    await a.init();
    await fs.mkdir(path.join(dir, "users", "ub", "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "users", "ub", "attachments", "secret.pdf"), "x");
    expect(await a.attachmentPath("../ub/attachments/secret.pdf")).toBeNull();
    expect(await a.attachmentPath("attachments/../../ub/attachments/secret.pdf")).toBeNull();
    // The account file and AI key sit in the same folder but are never served.
    expect(await a.attachmentPath("account.md")).toBeNull();
    expect(await a.attachmentPath("ai-key.json")).toBeNull();
  });

  it("moves the earlier layout into one folder per user, once", async () => {
    const secrets = path.join(root, "secrets");
    await fs.mkdir(path.join(dir, "accounts"), { recursive: true });
    await fs.mkdir(path.join(dir, "users", "ua"), { recursive: true });
    await fs.writeFile(path.join(dir, "accounts", "ua.md"), "---\nid: ua\nemail: ada@example.com\nname: Ada\n---\n");
    await fs.mkdir(path.join(secrets, "ai"), { recursive: true });
    await fs.writeFile(path.join(secrets, "ai", "ua.json"), '{"version":1}');

    const moved = await migrateToUserFolders(dir, secrets);
    expect(moved).toHaveLength(2);
    expect(await fs.readFile(path.join(dir, "users", "ua", "account.md"), "utf8")).toContain("Ada");
    expect(await fs.readFile(path.join(dir, "users", "ua", "ai-key.json"), "utf8")).toBe('{"version":1}');
    expect((await fs.stat(path.join(dir, "users", "ua", "ai-key.json"))).mode & 0o077).toBe(0);
    expect(await fs.stat(path.join(dir, "accounts")).catch(() => null)).toBeNull();
    expect(await fs.stat(secrets).catch(() => null)).toBeNull();
    expect((await new Accounts({ dir, lock }).get("ua"))?.name).toBe("Ada");

    expect(await migrateToUserFolders(dir, secrets)).toEqual([]); // nothing left to move
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
