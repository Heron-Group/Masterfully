"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncStatus as Status } from "@/lib/content/git";

/** Fire after any write so the indicator refreshes without waiting for the poll. */
export const CONTENT_CHANGED_EVENT = "content-changed";

const POLL_MS = 15_000;

const LABELS: Record<Status["state"], string> = {
  synced: "Backed up",
  pending: "Backup pending",
  syncing: "Backing up…",
  error: "Backup failed",
  local: "Local only",
};

const DOT: Record<Status["state"], string> = {
  synced: "bg-ok",
  pending: "bg-warn",
  syncing: "bg-warn animate-pulse",
  error: "bg-danger",
  local: "bg-faint",
};

export function SyncStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // Offline: keep the last known status.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of external state
    void load();
    const timer = setInterval(load, POLL_MS);
    const onChange = () => void load();
    window.addEventListener(CONTENT_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CONTENT_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function syncNow() {
    setBusy(true);
    setStatus((s) => (s ? { ...s, state: "syncing" } : s));
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) setStatus(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state ?? "synced";
  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted transition-colors hover:text-ink"
      >
        <span className={`inline-block size-1.5 rounded-full ${status ? DOT[state] : "bg-faint"}`} />
        <span className="hidden sm:inline">{status ? LABELS[state] : "…"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-md border border-rule bg-surface p-4 text-sm shadow-lg shadow-black/5">
          <p className="font-medium">{status ? LABELS[state] : "Checking…"}</p>
          <p className="mt-1 text-muted">
            {state === "local" && "No GitHub remote is configured. Changes are committed locally."}
            {state === "synced" &&
              (status?.lastSyncedAt
                ? `Everything is on GitHub. Last sync ${new Date(status.lastSyncedAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}.`
                : "Everything is on GitHub.")}
            {state === "pending" &&
              `${status?.ahead ? `${status.ahead} change${status.ahead === 1 ? "" : "s"}` : "Changes"} will be pushed to GitHub shortly.`}
            {state === "syncing" && "Pushing to GitHub…"}
          </p>
          {state === "error" && (
            <div className="mt-1 space-y-2">
              <p className="whitespace-pre-wrap break-words text-danger">{status?.error}</p>
              {!!status?.conflicts?.length && (
                <ul className="list-inside list-disc text-muted">
                  {status.conflicts.map((f) => (
                    <li key={f} className="font-mono text-xs">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {state !== "local" && (
            <button
              type="button"
              onClick={syncNow}
              disabled={busy}
              className="mt-3 rounded border border-rule px-2.5 py-1 text-xs text-ink transition-colors hover:bg-accent-soft disabled:opacity-60"
            >
              {busy ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
