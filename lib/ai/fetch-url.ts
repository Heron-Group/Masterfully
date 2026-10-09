import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MIN_READABLE_CHARS = 600;

export type FetchedPage =
  | { ok: true; kind: "html"; text: string; title?: string }
  | { ok: true; kind: "pdf"; data: Buffer }
  | { ok: false; reason: string };

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http and https links can be read");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("the address points to a private network");
  }
}

/**
 * Fetch a source's link and extract its readable text (or PDF bytes).
 * Refuses private addresses, follows at most 5 redirects, gives up after 20
 * seconds or 8 MB, and treats near-empty pages as unavailable (paywalls,
 * logins and script-only pages).
 */
export async function fetchReadable(rawUrl: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "the link isn't a valid URL" };
  }
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 6; hop++) {
      await assertPublicHost(url);
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0 (research reading list; summary fetch)",
          Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      break;
    }
    if (!res) return { ok: false, reason: "no response" };
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      return { ok: false, reason: `the site refused access (HTTP ${res.status}); it may need a login or subscription` };
    }
    if (!res.ok) return { ok: false, reason: `the site returned HTTP ${res.status}` };

    const body = await readLimited(res);
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/pdf") || body.subarray(0, 5).toString() === "%PDF-") {
      return { ok: true, kind: "pdf", data: body };
    }
    const raw = body.toString("utf8");
    if (type.includes("text/plain")) return checkLength({ ok: true, kind: "html", text: raw.trim() });

    const { document } = parseHTML(raw);
    const article = new Readability(document as unknown as Document).parse();
    const text = (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    return checkLength({ ok: true, kind: "html", text, title: article?.title ?? undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: /timeout|aborted/i.test(message) ? "the site took too long to respond" : message };
  }
}

function checkLength(page: FetchedPage): FetchedPage {
  if (page.ok && page.kind === "html" && page.text.length < MIN_READABLE_CHARS) {
    return { ok: false, reason: "the page has almost no readable text; it may be behind a paywall or login" };
  }
  return page;
}

async function readLimited(res: Response): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("the page is larger than 8 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
