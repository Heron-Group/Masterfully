"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AutoTextarea } from "./auto-textarea";

// Notion-style fields: they look like text on the page, show a faint
// background on hover, and save when you leave them. No boxes, no Save button.

export const fieldBase =
  "w-full rounded-sm bg-transparent px-1.5 py-0.5 -mx-1.5 text-ink placeholder:text-faint transition-colors hover:bg-accent-soft/70 focus:bg-accent-soft focus:outline-none focus-visible:outline-none";

function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    // The saved value changed (e.g. after a refresh): follow it.
    setPrev(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/** A page title you click to rename. Enter saves; an empty title is reverted. */
export function InlineTitle({
  value,
  onSave,
  ariaLabel,
  placeholder = "Untitled",
  autoFocus,
}: {
  value: string;
  onSave: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useDraft(value);
  return (
    <AutoTextarea
      value={draft}
      onChange={(v) => setDraft(v.replace(/\n/g, " "))}
      onBlur={() => {
        const next = draft.trim();
        if (!next) setDraft(value);
        else if (next !== value) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      minRows={1}
      className={`${fieldBase} block resize-none font-serif text-[1.9rem] leading-tight tracking-tight`}
    />
  );
}

/** One row of a properties list: a quiet label and an editable value. */
export function PropertyRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-x-3 py-0.5 text-[15px] sm:grid-cols-[8rem_1fr]">
      <label htmlFor={htmlFor} className="py-0.5 text-sm text-muted">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Single-line text (or several lines with `multiline`) that saves on blur. */
export function InlineText({
  id,
  value,
  onSave,
  placeholder = "Empty",
  multiline,
  inputMode,
  ariaLabel,
  className = "",
}: {
  id?: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: "numeric" | "url" | "text";
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useDraft(value);
  const commit = () => {
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  if (multiline) {
    return (
      <AutoTextarea
        id={id}
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Escape" && (setDraft(value), e.currentTarget.blur())}
        placeholder={placeholder}
        aria-label={ariaLabel}
        minRows={1}
        className={`${fieldBase} block resize-none ${className}`}
      />
    );
  }
  return (
    <input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      inputMode={inputMode}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      className={`${fieldBase} ${className}`}
    />
  );
}

/** A select that looks like text until you open it. */
export function InlineSelect<T extends string>({
  id,
  value,
  options,
  onSave,
  ariaLabel,
  className = "",
}: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onSave: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onSave(e.target.value as T)}
      aria-label={ariaLabel}
      className={`${fieldBase} w-auto cursor-pointer appearance-none pr-5 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** "Saving…" / "Saved" / error text for inline edits. */
export function useInlineSave() {
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; error?: string }>({ status: "idle" });
  useEffect(() => {
    if (state.status !== "saved") return;
    const t = setTimeout(() => setState({ status: "idle" }), 1500);
    return () => clearTimeout(t);
  }, [state.status]);
  async function save(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setState({ status: "saving" });
    const r = await fn().catch(() => ({ ok: false, error: "Couldn't reach the server." }));
    setState(r.ok ? { status: "saved" } : { status: "error", error: r.error ?? "Couldn't save." });
    return r.ok;
  }
  const label =
    state.status === "saving" ? "Saving…" : state.status === "saved" ? "Saved" : state.status === "error" ? state.error : "";
  return { save, label, isError: state.status === "error" };
}

/**
 * Inline text that sizes itself to its content, for values that sit in a
 * line of text (e.g. "Brody, Ann · 2025 · Article"). Saves on blur or Enter.
 */
export function InlineAutoText({
  value,
  onSave,
  placeholder,
  ariaLabel,
  title,
  inputMode,
  className = "",
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  title?: string;
  inputMode?: "numeric" | "text";
  className?: string;
}) {
  const [draft, setDraft] = useDraft(value);
  return (
    <span className={`inline-grid max-w-full align-middle ${className}`} title={title ?? ariaLabel}>
      {/* Invisible copy of the text sets the width; the input sits on top. */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre px-1.5 py-0.5">
        {draft || placeholder}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        // A small size stops the input's default ~20-character width; the
        // hidden copy of the text above sets the real width.
        size={1}
        className="col-start-1 row-start-1 w-full min-w-0 rounded-sm bg-transparent px-1.5 py-0.5 text-inherit placeholder:text-faint transition-colors hover:bg-accent-soft/70 focus:bg-accent-soft focus:text-ink focus:outline-none focus-visible:outline-none"
      />
    </span>
  );
}

/**
 * A select that is exactly as wide as its current label: the label shows as
 * text, with the (invisible) native select laid over it to open the list.
 */
export function InlineSelectText<T extends string>({
  value,
  options,
  onSave,
  ariaLabel,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onSave: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <span
      className={`relative inline-block rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent-soft/70 focus-within:bg-accent-soft focus-within:text-ink ${className}`}
      title={ariaLabel}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onSave(e.target.value as T)}
        aria-label={ariaLabel}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
