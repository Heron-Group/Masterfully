"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { LinkPicker, SlashMenu, type Anchor, type LinkTarget } from "./editor-popovers";
import { formatKeymap } from "./format-commands";
import { liveMarkdown } from "./live-markdown";
import { closeSlash, filterCommands, removeSlashText, slashField, type SlashCommand } from "./slash";

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
  const router = useRouter();
  // The "/" menu (query typed after the "/", and where to show it).
  const [slash, setSlash] = useState<{ query: string; at: Anchor } | null>(null);
  const slashKeys = useRef<((key: string) => boolean) | null>(null);
  // The link picker: what it will replace, and where to show it.
  const [picker, setPicker] = useState<{ from: number; to: number; at: Anchor; mode: "source" | "link" } | null>(null);
  const openPickerRef = useRef<(mode: "source" | "link") => void>(() => {});
  // Latest callbacks, read by the editor without rebuilding it.
  const callbacks = useRef({ onChange, onSubmit, onEscape, onBlur, onPasteFiles, router });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onEscape, onBlur, onPasteFiles, router };
  });

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          slashField,
          // While the "/" menu is open, these keys drive it instead of the editor.
          Prec.highest(
            keymap.of(
              ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].map((key) => ({
                key,
                run: (v: EditorView) => !!v.state.field(slashField) && (slashKeys.current?.(key) ?? false),
              })),
            ),
          ),
          markdown({ base: markdownLanguage }),
          liveMarkdown,
          EditorView.lineWrapping,
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-multiline": "true", spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
          keymap.of([
            { key: "Mod-Enter", run: () => (callbacks.current.onSubmit?.(), !!callbacks.current.onSubmit) },
            // Cmd/Ctrl+K: link the selection to a source or a web address.
            { key: "Mod-k", run: () => (openPickerRef.current("link"), true) },
            { key: "Escape", run: (v) => (callbacks.current.onEscape ? callbacks.current.onEscape() : v.contentDOM.blur(), true) },
            ...formatKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString());
            const next = update.state.field(slashField);
            if (next !== update.startState.field(slashField)) {
              const c = next && update.view.coordsAtPos(next.from);
              setSlash(next && c ? { query: next.query, at: { left: c.left, top: c.top, bottom: c.bottom } } : null);
            }
            if (update.focusChanged && !update.view.hasFocus) callbacks.current.onBlur?.();
          }),
          EditorView.domEventHandlers({
            // Cmd/Ctrl-click a link to open it (a plain click places the cursor to edit).
            click: (event) => {
              if (!(event.metaKey || event.ctrlKey)) return false;
              const href = (event.target as HTMLElement).closest<HTMLElement>("[data-href]")?.dataset.href;
              if (!href) return false;
              event.preventDefault();
              if (href.startsWith("/")) callbacks.current.router.push(href);
              else window.open(href, "_blank", "noopener,noreferrer");
              return true;
            },
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

  const anchorAt = (editor: EditorView, pos: number): Anchor | null => {
    const c = editor.coordsAtPos(pos);
    return c ? { left: c.left, top: c.top, bottom: c.bottom } : null;
  };

  // Open the link picker for the selection (or at the cursor).
  const openPicker = useCallback((mode: "source" | "link") => {
    const editor = view.current;
    if (!editor) return;
    const { from, to } = editor.state.selection.main;
    const at = anchorAt(editor, from);
    if (at) setPicker({ from, to, at, mode });
  }, []);
  useEffect(() => {
    openPickerRef.current = openPicker;
  }, [openPicker]);

  /** Insert [text](href) for the picked target, using the selected text if any. */
  function applyLink(target: LinkTarget) {
    const editor = view.current;
    const p = picker;
    setPicker(null);
    if (!editor || !p) return;
    const selected = editor.state.sliceDoc(p.from, p.to);
    const text = (selected || target.title).replace(/[[\]]/g, "");
    const insert = `[${text}](${target.href})`;
    editor.dispatch({
      changes: { from: p.from, to: p.to, insert },
      selection: EditorSelection.cursor(p.from + insert.length),
      userEvent: "input.link",
    });
    editor.focus();
  }

  function closePicker() {
    setPicker(null);
    view.current?.focus();
  }

  const pickCommand = useCallback(
    (command: SlashCommand) => {
      const editor = view.current;
      if (!editor) return;
      removeSlashText(editor);
      if (command.id === "source" || command.id === "link") openPicker(command.id === "source" ? "source" : "link");
      else command.run?.(editor);
    },
    [openPicker],
  );
  const closeSlashMenu = useCallback(() => {
    view.current?.dispatch({ effects: closeSlash.of(null) });
  }, []);

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

  return (
    <>
      <div ref={host} className={`live-editor prose-rp ${className}`} />
      {slash && (
        <SlashMenu at={slash.at} commands={filterCommands(slash.query)} onPick={pickCommand} onClose={closeSlashMenu} keysRef={slashKeys} />
      )}
      {picker && <LinkPicker at={picker.at} mode={picker.mode} onPick={applyLink} onClose={closePicker} />}
    </>
  );
}
