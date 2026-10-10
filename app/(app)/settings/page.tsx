import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ui } from "@/components/ui";
import { fakeAiEnabled } from "@/lib/ai/client";
import { getAiSettings } from "@/lib/ai/user-config";
import { requireSession } from "@/lib/auth";
import { getAccounts, getWorkspaceStore } from "@/lib/content";
import { serverConfig } from "@/lib/config";
import { AiSettings } from "./ai-settings";
import { ResearchContextEditor } from "./research-context-editor";

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

const SIGN_IN_LABELS = { google: "Google", microsoft: "Microsoft", password: "Password", dev: "Development sign-in" } as const;

async function SettingsContent() {
  const account = await requireSession();
  const store = await getWorkspaceStore(account);
  const [settings, ai, accounts] = await Promise.all([store.getSettings(), getAiSettings(account.id), getAccounts()]);
  const owner = accounts.isOwner(account);
  const config = serverConfig();
  const methods = [...new Set(account.identities.map((i) => SIGN_IN_LABELS[i.provider] ?? i.provider))];
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
          <dd>{methods.join(", ")}</dd>
        </dl>
        <div className="-ml-2.5 mt-3">
          <SignOutButton />
        </div>
      </section>

      <section aria-labelledby="context-heading">
        <h2 id="context-heading" className={`${ui.h2} mb-2`}>
          Research context
        </h2>
        <p className="mb-3 max-w-prose text-sm text-muted">
          Your current research question and focus, in a few sentences. Every AI summary is written with this in mind.
        </p>
        <ResearchContextEditor initial={settings.researchContext} />
      </section>

      <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-8">
        <h2 id="ai-heading" className={`${ui.h2} mb-2`}>
          AI summaries
        </h2>
        <p className="mb-4 max-w-prose text-sm text-muted">
          Summaries are written by Claude or OpenAI using your own API key. The key is stored encrypted on the server,
          never in your notes or their backup, and only used when you ask for a summary.
        </p>
        <AiSettings initial={ai} simulated={fakeAiEnabled()} />
      </section>

      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading" className={`${ui.h2} mb-3`}>
          Storage and backup
        </h2>
        <p className="max-w-prose text-sm text-muted">
          Your journal and reading list are saved as Markdown files in your own private folder and backed up with Git
          {config.git.remote ? " to a private GitHub repository" : ""}. Other users can&apos;t see them.
        </p>
        {owner && (
          <dl className="mt-3 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted">Your folder</dt>
            <dd className="break-all font-mono text-xs leading-5">{store.dir}</dd>
            <dt className="text-muted">GitHub remote</dt>
            <dd className="break-all font-mono text-xs leading-5">{config.git.remote ?? "None (local only)"}</dd>
            <dt className="text-muted">Push delay</dt>
            <dd>{Math.round(config.git.pushDelayMs / 1000)} seconds after the last change</dd>
            <dt className="text-muted">Accounts</dt>
            <dd>{(await accounts.list()).length}</dd>
          </dl>
        )}
      </section>
    </div>
  );
}
