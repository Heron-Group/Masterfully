"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";
const OPTIONS: { value: Choice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function apply(choice: Choice) {
  const dark =
    choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function readChoice(): Choice {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/**
 * Colour mode: match the system, or always light or dark. Saved in this
 * browser; the root layout's inline script applies it before first paint and
 * follows system changes while "Match system" is chosen.
 */
export function ThemeSetting() {
  // "system" on the server; corrected after mount (the page colours were
  // already set by the inline script).
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with localStorage after hydration
    setChoice(readChoice());
  }, []);

  function choose(next: Choice) {
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
    apply(next);
    setChoice(next);
  }

  return (
    <div role="radiogroup" aria-label="Colour mode" className="inline-flex rounded-lg bg-accent-soft/60 p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          onClick={() => choose(value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1 text-sm transition-colors ${
            choice === value ? "bg-surface text-ink shadow-sm shadow-black/5" : "text-muted hover:text-ink"
          }`}
        >
          <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
