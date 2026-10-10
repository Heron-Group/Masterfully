import { Download } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ui } from "@/components/ui";
import { getAiSettings } from "@/lib/ai/user-config";
import { requireSession } from "@/lib/auth";
import { AiSettings } from "./ai-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className={ui.page}>
      <h1 className={`${ui.h1} mb-10`}>Settings</h1>
      <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}

// Password sign-in was removed; old accounts may still list it, so it is not shown.
const SIGN_IN_LABELS: Record<string, string> = { google: "Google", microsoft: "Microsoft", dev: "Development sign-in" };

async function SettingsContent() {
  const account = await requireSession();
  const ai = await getAiSettings(account.id);
  const methods = [...new Set(account.identities.flatMap((i) => SIGN_IN_LABELS[i.provider] ?? []))];
  return (
    <div className="space-y-12">
      <section aria-labelledby="account-heading">
        <h2 id="account-heading" className={`${ui.h2} mb-3`}>
          Account
        </h2>
        <dl className="grid max-w-xl grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Name</dt>
          <dd>{account.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="break-all">{account.email || "—"}</dd>
          <dt className="text-muted">Signs in with</dt>
          <dd>{methods.join(", ") || "—"}</dd>
        </dl>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </section>

      <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-8">
        <h2 id="ai-heading" className={`${ui.h2} mb-2`}>
          AI summaries
        </h2>
        <p className="mb-4 max-w-prose text-sm text-muted">
          Summaries are written by Claude or OpenAI using your own API key. The key is stored encrypted on the server,
          never in your notes or their backup, and only used when you ask for a summary.
        </p>
        <AiSettings initial={ai} />
      </section>

      <section aria-labelledby="data-heading">
        <h2 id="data-heading" className={`${ui.h2} mb-2`}>
          Your data
        </h2>
        <p className="mb-4 max-w-prose text-sm text-muted">
          Download everything you&apos;ve created (journal entries, notes, sources, reading groups and their attached
          files) as a zip of Markdown files you can open in any text editor. Your API key isn&apos;t included.
        </p>
        <a href="/api/export" download className={ui.btnSoft}>
          <Download size={15} strokeWidth={1.8} aria-hidden="true" />
          Download your data
        </a>
      </section>
    </div>
  );
}
