"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { formatKeymap } from "./format-commands";
import { liveMarkdown } from "./live-markdown";

export type LiveEditorHandle = {
  focus: (at?: { x: number; y: number } | "end") => void;
  /** Replace the whole document (e.g. after posting). */
  setValue: (value: string) => void;
};

type Props = {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  onEscape?: () => void;
  onBlur?: () => void;
  /** Files pasted from the clipboard (e.g. screenshots). */
  onPasteFiles?: (files: File[]) => void;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<LiveEditorHandle>;
};

/**
 * A Markdown editor that looks like the page it produces: no box, no
 * preview pane. Built on CodeMirror 6 with live formatting (see
 * live-markdown.ts). The text is stored exactly as typed.
 */
export function LiveEditor({
  value,
  onChange,
  placeholder,
  onSubmit,
  onEscape,
  onBlur,
  onPasteFiles,
  ariaLabel,
  autoFocus,
  className = "",
  ref,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, read by the editor without rebuilding it.
  const callbacks = useRef({ onChange, onSubmit, onEscape, onBlur, onPasteFiles });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onEscape, onBlur, onPasteFiles };
  });

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown({ base: markdownLanguage }),
          liveMarkdown,
          EditorView.lineWrapping,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-multiline": "true", spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
          keymap.of([
            { key: "Mod-Enter", run: () => (callbacks.current.onSubmit?.(), !!callbacks.current.onSubmit) },
            { key: "Escape", run: (v) => (callbacks.current.onEscape ? callbacks.current.onEscape() : v.contentDOM.blur(), true) },
            ...formatKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) callbacks.current.onBlur?.();
          }),
          EditorView.domEventHandlers({
            paste: (event) => {
              const files = [...(event.clipboardData?.files ?? [])];
              if (!files.length || !callbacks.current.onPasteFiles) return false;
              event.preventDefault();
              callbacks.current.onPasteFiles(files);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once; later `value` changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow outside changes (e.g. a file edited elsewhere) when not typing.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.hasFocus) return;
    const current = editor.state.doc.toString();
    if (current !== value) editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus(at) {
      const editor = view.current;
      if (!editor) return;
      editor.focus();
      let pos = editor.state.doc.length;
      if (at && at !== "end") pos = editor.posAtCoords(at) ?? pos;
      editor.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
    setValue(next) {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: next } });
    },
  }));

  return <div ref={host} className={`live-editor prose-rp ${className}`} />;
}
