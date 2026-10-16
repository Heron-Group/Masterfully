"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useState, useTransition } from "react";
import { formatShortDate } from "@/lib/time";
import { ui } from "./ui";

// Archiving sources and reading groups: the filter that shows or hides
// archived items, the label on archived rows, and the bar on archived pages.

export type ArchiveView = "current" | "archived" | "all";

export function matchesArchive(view: ArchiveView, archived: string | undefined): boolean {
  return view === "all" || (view === "archived") === !!archived;
}

/** Current (the default), archived, or both. */
export function ArchiveFilter({ value, onChange, className = ui.input }: { value: ArchiveView; onChange: (v: ArchiveView) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ArchiveView)} aria-label="Show archived" className={className}>
      <option value="current">Current</option>
      <option value="archived">Archived</option>
      <option value="all">Current and archived</option>
    </select>
  );
}

export function ArchivedBadge() {
  return (
    <span className={`${ui.badge} inline-flex items-center gap-1`} title="Archived">
      <Archive size={11} strokeWidth={1.8} aria-hidden="true" />
      Archived
    </span>
  );
}

/** Shown at the top of an archived source or group, with Unarchive. */
export function ArchivedBar({ archived, what, onUnarchive }: { archived: string; what: string; onUnarchive: () => Promise<{ ok: boolean; error?: string }> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-accent-soft/60 px-3 py-2 text-[13px]">
      <Archive size={14} strokeWidth={1.7} className="shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Archived {formatShortDate(archived)}. This {what} is hidden from your library, groups and map unless you choose to show archived items.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await onUnarchive();
            if (!r.ok) setError(r.error ?? "Couldn't unarchive.");
          })
        }
        className={ui.btnAction}
      >
        <ArchiveRestore size={14} strokeWidth={1.7} aria-hidden="true" />
        Unarchive
      </button>
      {error && (
        <p role="alert" className="w-full text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
