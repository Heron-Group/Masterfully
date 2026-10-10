"use client";

import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { ui } from "@/components/ui";
import type { AiProvider, AiSettingsView } from "@/lib/ai/user-config";
import { saveAiSettings } from "./actions";

const PROVIDERS: { id: AiProvider; label: string; keyUrl: string; keyPlaceholder: string }[] = [
  { id: "anthropic", label: "Claude", keyUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…" },
];

const DEFAULTS: Record<AiProvider, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.5" };

export function AiSettings({ initial, simulated }: { initial: AiSettingsView; simulated: boolean }) {
  const [settings, setSettings] = useState(initial);
  const [shown, setShown] = useState<AiProvider>(initial.provider ?? "anthropic");
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState(initial.models[shown]);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const provider = PROVIDERS.find((p) => p.id === shown)!;
  const key = settings.keys[shown];
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
      if (r.warning) setMessage({ kind: "info", text: r.warning });
      done?.();
    });
  }

  function choose(id: AiProvider) {
    if (id === shown && settings.provider === id) return;
    setShown(id);
    setModel(settings.models[id]);
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
    <div className="max-w-xl space-y-5">
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

      <div className="grid grid-cols-[6rem_1fr] items-start gap-x-4 gap-y-4 text-sm">
        <span className="pt-1.5 text-muted">API key</span>
        <div>
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
              Get a {provider.label} API key <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>

        <label htmlFor="ai-model" className="pt-1.5 text-muted">
          Model
        </label>
        <div>
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
            className={`${ui.input} font-mono text-[13px]`}
          />
          {model.trim() !== DEFAULTS[shown] && (
            <button
              type="button"
              onClick={() => {
                setModel(DEFAULTS[shown]);
                save({ provider: shown, model: DEFAULTS[shown] });
              }}
              className="mt-1 text-xs text-muted hover:text-ink"
            >
              Use the default ({DEFAULTS[shown]})
            </button>
          )}
        </div>
      </div>

      <p role="status" className="text-sm">
        {message ? (
          <span className={message.kind === "error" ? "text-danger" : "text-warn"}>{message.text}</span>
        ) : simulated ? (
          <span className="text-muted">Development mode: summaries are simulated (AI_FAKE=1), whatever is set here.</span>
        ) : active ? (
          <span className="text-muted">
            Ready. Summaries use {provider.label} ({settings.models[shown]}), billed to your key.
          </span>
        ) : (
          <span className="text-muted">Add your {provider.label} API key to turn on AI summaries.</span>
        )}
      </p>
    </div>
  );
}
