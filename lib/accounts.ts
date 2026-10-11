import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isoDate, optStr, parseFile, record, str, stringifyFile, toIso } from "./content/frontmatter";
import type { ContentLock } from "./content/lock";
import { writeAtomicFile } from "./content/atomic";

/**
 * User accounts. Everything about a person lives in one folder,
 * users/<id>/: their account file (account.md: name, email, sign-ins), their
 * encrypted AI key (ai-key.json) and their content. Deleting that folder
 * removes the person entirely.
 */

export type Identity = {
  provider: "google" | "microsoft" | "password" | "dev";
  subject: string;
  email?: string;
  emailVerified: boolean;
};

export type Account = {
  id: string;
  email: string;
  name: string;
  created: string;
  identities: Identity[];
};

export type Repo = { dir: string; lock: ContentLock };

export const USERS_DIR = "users";
/** In each user's folder; never part of their content or their data download. */
export const ACCOUNT_FILE = "account.md";
/** The user's encrypted AI key and provider settings (see lib/ai/user-config.ts). */
export const AI_KEY_FILE = "ai-key.json";
/** What the user has used through Masterfully (requests, tokens, speech), per month. */
export const AI_USAGE_FILE = "ai-usage.json";

/** Content from the single-user version, at the repository root. */
const LEGACY_PATHS = ["journal", "sources", "groups", "attachments", "settings.md"];

function accountPath(id: string) {
  return `${USERS_DIR}/${id}/${ACCOUNT_FILE}`;
}

function newId() {
  return `u${randomBytes(5).toString("hex")}`;
}

function parseAccount(raw: string, id: string): Account | null {
  const { data, error } = parseFile(raw);
  if (error) return null;
  const identities = Array.isArray(data.identities)
    ? data.identities.flatMap((x) => {
        const r = record(x);
        const provider = str(r.provider) as Identity["provider"];
        const subject = str(r.subject);
        if (!provider || !subject) return [];
        return [{ provider, subject, email: optStr(r.email), emailVerified: r.email_verified === true }];
      })
    : [];
  return {
    id,
    email: str(data.email),
    name: str(data.name),
    created: isoDate(data.created, toIso(new Date(0))),
    identities,
  };
}

function serializeAccount(a: Account): string {
  return stringifyFile(
    {
      id: a.id,
      email: a.email,
      name: a.name,
      created: a.created,
      identities: a.identities.map((i) => ({
        provider: i.provider,
        subject: i.subject,
        email: i.email,
        email_verified: i.emailVerified,
      })),
    },
    "",
  );
}

const sameEmail = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export class Accounts {
  private byId = new Map<string, Account>();
  private loaded = false;

  constructor(
    private readonly repo: Repo,
    private readonly ownerEmail?: string,
  ) {}

  private async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.byId.clear();
    const users = path.join(this.repo.dir, USERS_DIR);
    for (const id of await fs.readdir(users).catch(() => [] as string[])) {
      const raw = await fs.readFile(path.join(users, id, ACCOUNT_FILE), "utf8").catch(() => null);
      const account = raw === null ? null : parseAccount(raw, id);
      if (account) this.byId.set(id, account);
    }
    this.loaded = true;
  }

  async get(id: string): Promise<Account | null> {
    await this.load();
    if (!this.byId.has(id)) await this.load(true); // created by another process or by hand
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<Account[]> {
    await this.load(true);
    return [...this.byId.values()];
  }

  isOwner(account: Account): boolean {
    return !!this.ownerEmail && account.identities.some((i) => i.emailVerified && sameEmail(i.email, this.ownerEmail));
  }

  /**
   * The account for a sign-in, creating it on first sign-in. Identities are
   * matched by provider and subject; a new identity joins an existing account
   * only when both sides have the same *verified* email address.
   */
  async signIn(identity: Identity, profile: { name?: string }): Promise<Account> {
    return this.repo.lock.exclusive(async () => {
      await this.load(true);
      const all = [...this.byId.values()];
      let account =
        all.find((a) => a.identities.some((i) => i.provider === identity.provider && i.subject === identity.subject)) ??
        (identity.emailVerified
          ? all.find((a) => a.identities.some((i) => i.emailVerified && sameEmail(i.email, identity.email)))
          : undefined);

      let changed = false;
      if (!account) {
        account = {
          id: newId(),
          email: identity.email ?? "",
          name: profile.name?.trim() || identity.email?.split("@")[0] || "New user",
          created: toIso(new Date()),
          identities: [identity],
        };
        changed = true;
      } else if (!account.identities.some((i) => i.provider === identity.provider && i.subject === identity.subject)) {
        account.identities.push(identity);
        changed = true;
      }
      if (changed) {
        await writeAtomicFile(path.join(this.repo.dir, accountPath(account.id)), serializeAccount(account));
        this.byId.set(account.id, account);
      }
      if (this.isOwner(account)) await this.adoptLegacyContent(account);
      return account;
    });
  }

  /**
   * The single-user version kept content at the repository root. The first
   * time the owner signs in, move it into their folder.
   * Must run inside lock.exclusive().
   */
  private async adoptLegacyContent(owner: Account): Promise<void> {
    const target = path.join(this.repo.dir, USERS_DIR, owner.id);
    const legacy: string[] = [];
    for (const p of LEGACY_PATHS) {
      if (await fs.stat(path.join(this.repo.dir, p)).catch(() => null)) legacy.push(p);
    }
    if (!legacy.length) return;
    if (await fs.stat(path.join(target, "settings.md")).catch(() => null)) return; // already has a workspace
    await fs.mkdir(target, { recursive: true });
    for (const p of legacy) await fs.rename(path.join(this.repo.dir, p), path.join(target, p));
  }
}
