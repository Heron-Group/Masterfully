import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ui } from "@/components/ui";
import { aiConfigured, aiModel, fakeAiEnabled } from "@/lib/ai/client";
import { requireSession } from "@/lib/auth";
import { getContentStore } from "@/lib/content";
import { serverConfig } from "@/lib/config";
import { ResearchContextEditor } from "./research-context-editor";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className={ui.page}>
      <h1 className={`${ui.h1} mb-10`}>Settings</h1>
      <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
        <SettingsContent />
      </Suspense>
      <section className="mt-12 border-t border-rule pt-6">
        <SignOutButton />
      </section>
    </main>
  );
}

async function SettingsContent() {
  await requireSession();
  const store = await getContentStore();
  const settings = await store.getSettings();
  const config = serverConfig();
  return (
    <div className="space-y-12">
      <section aria-labelledby="context-heading">
        <h2 id="context-heading" className={`${ui.h2} mb-2`}>
          Research context
        </h2>
        <p className="mb-3 max-w-prose text-sm text-muted">
          Your current research question and focus, in a few sentences. Every AI summary is written with this in mind.
          Saved to <code className="text-xs">settings.md</code>.
        </p>
        <ResearchContextEditor initial={settings.researchContext} />
      </section>

      <section aria-labelledby="ai-heading">
        <h2 id="ai-heading" className={`${ui.h2} mb-3`}>
          AI summaries
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">Status</dt>
          <dd>
            {fakeAiEnabled()
              ? "Simulated (AI_FAKE=1, development only)"
              : aiConfigured()
                ? "Ready"
                : "Not configured: set ANTHROPIC_API_KEY on the server"}
          </dd>
          <dt className="text-muted">Model</dt>
          <dd className="font-mono text-xs leading-5">{aiModel()}</dd>
        </dl>
        <p className="mt-2 max-w-prose text-xs text-faint">
          Change the model with the ANTHROPIC_MODEL environment variable and restart the app. Prompts are in{" "}
          <code>lib/ai/prompts.ts</code>.
        </p>
      </section>

      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading" className={`${ui.h2} mb-3`}>
          Storage and backup
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">Content folder</dt>
          <dd className="break-all font-mono text-xs leading-5">{store.dir}</dd>
          <dt className="text-muted">GitHub remote</dt>
          <dd className="break-all font-mono text-xs leading-5">{config.git.remote ?? "None (local only)"}</dd>
          <dt className="text-muted">Push delay</dt>
          <dd>{Math.round(config.git.pushDelayMs / 1000)} seconds after the last change</dd>
        </dl>
      </section>
    </div>
  );
}
