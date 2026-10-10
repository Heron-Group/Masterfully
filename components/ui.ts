// Shared class names so forms and buttons look the same everywhere.

export const ui = {
  page: "mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:pt-12",
  h1: "font-serif text-3xl tracking-tight",
  h2: "text-xs font-medium uppercase tracking-wider text-muted",
  input:
    "w-full rounded-md border border-transparent bg-accent-soft/60 px-3 py-1.5 text-[15px] text-ink placeholder:text-faint transition-colors hover:bg-accent-soft focus:border-rule focus:bg-surface focus:outline-none",
  label: "mb-1 block text-sm text-muted",
  btnPrimary:
    "inline-flex items-center justify-center rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40",
  btnSecondary:
    "inline-flex items-center justify-center rounded-md px-2.5 py-1 text-sm text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-50",
  /** Quiet action with an icon: Add to group, Generate summary, Add from library, New source. */
  btnAction:
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-accent-soft/70 hover:text-ink disabled:opacity-50",
  /** A quiet button with a soft background and an icon: Sign out, Download your data. */
  btnSoft:
    "inline-flex items-center gap-1.5 rounded-md bg-accent-soft/70 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-accent-soft disabled:opacity-50",
  btnGhost: "rounded px-2 py-1 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50",
  btnDanger:
    "inline-flex items-center justify-center rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-60",
  card: "rounded-lg bg-surface shadow-sm shadow-black/5 ring-1 ring-rule/60",
  badge: "inline-block rounded-full bg-accent-soft/70 px-2 py-px text-[11px] text-muted",
} as const;
