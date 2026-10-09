"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Save `value` after `delayMs` without changes. Also saves when the page is
 * hidden or the component unmounts, so a pause is never needed to keep text.
 */
export function useAutosave(
  value: string,
  save: (value: string) => Promise<{ ok: boolean; error?: string }>,
  delayMs = 1200,
) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current;
    if (value === saved.current) return;
    setState("saving");
    const result = await saveRef.current(value).catch(() => ({ ok: false, error: "Couldn't reach the server." }));
    if (result.ok) {
      saved.current = value;
      setError(null);
      setState(latest.current === value ? "saved" : "pending");
    } else {
      setError(result.error ?? "Couldn't save.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    latest.current = value;
    if (value === saved.current) return;
    setState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [value, delayMs, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  // Warn before leaving with unsaved text.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (latest.current !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return { state, error, flush };
}

export function SaveStatus({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  if (state === "error") {
    return (
      <span className="text-danger">
        {error} <button type="button" onClick={onRetry} className="underline">Retry</button>
      </span>
    );
  }
  const text = { idle: "", pending: "Unsaved", saving: "Saving…", saved: "Saved" }[state];
  return <span className="text-faint">{text}</span>;
}
