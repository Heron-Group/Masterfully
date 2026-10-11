import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AI_USAGE_FILE, USERS_DIR } from "../accounts";
import { serverConfig } from "../config";
import { writeAtomicFile } from "../content/atomic";

/**
 * A record of what each user has used through Masterfully: summaries
 * (requests and tokens) and the natural reading voice (characters), per
 * month and model, in users/<id>/ai-usage.json. Prices change and differ
 * by account, so this counts usage; the provider's dashboard has the cost.
 */

export type Bucket = { requests: number; inputTokens: number; outputTokens: number; speechRequests: number; speechChars: number };
type UsageFile = { version: 1; months: Record<string, Record<string, Bucket>> };

export type UsageEntry =
  | { provider: string; model: string; inputTokens: number; outputTokens: number }
  | { provider: string; model: string; speechChars: number };

const empty = (): Bucket => ({ requests: 0, inputTokens: 0, outputTokens: 0, speechRequests: 0, speechChars: 0 });

function fileFor(userId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Invalid user id");
  return path.join(serverConfig().contentDir, USERS_DIR, userId, AI_USAGE_FILE);
}

async function read(userId: string): Promise<UsageFile> {
  const raw = await fs.readFile(fileFor(userId), "utf8").catch(() => null);
  try {
    const parsed = raw ? (JSON.parse(raw) as UsageFile) : null;
    return parsed?.months ? parsed : { version: 1, months: {} };
  } catch {
    return { version: 1, months: {} };
  }
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

// One write at a time per user, so concurrent summaries don't lose counts.
const queues = new Map<string, Promise<unknown>>();

/** Add to this month's usage. Never throws: usage is a convenience, not a reason to fail a summary. */
export function recordUsage(userId: string | undefined, entry: UsageEntry): Promise<void> {
  if (!userId) return Promise.resolve();
  const run = (queues.get(userId) ?? Promise.resolve()).then(async () => {
    const data = await read(userId);
    const key = `${entry.provider}:${entry.model}`;
    const months = (data.months[month()] ??= {});
    const b = (months[key] ??= empty());
    if ("speechChars" in entry) {
      b.speechRequests += 1;
      b.speechChars += entry.speechChars;
    } else {
      b.requests += 1;
      b.inputTokens += entry.inputTokens;
      b.outputTokens += entry.outputTokens;
    }
    await writeAtomicFile(fileFor(userId), JSON.stringify(data, null, 2));
  });
  const settled = run.catch((err) => console.error("[usage] couldn't record usage:", err));
  queues.set(userId, settled);
  return settled;
}

export type UsageTotals = Bucket;
export type UsageSummary = {
  thisMonth: UsageTotals;
  lastMonth: UsageTotals;
  allTime: UsageTotals;
  /** This month, by provider and model, busiest first. */
  byModel: Array<{ provider: string; model: string } & UsageTotals>;
};

function add(into: Bucket, b: Bucket) {
  into.requests += b.requests;
  into.inputTokens += b.inputTokens;
  into.outputTokens += b.outputTokens;
  into.speechRequests += b.speechRequests;
  into.speechChars += b.speechChars;
}

export async function getUsage(userId: string, now = new Date()): Promise<UsageSummary> {
  const data = await read(userId);
  const thisKey = month(now);
  const lastKey = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const sum = (m?: Record<string, Bucket>) => {
    const total = empty();
    for (const b of Object.values(m ?? {})) add(total, b);
    return total;
  };
  const allTime = empty();
  for (const m of Object.values(data.months)) add(allTime, sum(m));
  const byModel = Object.entries(data.months[thisKey] ?? {})
    .map(([key, b]) => {
      const [provider, ...rest] = key.split(":");
      return { provider, model: rest.join(":"), ...b };
    })
    .sort((a, b) => b.requests + b.speechRequests - (a.requests + a.speechRequests));
  return { thisMonth: sum(data.months[thisKey]), lastMonth: sum(data.months[lastKey]), allTime, byModel };
}
