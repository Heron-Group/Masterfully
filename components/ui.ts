// Shared class names so forms and buttons look the same everywhere.

export const ui = {
  page: "mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:pt-12",
  h1: "font-serif text-3xl tracking-tight",
  h2: "text-xs font-medium uppercase tracking-wider text-muted",
  input:
    "w-full rounded-md border border-rule bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none",
  label: "mb-1 block text-sm text-muted",
  btnPrimary:
    "inline-flex items-center justify-center rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40",
  btnSecondary:
    "inline-flex items-center justify-center rounded-md border border-rule px-3 py-1.5 text-sm text-ink transition-colors hover:bg-accent-soft disabled:opacity-50",
  btnGhost: "rounded px-2 py-1 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50",
  btnDanger:
    "inline-flex items-center justify-center rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-60",
  card: "rounded-lg border border-rule bg-surface",
  badge: "inline-block rounded-full border border-rule px-2 py-px text-[11px] text-muted",
} as const;
