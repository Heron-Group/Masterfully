import { NextResponse, type NextRequest } from "next/server";
import { signInWith } from "@/lib/auth";
import { callbackUrl, enabledProviders, finishAuthorization, type ProviderId } from "@/lib/auth/oauth";
import { OAUTH_COOKIE, safeNext } from "@/lib/auth/redirects";

type Pending = { provider: string; state: string; verifier: string; next: string };

/** The provider sends the browser back here with a code; exchange it and sign in. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/auth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return res;
  };

  let pending: Pending | null = null;
  try {
    pending = JSON.parse(request.cookies.get(OAUTH_COOKIE)?.value ?? "null") as Pending | null;
  } catch {
    pending = null;
  }
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "cancelled" : "provider");
  const code = params.get("code");
  if (
    !pending ||
    !code ||
    pending.provider !== provider ||
    pending.state !== params.get("state") ||
    !enabledProviders().includes(provider as ProviderId)
  ) {
    return fail("expired");
  }

  try {
    const { identity, name } = await finishAuthorization(
      provider as ProviderId,
      callbackUrl(provider as ProviderId, request.url),
      code,
      pending.verifier,
    );
    await signInWith(identity, { name });
  } catch (err) {
    console.error(`[auth] ${provider} sign-in failed:`, err);
    return fail("failed");
  }
  const res = NextResponse.redirect(new URL(safeNext(pending.next), request.url));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  return res;
}
