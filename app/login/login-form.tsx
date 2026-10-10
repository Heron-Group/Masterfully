"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "./actions";

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was interrupted. Please try again.",
  failed: "Sign-in didn't work. Please try again.",
  provider: "The sign-in provider returned an error. Please try again.",
  unavailable: "That sign-in option isn't set up on this server.",
};

const providerButton =
  "flex w-full items-center justify-center gap-2.5 rounded-md bg-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-sm shadow-black/5 ring-1 ring-rule transition-colors hover:bg-accent-soft/60";

export function SignInOptions({
  providers,
  password,
  dev,
}: {
  providers: ("google" | "microsoft")[];
  password: boolean;
  dev: boolean;
}) {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const error = params.get("error");
  const [showPassword, setShowPassword] = useState(!providers.length);
  const q = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {ERRORS[error] ?? ERRORS.failed}
        </p>
      )}
      {providers.includes("google") && (
        <a href={`/api/auth/google${q}`} className={providerButton}>
          <GoogleLogo /> Continue with Google
        </a>
      )}
      {providers.includes("microsoft") && (
        <a href={`/api/auth/microsoft${q}`} className={providerButton}>
          <MicrosoftLogo /> Continue with Microsoft
        </a>
      )}
      {providers.length > 0 && (
        <p className="pt-1 text-center text-xs text-faint">New here? Signing in creates your own private workspace.</p>
      )}

      {password &&
        (showPassword ? (
          <div className={providers.length ? "border-t border-rule pt-5" : ""}>
            <PasswordForm next={next} />
          </div>
        ) : (
          <div className="pt-4 text-center">
            <button type="button" onClick={() => setShowPassword(true)} className="text-xs text-muted hover:text-ink">
              Sign in with a password
            </button>
          </div>
        ))}

      {dev && <DevForm next={next} />}

      {!providers.length && !password && !dev && (
        <p className="text-center text-sm text-muted">
          No sign-in method is set up yet. Add Google or Microsoft credentials to the server (see the README).
        </p>
      )}
    </div>
  );
}

function PasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="sr-only">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "login-error" : undefined}
          className="w-full rounded-md border border-rule bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </label>
      {state.error && (
        <p id="login-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-ink px-3.5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/** Development only (AUTH_DEV_LOGIN=1): sign in as any email address. */
function DevForm({ next }: { next: string }) {
  return (
    <form action="/api/auth/dev" method="get" className="space-y-2 border-t border-dashed border-rule pt-5">
      <input type="hidden" name="next" value={next} />
      <p className="text-xs text-faint">Development sign-in (AUTH_DEV_LOGIN=1)</p>
      <div className="flex gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="someone@example.com"
          aria-label="Development sign-in email"
          className="min-w-0 flex-1 rounded-md border border-rule bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button type="submit" className="rounded-md px-3 py-1.5 text-sm text-muted ring-1 ring-rule hover:text-ink">
          Go
        </button>
      </div>
    </form>
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
