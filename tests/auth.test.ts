import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/auth/session";

const keys = { secret: "s".repeat(40) };

describe("session tokens", () => {
  it("carries the user id and rejects tampering", async () => {
    const { token } = await createSessionToken(keys, "u0123456789");
    expect(await verifySessionToken(keys, token)).toBe("u0123456789");
    const [v, user, exp, sig] = token.split(".");
    expect(await verifySessionToken(keys, `${v}.${user}.${Number(exp) + 1000}.${sig}`)).toBeNull();
    expect(await verifySessionToken(keys, `${v}.uother.${exp}.${sig}`)).toBeNull();
    expect(await verifySessionToken(keys, `${token}x`)).toBeNull();
    expect(await verifySessionToken(keys, undefined)).toBeNull();
    expect(await verifySessionToken(null, token)).toBeNull();
  });

  it("rejects old single-user tokens and odd user ids", async () => {
    expect(await verifySessionToken(keys, "v1.123.abc")).toBeNull();
    await expect(createSessionToken(keys, "a.b")).rejects.toThrow();
  });

  it("expires after 30 days", async () => {
    const now = Date.UTC(2026, 9, 9);
    const { token } = await createSessionToken(keys, "u1", now);
    const later = now + SESSION_MAX_AGE_SECONDS * 1000;
    expect(await verifySessionToken(keys, token, later - 1)).toBe("u1");
    expect(await verifySessionToken(keys, token, later)).toBeNull();
  });

  it("is invalidated by changing the secret", async () => {
    const { token } = await createSessionToken(keys, "u1");
    expect(await verifySessionToken({ secret: "t".repeat(40) }, token)).toBeNull();
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
