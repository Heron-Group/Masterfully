import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/auth/session";

const keys = { secret: "s".repeat(40), passwordHash: "$2b$12$examplehash" };

describe("session tokens", () => {
  it("verifies a fresh token and rejects tampering", async () => {
    const { token } = await createSessionToken(keys);
    expect(await verifySessionToken(keys, token)).toBe(true);
    const [v, exp, sig] = token.split(".");
    expect(await verifySessionToken(keys, `${v}.${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(await verifySessionToken(keys, `${token}x`)).toBe(false);
    expect(await verifySessionToken(keys, undefined)).toBe(false);
    expect(await verifySessionToken(null, token)).toBe(false);
  });

  it("expires after 30 days", async () => {
    const now = Date.UTC(2026, 9, 9);
    const { token } = await createSessionToken(keys, now);
    const later = now + SESSION_MAX_AGE_SECONDS * 1000;
    expect(await verifySessionToken(keys, token, later - 1)).toBe(true);
    expect(await verifySessionToken(keys, token, later)).toBe(false);
  });

  it("is invalidated by changing the password or the secret", async () => {
    const { token } = await createSessionToken(keys);
    expect(await verifySessionToken({ ...keys, passwordHash: "$2b$12$other" }, token)).toBe(false);
    expect(await verifySessionToken({ ...keys, secret: "t".repeat(40) }, token)).toBe(false);
  });
});

describe("login rate limit", () => {
  it("blocks after 5 failures within 15 minutes, per IP", () => {
    const limiter = new LoginRateLimiter(5, 15 * 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(limiter.retryAfter("1.2.3.4", t)).toBe(0);
      limiter.recordFailure("1.2.3.4", t);
    }
    expect(limiter.retryAfter("1.2.3.4", t)).toBe(15 * 60_000);
    expect(limiter.retryAfter("5.6.7.8", t)).toBe(0);
    expect(limiter.retryAfter("1.2.3.4", t + 15 * 60_000)).toBe(0);
  });

  it("resets after a successful login", () => {
    const limiter = new LoginRateLimiter(2, 60_000);
    limiter.recordFailure("ip", 0);
    limiter.recordFailure("ip", 0);
    limiter.reset("ip");
    expect(limiter.retryAfter("ip", 1)).toBe(0);
  });
});
