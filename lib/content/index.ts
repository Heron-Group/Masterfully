import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Accounts, USERS_DIR, type Account } from "../accounts";
import { serverConfig } from "../config";
import { ContentError } from "./ids";
import { ContentLock } from "./lock";
import { migrateToUserFolders } from "./migrate";
import { ContentStore } from "./store";

export { ContentError } from "./ids";
export type * from "./schemas";
export type { StagedFile } from "./store";

/**
 * The content folder holds one folder per user, users/<id>/, with
 * everything about them: account, encrypted AI key and content. Each
 * signed-in user only ever gets a store rooted at their own folder.
 */

type Shared = {
  repo: Promise<{ dir: string; accounts: Accounts }>;
  stores: Map<string, Promise<ContentStore>>;
};

// Kept on globalThis so dev-mode hot reloads reuse one set of stores and locks.
const g = globalThis as unknown as { __researchPortal?: Shared };

async function openRepo() {
  const config = serverConfig();
  const dir = config.contentDir;
  await fs.mkdir(path.join(dir, USERS_DIR), { recursive: true });
  const moved = await migrateToUserFolders(dir, config.legacySecretsDir);
  if (moved.length) console.log(`[content] moved into user folders:\n  ${moved.join("\n  ")}`);
  return { dir, accounts: new Accounts({ dir, lock: new ContentLock(dir) }, config.ownerEmail) };
}

function shared(): Shared {
  if (!g.__researchPortal) {
    const repo = openRepo();
    g.__researchPortal = { repo, stores: new Map() };
    repo.catch(() => {
      g.__researchPortal = undefined; // retry on next use
    });
  }
  return g.__researchPortal;
}

/** The content folder and its accounts. */
export function getRepo() {
  return shared().repo;
}

export async function getAccounts(): Promise<Accounts> {
  return (await getRepo()).accounts;
}

/** The private workspace store for one account. */
export function getWorkspaceStore(account: Account): Promise<ContentStore> {
  const s = shared();
  let store = s.stores.get(account.id);
  if (!store) {
    store = (async () => {
      const { dir } = await s.repo;
      const ws = new ContentStore({ dir: path.join(dir, USERS_DIR, account.id) });
      await ws.init();
      return ws;
    })();
    s.stores.set(account.id, store);
    store.catch(() => s.stores.delete(account.id));
  }
  return store;
}

/**
 * The signed-in user's workspace. Every page, action and route goes through
 * this, so one user can never reach another's files.
 */
export async function getContentStore(): Promise<ContentStore> {
  const { currentAccount } = await import("../auth");
  const account = await currentAccount();
  if (!account) throw new ContentError("Not signed in", 401);
  return getWorkspaceStore(account);
}
