import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionKeysFromEnv, verifySessionToken } from "@/lib/auth/session";

/**
 * First line of defence: nothing is reachable without a valid session
 * cookie. Pages, actions and route handlers check the session again
 * themselves (see lib/auth), so this is not the only check.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(sessionKeysFromEnv(), token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except build assets and the public icons. Upload routes
    // (/api/upload/...) are excluded too: proxy buffers request bodies and
    // truncates them at 10 MB, so those handlers check the session
    // themselves before reading the body.
    "/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|api/upload/).*)",
  ],
};
