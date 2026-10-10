import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { passwordLoginEnabled } from "@/lib/auth";
import { enabledProviders } from "@/lib/auth/oauth";
import { devLoginEnabled } from "@/lib/auth/redirects";
import { SignInOptions } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <h1 className="mb-2 text-center font-serif text-3xl tracking-tight">Research</h1>
        <p className="mb-8 text-center text-sm text-muted">A journal and reading list for your research.</p>
        <Suspense>
          <Options />
        </Suspense>
      </div>
    </main>
  );
}

/** Read at request time, so the options follow the server's environment rather than the build's. */
async function Options() {
  await connection();
  return <SignInOptions providers={enabledProviders()} password={passwordLoginEnabled()} dev={devLoginEnabled()} />;
}
