"use client";

import { Download, Palette, Sparkles, UserRound, X, type LucideIcon } from "lucide-react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type SettingsSection = "account" | "appearance" | "ai" | "data";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI summaries", icon: Sparkles },
  { id: "data", label: "Your data", icon: Download },
];

type SettingsContext = { open: (section?: SettingsSection) => void; isOpen: boolean };
const Context = createContext<SettingsContext>({ open: () => {}, isOpen: false });

/** Open the settings window from anywhere in the app. */
export function useSettings(): SettingsContext {
  return use(Context);
}

/**
 * Settings in a window over the current page, like Claude's: sections on the
 * left, the chosen section on the right (tabs along the top on phones). The
 * sections are rendered on the server and only mounted while the window is
 * open, so each opening shows fresh settings.
 */
export function SettingsProvider({
  sections,
  children,
}: {
  sections: Record<SettingsSection, ReactNode>;
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState<SettingsSection>("account");
  const dialog = useRef<HTMLDialogElement>(null);

  const open = useCallback((section: SettingsSection = "account") => {
    setActive(section);
    setOpen(true);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    if (!isOpen && el.open) el.close();
    // Keep the page behind still while the window is open.
    document.documentElement.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [isOpen]);

  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);
  const current = SECTIONS.find((s) => s.id === active)!;

  return (
    <Context value={value}>
      {children}
      <dialog
        ref={dialog}
        aria-label="Settings"
        onClose={() => setOpen(false)}
        // A click on the backdrop (outside the panel) lands on the dialog itself.
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden bg-surface p-0 text-ink backdrop:bg-black/40 md:h-[min(40rem,calc(100dvh-4rem))] md:w-[min(54rem,calc(100vw-4rem))] md:rounded-2xl md:shadow-2xl md:shadow-black/20 md:ring-1 md:ring-rule"
      >
        {isOpen && (
          <div className="flex h-full flex-col md:grid md:grid-cols-[13rem_1fr]">
            <div className="shrink-0 border-b border-rule pt-[env(safe-area-inset-top)] md:border-b-0 md:border-r md:bg-paper md:pt-0">
              <div className="flex items-center justify-between px-5 pb-2 pt-4 md:pb-3 md:pt-6">
                <p className="font-serif text-2xl tracking-tight">Settings</p>
                <CloseButton onClose={() => setOpen(false)} className="md:hidden" />
              </div>
              <nav aria-label="Settings sections" className="px-3 pb-3">
                <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
                  {SECTIONS.map(({ id, label, icon: Icon }) => (
                    <li key={id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setActive(id)}
                        aria-current={id === active ? "page" : undefined}
                        className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[15px] transition-colors ${
                          id === active ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
                        }`}
                      >
                        <Icon size={17} strokeWidth={1.6} aria-hidden="true" className={id === active ? "text-accent" : undefined} />
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="hidden items-center justify-between px-8 pb-2 pt-6 md:flex">
                <h2 className="text-lg font-medium">{current.label}</h2>
                <CloseButton onClose={() => setOpen(false)} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-5 md:px-8 md:pt-3">{sections[active]}</div>
            </div>
          </div>
        )}
      </dialog>
    </Context>
  );
}

function CloseButton({ onClose, className = "" }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close settings"
      title="Close (Esc)"
      className={`rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink ${className}`}
    >
      <X size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
