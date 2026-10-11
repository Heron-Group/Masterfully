"use client";

import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ui } from "@/components/ui";
import type { UsageSummary, UsageTotals } from "@/lib/ai/usage";
import type { AiProvider, AiSettingsView } from "@/lib/ai/user-config";
import { listModels, saveAiSettings, type ModelOption } from "./actions";

const PROVIDERS: { id: AiProvider; label: string; keyUrl: string; keyPlaceholder: string }[] = [
  { id: "anthropic", label: "Claude", keyUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…" },
];

const DEFAULTS: Record<AiProvider, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.5" };

const OTHER = "__other";

export function AiSettings({ initial, usage }: { initial: AiSettingsView; usage: UsageSummary }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [shown, setShown] = useState<AiProvider>(initial.provider ?? "anthropic");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState(initial.models[shown]);
  const [lists, setLists] = useState<Partial<Record<AiProvider, { models: ModelOption[]; live: boolean }>>>({});
  const [typing, setTyping] = useState(false); // "Other…": type a model name
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const provider = PROVIDERS.find((p) => p.id === shown)!;
  const key = settings.keys[shown];

  // The provider's model list (with the saved key), refreshed when the key changes.
  const keyHint = key?.hint;
  useEffect(() => {
    let cancelled = false;
    void listModels(shown).then((list) => {
      if (!cancelled) setLists((l) => ({ ...l, [shown]: list }));
    });
    return () => {
      cancelled = true;
    };
  }, [shown, keyHint]);
  const list = lists[shown];
  const options = list ? [...list.models] : [];
  if (model && !options.some((o) => o.id === model)) options.unshift({ id: model, label: model });
  const active = settings.provider === shown && !!key?.readable;

  function save(update: { provider: AiProvider; model?: string; apiKey?: string }, done?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const r = await saveAiSettings(update);
      if (!r.ok) {
        setMessage({ kind: "error", text: r.error });
        return;
      }
      setSettings(r.settings);
      router.refresh(); // so the settings window shows this when reopened
      if (r.warning) setMessage({ kind: "info", text: r.warning });
      done?.();
    });
  }

  function choose(id: AiProvider) {
    if (id === shown && settings.provider === id) return;
    setShown(id);
    setModel(settings.models[id]);
    setTyping(false);
    setReplacing(false);
    setConfirmRemove(false);
    setKeyInput("");
    setMessage(null);
    save({ provider: id });
  }

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyInput.trim()) return;
    save({ provider: shown, apiKey: keyInput }, () => {
      setKeyInput("");
      setReplacing(false);
    });
  }

  function saveModel() {
    const value = model.trim() || DEFAULTS[shown];
    setModel(value);
    if (value !== settings.models[shown]) save({ provider: shown, model: value });
  }

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="AI provider" className="inline-flex rounded-lg bg-accent-soft/60 p-0.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={shown === p.id}
            onClick={() => choose(p.id)}
            className={`rounded-md px-3.5 py-1 text-sm transition-colors ${
              shown === p.id ? "bg-surface text-ink shadow-sm shadow-black/5" : "text-muted hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-5 text-sm">
        <div>
          <label htmlFor="ai-key" className={ui.label}>
            API key
          </label>
          {key && !replacing ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5 py-1">
                <KeyRound className="size-3.5 text-faint" aria-hidden />
                <span className="font-mono text-xs" data-testid="key-hint">
                  {key.hint}
                </span>
              </span>
              {confirmRemove ? (
                <span className="inline-flex items-center gap-1">
                  <span className="text-muted">Remove this key?</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => save({ provider: shown, apiKey: "" }, () => setConfirmRemove(false))}
                    className="rounded-md px-2 py-1 text-[13px] font-medium text-danger hover:bg-danger/5"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className={ui.btnGhost}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => setReplacing(true)} className={ui.btnAction}>
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    aria-label="Remove key"
                    title="Remove key"
                    className="rounded-md p-1.5 text-faint transition-colors hover:bg-accent-soft/70 hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </>
              )}
              {!key.readable && (
                <p className="w-full text-xs text-warn">
                  This key can no longer be read (the server&apos;s secret changed). Replace it to keep using summaries.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={saveKey} className="flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={provider.keyPlaceholder}
                id="ai-key"
                aria-label={`${provider.label} API key`}
                autoComplete="off"
                spellCheck={false}
                className={`${ui.input} font-mono text-[13px]`}
              />
              <button type="submit" disabled={pending || !keyInput.trim()} className={ui.btnPrimary}>
                {pending ? "Saving…" : "Save"}
              </button>
              {replacing && (
                <button type="button" onClick={() => setReplacing(false)} className={ui.btnGhost}>
                  Cancel
                </button>
              )}
            </form>
          )}
          {(!key || replacing) && (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              Get {provider.id === "openai" ? "an" : "a"} {provider.label} API key <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>

        <div>
          <label htmlFor="ai-model" className={ui.label}>
            Model
          </label>
          {typing ? (
            <>
              <input
                id="ai-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={saveModel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder={DEFAULTS[shown]}
                spellCheck={false}
                autoFocus
                className={`${ui.input} font-mono text-[13px]`}
              />
              <button type="button" onClick={() => setTyping(false)} className="mt-1 text-xs text-muted hover:text-ink">
                Choose from the list
              </button>
            </>
          ) : (
            <select
              id="ai-model"
              value={model}
              disabled={!list}
              onChange={(e) => {
                if (e.target.value === OTHER) return setTyping(true);
                setModel(e.target.value);
                if (e.target.value !== settings.models[shown]) save({ provider: shown, model: e.target.value });
              }}
              className={`${ui.input} text-[14px]`}
            >
              {!list && <option value={model}>{model}</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label === o.id ? o.id : `${o.label} (${o.id})`}
                  {o.id === DEFAULTS[shown] ? " · default" : ""}
                </option>
              ))}
              <option value={OTHER}>Other…</option>
            </select>
          )}
          <p className="mt-1 text-xs text-faint">
            {list?.live
              ? `The models your ${provider.label} key can use.`
              : `Suggested models. Save your key to see every model available to you.`}
          </p>
        </div>
      </div>

      <p role="status" className="text-sm">
        {message ? (
          <span className={message.kind === "error" ? "text-danger" : "text-warn"}>{message.text}</span>
        ) : active ? (
          <span className="text-muted">
            Ready. Summaries use {provider.label} ({settings.models[shown]}), billed to your key.
          </span>
        ) : null}
      </p>

      <Usage usage={usage} />
    </div>
  );
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function line(t: UsageTotals): string {
  const parts: string[] = [];
  if (t.requests) parts.push(`${t.requests} request${t.requests === 1 ? "" : "s"} · ${fmt(t.inputTokens)} tokens in · ${fmt(t.outputTokens)} out`);
  if (t.speechRequests) parts.push(`read aloud ${fmt(t.speechChars)} characters`);
  return parts.join(" · ") || "Nothing yet";
}

/** What has been used through Masterfully; the cost is on the provider's dashboard. */
function Usage({ usage }: { usage: UsageSummary }) {
  return (
    <div className="rounded-lg bg-accent-soft/40 px-4 py-3 text-sm" data-testid="ai-usage">
      <p className="mb-2 font-medium text-ink">Your usage through Masterfully</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">This month</dt>
        <dd className="tabular-nums">{line(usage.thisMonth)}</dd>
        <dt className="text-muted">Last month</dt>
        <dd className="tabular-nums">{line(usage.lastMonth)}</dd>
        <dt className="text-muted">All time</dt>
        <dd className="tabular-nums">{line(usage.allTime)}</dd>
      </dl>
      {usage.byModel.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-rule pt-2 text-xs text-muted">
          {usage.byModel.map((m) => (
            <li key={`${m.provider}:${m.model}`} className="tabular-nums">
              <span className="font-mono">{m.model}</span> — {line(m)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">
        Costs depend on each model&apos;s current prices. See exact charges in the{" "}
        <a href="https://console.anthropic.com/settings/usage" target="_blank" rel="noreferrer" className="underline hover:text-ink">
          Anthropic Console
        </a>{" "}
        or{" "}
        <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer" className="underline hover:text-ink">
          OpenAI dashboard
        </a>
        .
      </p>
    </div>
  );
}
