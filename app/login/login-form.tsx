"use client";

import { useSearchParams } from "next/navigation";

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was interrupted. Please try again.",
  failed: "Sign-in didn't work. Please try again.",
  provider: "The sign-in provider returned an error. Please try again.",
  unavailable: "That sign-in option isn't set up on this server.",
};

const providerButton =
  "flex w-full items-center justify-center gap-2.5 rounded-md bg-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-sm shadow-black/5 ring-1 ring-rule transition-colors hover:bg-accent-soft/60";

/** Google and Microsoft are the only ways to sign in or sign up. */
export function SignInOptions({ configured }: { configured: ("google" | "microsoft")[] }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const error = params.get("error");
  const q = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {ERRORS[error] ?? ERRORS.failed}
        </p>
      )}
      <a href={`/api/auth/google${q}`} className={providerButton}>
        <GoogleLogo /> Continue with Google
      </a>
      <a href={`/api/auth/microsoft${q}`} className={providerButton}>
        <MicrosoftLogo /> Continue with Microsoft
      </a>
      <p className="pt-1 text-center text-xs text-faint">New here? Signing in creates your own private workspace.</p>
      {!configured.length && (
        <p className="text-center text-xs text-warn">
          Sign-in isn&apos;t set up on this server yet: add the Google and Microsoft credentials (see the README).
        </p>
      )}
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
