import { Download } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeSetting } from "@/components/theme-setting";
import { ui } from "@/components/ui";
import { getUsage } from "@/lib/ai/usage";
import { getAiSettings } from "@/lib/ai/user-config";
import { requireSession } from "@/lib/auth";
import { getWorkspaceStore } from "@/lib/content";
import { AiSettings } from "./ai-settings";
import { ResearchContextEditor } from "./research-context-editor";

// The settings sections, shared by the settings window (opened from the
// sidebar) and the /settings page. `heading` is false in the window, which
// shows the section's name itself.

type Props = { heading?: boolean };

function Heading({ id, show, children }: { id: string; show: boolean; children: string }) {
  return (
    <h2 id={id} className={show ? `${ui.h2} mb-3` : "sr-only"}>
      {children}
    </h2>
  );
}

// Password sign-in was removed; old accounts may still list it, so it is not shown.
const SIGN_IN_LABELS: Record<string, string> = { google: "Google", microsoft: "Microsoft", dev: "Development sign-in" };

export async function AccountSection({ heading = true }: Props) {
  const account = await requireSession();
  const methods = [...new Set(account.identities.flatMap((i) => SIGN_IN_LABELS[i.provider] ?? []))];
  return (
    <section aria-labelledby="account-heading">
      <Heading id="account-heading" show={heading}>
        Account
      </Heading>
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
  );
}

export function AppearanceSection({ heading = true }: Props) {
  return (
    <section aria-labelledby="appearance-heading">
      <Heading id="appearance-heading" show={heading}>
        Appearance
      </Heading>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Colour mode for this browser.
      </p>
      <ThemeSetting />
    </section>
  );
}

export async function AiSection({ heading = true }: Props) {
  const account = await requireSession();
  const [ai, usage] = await Promise.all([getAiSettings(account.id), getUsage(account.id)]);
  return (
    <section id="ai" aria-labelledby="ai-heading" className="scroll-mt-8">
      <Heading id="ai-heading" show={heading}>
        AI summaries
      </Heading>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Summaries are written by Claude or OpenAI using your own API key. The key is stored on the server,
        never in your notes, and only used when you ask for a summary.
      </p>
      <AiSettings initial={ai} usage={usage} />
    </section>
  );
}

export async function ResearchSection({ heading = true }: Props) {
  const account = await requireSession();
  const { researchContext } = await (await getWorkspaceStore(account)).getSettings();
  return (
    <section aria-labelledby="research-heading">
      <Heading id="research-heading" show={heading}>
        Research context
      </Heading>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Your research question and focus, in a few sentences. Every AI summary is written with this in mind, so it can
        say how a source relates to your work.
      </p>
      <ResearchContextEditor initial={researchContext} />
    </section>
  );
}

export function DataSection({ heading = true }: Props) {
  return (
    <section aria-labelledby="data-heading">
      <Heading id="data-heading" show={heading}>
        Your data
      </Heading>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Download everything you&apos;ve created (journal entries, notes, sources, reading groups and their attached
        files) as a zip of Markdown files you can open in any text editor. Your API key isn&apos;t included.
      </p>
      <a href="/api/export" download className={ui.btnSoft}>
        <Download size={15} strokeWidth={1.8} aria-hidden="true" />
        Download your data
      </a>
    </section>
  );
}
