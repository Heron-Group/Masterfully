import "server-only";
import { serverConfig } from "../config";
import { ContentStore } from "./store";

export { ContentError } from "./ids";
export type { SyncStatus } from "./git";
export type * from "./schemas";
export type { StagedFile } from "./store";

// One store per process, kept on globalThis so dev-mode hot reloads reuse it
// instead of starting a second Git push timer.
const globalStore = globalThis as unknown as {
  __researchPortalStore?: Promise<ContentStore>;
};

/** The content store, initialised on first use (repo prepared, index built). */
export function getContentStore(): Promise<ContentStore> {
  if (!globalStore.__researchPortalStore) {
    const config = serverConfig();
    const store = new ContentStore({ dir: config.contentDir, ...config.git });
    globalStore.__researchPortalStore = store.init().then(
      () => store,
      (err) => {
        globalStore.__researchPortalStore = undefined;
        throw err;
      },
    );
  }
  return globalStore.__researchPortalStore;
}
