import { promises as fs } from "node:fs";
import path from "node:path";
import { ACCOUNT_FILE, AI_KEY_FILE, USERS_DIR } from "../accounts";

const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/**
 * Move data from the earlier layout into one folder per user, once:
 *
 *   accounts/<id>.md       → users/<id>/account.md
 *   <secrets>/ai/<id>.json → users/<id>/ai-key.json
 *
 * Safe to run on every start: anything already moved is skipped, and nothing
 * is overwritten. The old .git folder (version history from when content was
 * backed up with Git) is left alone; it can be deleted by hand.
 */
export async function migrateToUserFolders(contentDir: string, legacySecretsDir: string): Promise<string[]> {
  const moved: string[] = [];
  const users = path.join(contentDir, USERS_DIR);

  const accountsDir = path.join(contentDir, "accounts");
  for (const f of await fs.readdir(accountsDir).catch(() => [] as string[])) {
    if (!f.endsWith(".md")) continue;
    const id = f.slice(0, -3);
    const target = path.join(users, id, ACCOUNT_FILE);
    if (await exists(target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(path.join(accountsDir, f), target);
    moved.push(`accounts/${f} → users/${id}/${ACCOUNT_FILE}`);
  }
  await fs.rmdir(accountsDir).catch(() => {}); // only if now empty

  const keysDir = path.join(legacySecretsDir, "ai");
  for (const f of await fs.readdir(keysDir).catch(() => [] as string[])) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -5);
    if (!(await exists(path.join(users, id)))) continue; // no such user here
    const target = path.join(users, id, AI_KEY_FILE);
    if (await exists(target)) continue;
    await fs.copyFile(path.join(keysDir, f), target);
    await fs.chmod(target, 0o600);
    await fs.rm(path.join(keysDir, f));
    moved.push(`${path.join(keysDir, f)} → users/${id}/${AI_KEY_FILE}`);
  }
  await fs.rmdir(keysDir).catch(() => {});
  await fs.rmdir(legacySecretsDir).catch(() => {});

  return moved;
}
