import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Accounts, USERS_DIR, type Account } from "../accounts";
import { serverConfig } from "../config";
import { ContentError } from "./ids";
import { GitSync } from "./git";
import { ContentStore } from "./store";

export { ContentError } from "./ids";
export type { SyncStatus } from "./git";
export type * from "./schemas";
export type { StagedFile } from "./store";

/**
 * One content repository holds everyone's content: accounts/<id>.md, and a
 * private workspace per user in users/<id>/. Each signed-in user only ever
 * gets a store rooted at their own workspace.
 */

type Shared = {
  repo: Promise<{ dir: string; git: GitSync; accounts: Accounts }>;
  stores: Map<string, Promise<ContentStore>>;
};

// Kept on globalThis so dev-mode hot reloads reuse one repo and push timer.
const g = globalThis as unknown as { __researchPortal?: Shared };

const GITIGNORE = `.DS_Store\nThumbs.db\n.obsidian/workspace*\n.trash/\n`;

async function openRepo() {
  const config = serverConfig();
  const dir = config.contentDir;
  const git = new GitSync({ dir, ...config.git });
  await git.ensureRepo();
  if (!(await fs.stat(path.join(dir, ".gitignore")).catch(() => null))) {
    await git.exclusive(async () => {
      await fs.writeFile(path.join(dir, ".gitignore"), GITIGNORE);
      await git.commitPaths([".gitignore"], "content: initialise repository");
    });
  }
  return { dir, git, accounts: new Accounts({ dir, git }, config.ownerEmail) };
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

/** The shared content repository (sync status, accounts). */
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
      const { dir, git } = await s.repo;
      const ws = new ContentStore({
        git,
        repoDir: dir,
        prefix: `${USERS_DIR}/${account.id}`,
        author: { name: account.name, email: account.email || `${account.id}@users.masterfully` },
      });
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
