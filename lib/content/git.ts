import { promises as fs } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { simpleGit, type SimpleGit } from "simple-git";
import { errorMessage } from "./frontmatter";

export type SyncState = "synced" | "pending" | "syncing" | "error" | "local";

export type SyncStatus = {
  state: SyncState;
  /** Commits not yet on the remote. */
  ahead: number;
  lastSyncedAt?: string;
  error?: string;
  /** Files in conflict when a rebase onto the remote failed. */
  conflicts?: string[];
};

export type GitOptions = {
  dir: string;
  remote?: string;
  branch: string;
  sshKeyPath?: string;
  pushDelayMs: number;
  authorName: string;
  authorEmail: string;
  /** Called after a pull brings in commits, so the index can rescan. */
  onRemoteChange?: () => void;
};

/**
 * Owns the content repository: one commit per write, and a debounced push to
 * GitHub. All Git work runs through `exclusive()`, which serialises it within
 * this process and takes a file lock as a safeguard against a second process.
 */
export class GitSync {
  private client: SimpleGit | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pushTimer: NodeJS.Timeout | null = null;
  private status: SyncStatus;

  constructor(private readonly opts: GitOptions) {
    this.status = { state: opts.remote ? "synced" : "local", ahead: 0 };
  }

  /** Created on first use: simple-git requires the folder to exist already. */
  private get git(): SimpleGit {
    this.client ??= this.makeGit(this.opts.dir);
    return this.client;
  }

  private makeGit(baseDir: string): SimpleGit {
    const git = simpleGit({
      baseDir,
      // GIT_SSH_COMMAND comes from server config (the deploy key path), not user input.
      unsafe: { allowUnsafeSshCommand: true },
      allowEnvironment: ["GIT_TERMINAL_PROMPT"],
    });
    // Pass Git a minimal environment: inherited variables such as GIT_EDITOR
    // or GIT_ASKPASS (set by IDEs) are rejected by simple-git and not needed.
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
    for (const key of ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "SystemRoot"]) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    if (this.opts.sshKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${shellQuote(this.opts.sshKeyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
    }
    return git.env(env);
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /** Run `fn` with exclusive access to the repository. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const release = await lockfile.lock(this.opts.dir, {
        lockfilePath: path.join(this.opts.dir, ".git", "research-portal.lock"),
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

  /**
   * Prepare the content folder. An empty or missing folder is cloned from the
   * remote when one is configured, otherwise initialised as a new repo. An
   * existing folder is used as it is.
   */
  async ensureRepo(): Promise<void> {
    const { dir, remote, branch } = this.opts;
    await fs.mkdir(dir, { recursive: true });
    const entries = (await fs.readdir(dir)).filter((e) => e !== ".DS_Store");

    if (entries.length === 0 && remote) {
      await this.makeGit(path.dirname(dir)).clone(remote, dir);
      // A brand-new GitHub repo clones with no commits; give it a branch.
      const log = await this.git.raw(["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "");
      if (!log.trim()) await this.git.raw(["checkout", "-B", branch]);
    } else if (!entries.includes(".git")) {
      await this.git.init(["--initial-branch", branch]);
    }

    await this.git.addConfig("user.name", this.opts.authorName);
    await this.git.addConfig("user.email", this.opts.authorEmail);
    // Keep filenames with non-ASCII characters readable in git output.
    await this.git.addConfig("core.quotepath", "false");

    if (remote) {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin");
      if (!origin) await this.git.addRemote("origin", remote);
      else if (origin.refs.push !== remote) await this.git.remote(["set-url", "origin", remote]);
    }

    // Files that were already in the folder (or edited while the app was
    // down) are committed so nothing sits outside version control.
    await this.exclusive(() => this.commitOutsideChanges());
    // Push anything left unpushed when the app last stopped (for example if
    // Passenger shut it down before the debounced push ran).
    if (remote) this.schedulePush();
  }

  /**
   * Stage the given paths (relative to the content root) and commit them.
   * Paths that no longer exist are staged as deletions. Returns false if
   * there was nothing to commit. Must be called inside `exclusive()`.
   */
  async commitPaths(paths: string[], message: string): Promise<boolean> {
    for (const p of paths) {
      const exists = await fs
        .stat(path.join(this.opts.dir, p))
        .then(() => true)
        .catch(() => false);
      if (exists) await this.git.raw(["add", "-A", "--", p]);
      else await this.git.raw(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", p]);
    }
    const staged = await this.git.diff(["--cached", "--name-only"]);
    if (!staged.trim()) return false;
    await this.git.commit(message);
    this.schedulePush();
    return true;
  }

  /** Restore paths to their last committed state. Must be called inside `exclusive()`. */
  async restoreFromHead(paths: string[]): Promise<void> {
    for (const p of paths) {
      await this.git.raw(["checkout", "HEAD", "--", p]).catch(() => {});
    }
  }

  /** Undo `git add` for paths after a failed commit. Must be called inside `exclusive()`. */
  async unstage(paths: string[]): Promise<void> {
    if (!paths.length) return;
    await this.git.raw(["reset", "-q", "--", ...paths]).catch(() => {});
  }

  private async commitOutsideChanges(): Promise<boolean> {
    const status = await this.git.status();
    if (status.isClean()) return false;
    await this.git.raw(["add", "-A"]);
    await this.git.commit("sync: commit changes made outside the app");
    this.schedulePush();
    return true;
  }

  schedulePush(): void {
    if (!this.opts.remote) return;
    if (this.status.state !== "syncing") {
      this.status = { ...this.status, state: "pending", error: undefined, conflicts: undefined };
    }
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.sync();
    }, this.opts.pushDelayMs);
  }

  /**
   * Pull remote changes (rebasing local commits on top) and push. A rebase
   * conflict is aborted, leaving local files exactly as they were, and
   * reported in the status instead of being resolved automatically.
   */
  async sync(): Promise<SyncStatus> {
    if (!this.opts.remote) {
      this.status = { state: "local", ahead: 0 };
      return this.getStatus();
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.status = { ...this.status, state: "syncing" };
    try {
      await this.exclusive(async () => {
        await this.commitOutsideChanges();
        const { branch } = this.opts;
        await this.git.fetch("origin");
        const remoteHasBranch = !!(
          await this.git.raw(["ls-remote", "--heads", "origin", branch])
        ).trim();

        if (remoteHasBranch) {
          const before = await this.git.revparse(["HEAD"]).catch(() => "");
          try {
            await this.git.raw(["rebase", `origin/${branch}`]);
          } catch (err) {
            const conflicts = (await this.git.diff(["--name-only", "--diff-filter=U"]))
              .split("\n")
              .filter(Boolean);
            await this.git.raw(["rebase", "--abort"]).catch(() => {});
            throw new ConflictError(errorMessage(err), conflicts);
          }
          const after = await this.git.revparse(["HEAD"]).catch(() => "");
          if (before !== after) this.opts.onRemoteChange?.();
        }

        await this.git.push("origin", `HEAD:refs/heads/${branch}`, ["--set-upstream"]);
      });
      this.status = { state: "synced", ahead: 0, lastSyncedAt: new Date().toISOString() };
    } catch (err) {
      this.status = {
        ...this.status,
        state: "error",
        error:
          err instanceof ConflictError
            ? `Your changes conflict with changes on GitHub. Nothing was overwritten; resolve the conflict in the content repository, then sync again.`
            : redact(errorMessage(err)),
        conflicts: err instanceof ConflictError ? err.conflicts : undefined,
      };
    }
    this.status.ahead = await this.countAhead();
    if (this.status.state === "synced" && this.status.ahead > 0) this.status.state = "pending";
    return this.getStatus();
  }

  private async countAhead(): Promise<number> {
    try {
      const out = await this.git.raw(["rev-list", "--count", `origin/${this.opts.branch}..HEAD`]);
      return Number(out.trim()) || 0;
    } catch {
      return 0;
    }
  }

  async headCommit(): Promise<string | null> {
    return this.git.revparse(["HEAD"]).catch(() => null);
  }

  /** Number of commits on the current branch (used by tests). */
  async commitCount(): Promise<number> {
    const out = await this.git.raw(["rev-list", "--count", "HEAD"]).catch(() => "0");
    return Number(out.trim()) || 0;
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }
}

class ConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: string[],
  ) {
    super(message);
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Strip credentials that may appear in remote URLs from error messages. */
function redact(message: string): string {
  return message.replace(/(https?:\/\/)[^@\s/]+@/g, "$1***@");
}
