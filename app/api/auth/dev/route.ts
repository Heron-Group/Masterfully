import { NextResponse, type NextRequest } from "next/server";
import { signInWith } from "@/lib/auth";
import { devLoginEnabled, safeNext } from "@/lib/auth/redirects";

/**
 * Development and tests only (AUTH_DEV_LOGIN=1, never in production): sign
 * in as any email address, to try the app as several users without Google
 * or Microsoft credentials. /api/auth/dev?email=a@example.com&name=A
 */
export async function GET(request: NextRequest) {
  if (!devLoginEnabled()) return new Response("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return new Response("Pass ?email=", { status: 400 });
  await signInWith({ provider: "dev", subject: email, email, emailVerified: true }, { name: params.get("name") ?? undefined });
  return NextResponse.redirect(new URL(safeNext(params.get("next")), request.url));
}
