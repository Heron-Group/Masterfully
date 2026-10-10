import { promises as fs } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

/**
 * Serialises writes to one folder: in order within this process, and with a
 * file lock as a safeguard in case Passenger ever runs a second process.
 */
export class ContentLock {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  /** Run `fn` with exclusive access to the folder. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      const release = await lockfile.lock(this.dir, {
        lockfilePath: path.join(this.dir, ".lock"),
        realpath: false,
        stale: 60_000,
        retries: { retries: 20, minTimeout: 100, maxTimeout: 1000 },
      });
      try {
        return await fn();
      } finally {
        await release().catch(() => {});
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
