/**
 * Fixed-window counter of failed login attempts per key (IP address).
 * In memory, which is fine because the app runs as a single process.
 */
export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** Milliseconds until the key may try again, or 0 if it is allowed now. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.maxFailures ? entry.resetAt - now : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    this.prune(now);
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    if (this.attempts.size < 1000) return;
    for (const [k, v] of this.attempts) if (v.resetAt <= now) this.attempts.delete(k);
  }
}
