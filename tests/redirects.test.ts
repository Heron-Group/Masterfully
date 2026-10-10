import { afterEach, describe, expect, it } from "vitest";
import { publicUrl, safeNext } from "@/lib/auth/redirects";

const internal = (headers: Record<string, string> = {}) => new Request("http://0.0.0.0:3000/api/auth/microsoft/callback", { headers });

describe("publicUrl", () => {
  afterEach(() => {
    delete process.env.APP_URL;
  });

  it("uses APP_URL, never the internal address behind Plesk", () => {
    process.env.APP_URL = "https://masterfully.co.uk/";
    expect(publicUrl("/journal", internal({ host: "0.0.0.0:3000" })).toString()).toBe("https://masterfully.co.uk/journal");
  });

  it("falls back to the host the visitor used", () => {
    expect(publicUrl("/journal", internal({ "x-forwarded-host": "masterfully.co.uk", "x-forwarded-proto": "https" })).toString()).toBe(
      "https://masterfully.co.uk/journal",
    );
    expect(publicUrl("/login?error=x", internal({ host: "localhost:3000" })).toString()).toBe("http://localhost:3000/login?error=x");
  });

  it("only redirects within the site", () => {
    expect(safeNext("//evil.example")).toBe("/journal");
    expect(safeNext("/notes")).toBe("/notes");
  });
});
