import { describe, expect, it } from "vitest";
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
