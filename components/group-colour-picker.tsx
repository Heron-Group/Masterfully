"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { colourName, GROUP_PALETTE } from "@/lib/map/colours";

/** The group's colour on the Source Map: a swatch that opens the palette. */
export function GroupColourPicker({ colour, onPick }: { colour: string; onPick: (hex: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(colour);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Map colour: ${colourName(current)}`}
        title="Colour on the Source Map"
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-faint transition-colors hover:bg-accent-soft/70 hover:text-ink"
      >
        <span className="size-3 rounded-full ring-1 ring-black/10" style={{ background: current }} aria-hidden="true" />
        {colourName(current)}
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a colour" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg bg-surface p-2 shadow-lg shadow-black/10 ring-1 ring-rule">
          <div role="radiogroup" aria-label="Colour" className="grid grid-cols-5 gap-1.5">
            {GROUP_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={current === c.hex}
                aria-label={c.name}
                title={c.name}
                disabled={pending}
                onClick={() => {
                  const before = current;
                  setCurrent(c.hex);
                  setError(null);
                  start(async () => {
                    const r = await onPick(c.hex);
                    if (!r.ok) {
                      setCurrent(before);
                      setError(r.error ?? "Couldn't save the colour.");
                    } else setOpen(false);
                  });
                }}
                className="flex aspect-square items-center justify-center rounded-md ring-1 ring-black/10 transition-transform hover:scale-105"
                style={{ background: c.hex }}
              >
                {current === c.hex && <Check size={14} strokeWidth={2.5} className="text-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">Used for this group on the Source Map.</p>
          {error && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
