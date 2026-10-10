"use client";

import { Download, ExternalLink, FileText, Globe, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PdfViewer } from "./pdf-viewer";

export type ReaderTab = {
  key: "pdf" | "link";
  label: string;
  /** What the panel shows (same-origin PDF or the reader view). */
  src: string;
  /** Opened by the "open in new tab" button. */
  openUrl: string;
  downloadUrl?: string;
};

const WIDTH_KEY = "rp:reader-width";
const MIN_WIDTH = 360;

function clampWidth(w: number) {
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), window.innerWidth * 0.75));
}

function initialWidth() {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved) return clampWidth(saved);
  } catch {}
  return clampWidth(window.innerWidth * 0.48);
}

/**
 * A reading panel on the right of the page (full screen on phones), so a
 * PDF or web page can be read next to your notes. On wide screens the page
 * makes room for it via --reader-width; drag the left edge to resize.
 */
export function ReaderPanel({
  title,
  tabs,
  active,
  onTab,
  onClose,
}: {
  title: string;
  tabs: ReaderTab[];
  active: ReaderTab["key"];
  onTab: (key: ReaderTab["key"]) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState("light");
  const panel = useRef<HTMLDivElement>(null);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];

  // Reserve room for the panel while it is open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measure the window after mount
    setWidth(initialWidth());
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    return () => {
      document.documentElement.style.removeProperty("--reader-width");
    };
  }, []);
  useEffect(() => {
    if (width) document.documentElement.style.setProperty("--reader-width", `${width}px`);
  }, [width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest?.(".cm-editor, input, textarea")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: PointerEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        const w = panel.current?.getBoundingClientRect().width;
        if (w) localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
      } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const src = tab.key === "link" ? `${tab.src}?theme=${theme}` : tab.src;

  return (
    <aside
      ref={panel}
      aria-label={`Reading: ${title}`}
      className="fixed inset-0 z-40 flex flex-col bg-surface pt-[env(safe-area-inset-top)] lg:left-auto lg:w-[var(--w,48vw)] lg:border-l lg:border-rule lg:pt-0 lg:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]"
      style={width ? ({ ["--w" as string]: `${width}px` } as React.CSSProperties) : undefined}
    >
      {/* Drag the left edge to resize (wide screens only). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize reading panel"
        onPointerDown={startResize}
        className="absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize lg:block"
      >
        <div className={`mx-auto h-full w-px transition-colors ${dragging ? "bg-accent" : "bg-transparent hover:bg-accent/60"}`} />
      </div>

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-3">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label="Show" className="flex rounded-md bg-accent-soft/70 p-0.5 text-xs">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={t.key === tab.key}
                onClick={() => onTab(t.key)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${t.key === tab.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {t.key === "pdf" ? <FileText size={14} aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
                {t.label}
              </button>
            ))}
          </div>
        ) : tab.key === "pdf" ? (
          <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
        ) : (
          <Globe size={16} className="shrink-0 text-muted" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 truncate text-sm text-ink" title={title}>
          {title}
        </p>
        <a href={tab.openUrl} target="_blank" rel="noopener noreferrer" title="Open in a new tab" aria-label="Open in a new tab" className="rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-ink">
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        {tab.downloadUrl && (
          <a href={tab.downloadUrl} title="Download" aria-label="Download" className="rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-ink">
            <Download size={16} aria-hidden="true" />
          </a>
        )}
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close reading panel" className="rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-ink">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className={`flex min-h-0 flex-1 flex-col ${dragging ? "pointer-events-none select-none" : ""}`}>
        {tab.key === "pdf" ? (
          <PdfViewer key={src} url={src} title={title} />
        ) : (
          <iframe key={src} src={src} title={`${tab.label}: ${title}`} className="min-h-0 w-full flex-1 bg-surface" />
        )}
      </div>
    </aside>
  );
}
