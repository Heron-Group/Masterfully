"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { Markdown } from "./markdown";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Called on Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Minimum height in lines. */
  minRows?: number;
  /** CSS max-height for the textarea before it scrolls, e.g. "40vh". */
  maxHeight?: string;
  /** Rendered at the right of the Write/Preview bar (e.g. a save status). */
  toolbar?: ReactNode;
  showTabs?: boolean;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onSubmit">;
  className?: string;
};

/** Plain auto-growing textarea with a Write / Preview toggle. */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  minRows = 3,
  maxHeight,
  toolbar,
  showTabs = true,
  textareaProps,
  className = "",
}: Props) {
  const [preview, setPreview] = useState(false);
  return (
    <div className={className}>
      {showTabs && (
        <div className="mb-2 flex items-center gap-1 text-xs">
          <TabButton active={!preview} onClick={() => setPreview(false)}>
            Write
          </TabButton>
          <TabButton active={preview} onClick={() => setPreview(true)}>
            Preview
          </TabButton>
          <div className="ml-auto">{toolbar}</div>
        </div>
      )}
      {preview ? (
        <div className="min-h-[4.5rem] rounded-md border border-dashed border-rule px-3 py-2">
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-faint">Nothing to preview.</p>
          )}
        </div>
      ) : (
        <AutoTextarea
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          autoFocus={autoFocus}
          minRows={minRows}
          maxHeight={maxHeight}
          className="w-full resize-none rounded-md border border-rule bg-surface px-3 py-2 font-serif text-[17px] leading-relaxed text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          {...textareaProps}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-0.5 transition-colors ${active ? "bg-accent-soft text-ink" : "text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

type AutoTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "onSubmit"> & {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  minRows?: number;
  maxHeight?: string;
  ref?: Ref<HTMLTextAreaElement>;
};

/** A textarea that grows with its content. Enter adds a line; Cmd/Ctrl+Enter submits. */
export function AutoTextarea({ value, onChange, onSubmit, minRows = 1, maxHeight, style, onKeyDown, ref: outerRef, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
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
