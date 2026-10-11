"use client";

import { useEffect, useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from "react";

type AutoTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "onSubmit"> & {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  minRows?: number;
  maxHeight?: string;
  ref?: Ref<HTMLTextAreaElement>;
};

function fit(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

/** A textarea that grows with its content. Enter adds a line; Cmd/Ctrl+Enter submits. */
export function AutoTextarea({ value, onChange, onSubmit, minRows = 1, maxHeight, style, onKeyDown, ref: outerRef, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) fit(el);
  }, [value]);
  // Refit when the width changes (e.g. the reading panel opens), so wrapped lines aren't cut off.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit(el);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (typeof outerRef === "function") outerRef(el);
        else if (outerRef) outerRef.current = el;
      }}
      value={value}
      rows={minRows}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSubmit();
        }
        onKeyDown?.(e);
      }}
      style={{ maxHeight, overflowY: "auto", ...style }}
      {...rest}
    />
  );
}
