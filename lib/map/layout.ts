import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { USERS_DIR } from "../accounts";
import { serverConfig } from "../config";
import { writeAtomicFile } from "../content/atomic";

/**
 * The Source Map's own data, per user in users/<id>/map-layout.json: group
 * colours, the last view used, and (later) pinned node positions per view.
 * It's the user's own work, so it's included in "Download your data". The
 * map itself is never stored; it's rebuilt from sources and groups.
 */

export const MAP_LAYOUT_FILE = "map-layout.json";

export type MapView = "network" | "groups";

export type MapLayout = {
  version: 1;
  colours: Record<string, string>;
  lastView?: MapView;
  /** Pinned positions, per view, by node id. */
  pins?: Partial<Record<MapView, Record<string, { x: number; y: number }>>>;
};

const empty = (): MapLayout => ({ version: 1, colours: {} });

function fileFor(userId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Invalid user id");
  return path.join(serverConfig().contentDir, USERS_DIR, userId, MAP_LAYOUT_FILE);
}

export async function readMapLayout(userId: string): Promise<MapLayout> {
  const raw = await fs.readFile(fileFor(userId), "utf8").catch(() => null);
  if (!raw) return empty();
  try {
    const data = JSON.parse(raw) as Partial<MapLayout>;
    return { ...empty(), ...data, colours: { ...(data.colours ?? {}) } };
  } catch {
    return empty();
  }
}

// One write at a time per user.
const queues = new Map<string, Promise<unknown>>();

/** Change the layout file; `change` gets the current contents and edits them in place. */
export function updateMapLayout(userId: string, change: (layout: MapLayout) => void): Promise<MapLayout> {
  const run = (queues.get(userId) ?? Promise.resolve()).then(async () => {
    const layout = await readMapLayout(userId);
    change(layout);
    await writeAtomicFile(fileFor(userId), JSON.stringify(layout, null, 2));
    return layout;
  });
  queues.set(
    userId,
    run.catch(() => {}),
  );
  return run;
}
