import { NextResponse, type NextRequest } from "next/server";
import { callbackUrl, enabledProviders, startAuthorization, type ProviderId } from "@/lib/auth/oauth";
import { OAUTH_COOKIE, safeNext } from "@/lib/auth/redirects";

/** Start Google or Microsoft sign-in: remember the PKCE verifier and send the browser to the provider. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/auth/[provider]">) {
  const { provider } = await ctx.params;
  if (!enabledProviders().includes(provider as ProviderId)) {
    return NextResponse.redirect(new URL("/login?error=unavailable", request.url));
  }
  const { url, state, verifier } = startAuthorization(provider as ProviderId, callbackUrl(provider as ProviderId, request.url));
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, JSON.stringify({ provider, state, verifier, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 10 * 60,
  });
  return response;
}
