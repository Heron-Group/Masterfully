import "server-only";
import { decodeIdToken, generateCodeVerifier, generateState, Google, MicrosoftEntraId } from "arctic";
import type { Identity } from "../accounts";
import { publicUrl } from "./redirects";

/**
 * Google and Microsoft sign-in (OAuth 2.0 with PKCE, OpenID Connect).
 * The ID token comes straight from the provider's token endpoint over TLS,
 * authenticated with our client secret, so its claims can be trusted.
 */

export type ProviderId = "google" | "microsoft";

// Personal Microsoft accounts all sign in through this tenant; their email
// addresses are verified by Microsoft. Work and school accounts may carry an
// unverified address, so those are never linked to others by email.
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export function enabledProviders(): ProviderId[] {
  const out: ProviderId[] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) out.push("google");
  if (process.env.AUTH_MICROSOFT_ID && process.env.AUTH_MICROSOFT_SECRET) out.push("microsoft");
  return out;
}

export function callbackUrl(provider: ProviderId, request: Request): string {
  return publicUrl(`/api/auth/${provider}/callback`, request).toString();
}

function client(provider: ProviderId, redirectUri: string) {
  if (provider === "google") {
    return new Google(process.env.AUTH_GOOGLE_ID!, process.env.AUTH_GOOGLE_SECRET!, redirectUri);
  }
  return new MicrosoftEntraId(
    process.env.AUTH_MICROSOFT_TENANT?.trim() || "common",
    process.env.AUTH_MICROSOFT_ID!,
    process.env.AUTH_MICROSOFT_SECRET!,
    redirectUri,
  );
}

const SCOPES = ["openid", "profile", "email"];

export function startAuthorization(provider: ProviderId, redirectUri: string) {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client(provider, redirectUri).createAuthorizationURL(state, verifier, SCOPES);
  if (provider === "google") url.searchParams.set("prompt", "select_account");
  return { url, state, verifier };
}

type Claims = Record<string, unknown>;

/** Exchange the code and read who signed in. */
export async function finishAuthorization(
  provider: ProviderId,
  redirectUri: string,
  code: string,
  verifier: string,
): Promise<{ identity: Identity; name?: string }> {
  const tokens = await client(provider, redirectUri).validateAuthorizationCode(code, verifier);
  const claims = decodeIdToken(tokens.idToken()) as Claims;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (provider === "google") {
    return {
      identity: {
        provider,
        subject: String(claims.sub),
        email: str(claims.email),
        emailVerified: claims.email_verified === true,
      },
      name: str(claims.name),
    };
  }
  const email = str(claims.email) ?? str(claims.preferred_username);
  return {
    identity: {
      provider,
      subject: String(claims.sub),
      email,
      emailVerified: !!email && claims.tid === MICROSOFT_CONSUMER_TENANT,
    },
    name: str(claims.name),
  };
}
