import type { NextRequest } from "next/server";
import { fetchReadable, type FetchedPage } from "@/lib/ai/fetch-url";
import { requireApiSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";

/**
 * Reader view of a source's link, for the reading panel. Most sites refuse
 * to be embedded in a frame, so the article text is extracted (Readability)
 * and shown in a clean page instead.
 *
 * The HTML comes from a third-party site, so the response is locked down:
 * a sandbox with no scripts and no access to this origin, and a CSP that
 * only allows images and inline styles.
 */

const cache = new Map<string, { at: number; page: FetchedPage }>();
const CACHE_MS = 10 * 60 * 1000;

async function readable(url: string): Promise<FetchedPage> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;
  const page = await fetchReadable(url);
  if (page.ok) {
    cache.set(url, { at: Date.now(), page });
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return page;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(opts: { title: string; body: string; base?: string; dark: boolean }): Response {
  // Pure black or white, so the page stands apart from the app's own
  // off-white or near-black background around the panel.
  const c = opts.dark
    ? { paper: "#000000", ink: "#ebe6dd", muted: "#a29c91", rule: "#2d2b27", accent: "#a3b9dc", soft: "#232a35" }
    : { paper: "#ffffff", ink: "#1f1e1b", muted: "#6c675e", rule: "#e7e3da", accent: "#36557f", soft: "#e8edf4" };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.base ? `<base href="${escape(opts.base)}" target="_blank">` : ""}
<title>${escape(opts.title)}</title>
<style>
  html { background: ${c.paper}; color-scheme: ${opts.dark ? "dark" : "light"}; }
  body { margin: 0 auto; max-width: 40rem; padding: 2rem 1.5rem 4rem; color: ${c.ink};
    font: 1.0625rem/1.7 "Iowan Old Style", Georgia, "Times New Roman", serif; overflow-wrap: anywhere; }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .4rem; font-weight: 600; }
  .meta { color: ${c.muted}; font: .85rem/1.5 system-ui, sans-serif; margin-bottom: 2rem; }
  h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 .5em; }
  p, ul, ol, blockquote, pre, figure, table { margin: 0 0 1em; }
  a { color: ${c.accent}; }
  img, video { max-width: 100%; height: auto; border-radius: 4px; }
  figcaption { color: ${c.muted}; font-size: .85em; }
  blockquote { border-left: 2px solid ${c.rule}; padding-left: 1em; color: ${c.muted}; font-style: italic; }
  pre, code { font-family: ui-monospace, Menlo, monospace; font-size: .85em; background: ${c.soft}; border-radius: 4px; }
  pre { padding: .7em 1em; overflow-x: auto; }
  table { border-collapse: collapse; display: block; overflow-x: auto; font: .88rem/1.5 system-ui, sans-serif; }
  td, th { border: 1px solid ${c.rule}; padding: .35em .6em; }
  hr { border: 0; border-top: 1px solid ${c.rule}; }
  .notice { font: .95rem/1.6 system-ui, sans-serif; color: ${c.muted}; }
</style></head><body>${opts.body}</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/reader/[id]">) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  const dark = request.nextUrl.searchParams.get("theme") === "dark";
  const source = await (await getContentStore()).getSource(id);
  if (!source?.url) return page({ title: "Not found", body: `<p class="notice">This source has no link.</p>`, dark });

  const result = await readable(source.url);
  const original = `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">Open the original page ↗</a>`;
  if (!result.ok) {
    return page({
      title: source.title,
      dark,
      body: `<h1>${escape(source.title)}</h1><p class="notice">The reader view isn't available: ${escape(result.reason)}.</p><p class="notice">${original}</p>`,
    });
  }
  if (result.kind === "pdf") {
    return new Response(new Uint8Array(result.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const body = result.html ?? result.text.split(/\n{2,}/).map((p) => `<p>${escape(p)}</p>`).join("");
  return page({
    title: result.title ?? source.title,
    base: result.finalUrl ?? source.url,
    dark,
    body: `<h1>${escape(result.title ?? source.title)}</h1><p class="meta">${result.byline ? `${escape(result.byline)} · ` : ""}${original}</p>${body}`,
  });
}
