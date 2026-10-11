import { EditorSelection, StateEffect, StateField, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { toggleWrap } from "./format-commands";

// The "/" menu (Notion style): typing "/" at the start of a line or after a
// space opens it; the text typed after the "/" filters it. This file tracks
// that state in CodeMirror and holds the commands; the menu itself is drawn
// by React (slash-menu.tsx).

export type SlashState = { from: number; query: string } | null;

export const closeSlash = StateEffect.define<null>();

export const slashField = StateField.define<SlashState>({
  create: () => null,
  update(value, tr) {
    if (tr.effects.some((e) => e.is(closeSlash))) return null;
    if (!value) {
      if (!tr.docChanged || !tr.isUserEvent("input.type")) return null;
      let opened: SlashState = null;
      tr.changes.iterChanges((_fa, _ta, fromB, _tb, inserted) => {
        if (inserted.toString() !== "/") return;
        const before = fromB > 0 ? tr.state.sliceDoc(fromB - 1, fromB) : "";
        if (!before || /\s/.test(before)) opened = { from: fromB, query: "" };
      });
      return opened;
    }
    const from = tr.changes.mapPos(value.from);
    const sel = tr.state.selection.main;
    if (tr.state.sliceDoc(from, from + 1) !== "/" || !sel.empty || sel.head <= from) return null;
    const query = tr.state.sliceDoc(from + 1, sel.head);
    if (query.includes("\n") || query.length > 40) return null;
    // "a / b": a space straight after the "/", or a word that matches nothing, means it wasn't a command.
    if (/^\s/.test(query) || (/\s$/.test(query) && !filterCommands(query).length)) return null;
    return { from, query };
  },
});

export type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  /** Shown as a heading above the first command of each group. */
  group?: string;
  /** Edits the document; the "/query" text has already been removed. */
  run?: (view: EditorView) => void;
};

const PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;

/**
 * Make the current line, or every line in the selection, a paragraph,
 * heading, list item, quote… (replacing any existing marker). Numbered
 * lists are numbered 1, 2, 3…
 */
function setLinePrefix(prefix: string) {
  return (view: EditorView) => {
    const { state } = view;
    const sel = state.selection.main;
    const first = state.doc.lineAt(sel.from).number;
    const last = state.doc.lineAt(sel.to).number;
    const changes = [];
    let n = 0;
    for (let i = first; i <= last; i++) {
      const line = state.doc.line(i);
      if (first !== last && !line.text.trim()) continue; // leave blank lines between paragraphs
      const m = line.text.match(PREFIX)!;
      const from = line.from + m[1].length;
      const insert = prefix === "1. " ? `${++n}. ` : prefix;
      changes.push({ from, to: from + (m[2]?.length ?? 0), insert });
    }
    const tr = state.update({ changes, userEvent: "input.format" });
    const head = tr.changes.mapPos(sel.head, 1);
    view.dispatch({
      changes,
      selection: sel.empty ? EditorSelection.cursor(head) : EditorSelection.range(tr.changes.mapPos(sel.from, -1), tr.changes.mapPos(sel.to, 1)),
      userEvent: "input.format",
    });
  };
}

/** Run an inline format (bold, italic…) on the selection. */
function inline(marker: string) {
  return (view: EditorView) => {
    toggleWrap(marker)(view);
  };
}

function insertBlock(text: (lineIsEmpty: boolean) => { insert: string; cursor: number }) {
  return (view: EditorView) => {
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const empty = !line.text.trim();
    const from = empty ? line.from : head;
    const { insert, cursor } = text(empty);
    const spec: TransactionSpec = {
      changes: { from, to: empty ? line.to : head, insert },
      selection: EditorSelection.cursor(from + cursor),
      userEvent: "input.format",
    };
    view.dispatch(spec);
  };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "paragraph", label: "Paragraph", hint: "Plain text", keywords: "paragraph text plain normal body p", run: setLinePrefix("") },
  { id: "h1", label: "Heading 1", hint: "Large section heading", keywords: "title heading h1 big", run: setLinePrefix("# ") },
  { id: "h2", label: "Heading 2", hint: "Medium section heading", keywords: "title heading h2 subtitle", run: setLinePrefix("## ") },
  { id: "h3", label: "Heading 3", hint: "Small section heading", keywords: "title heading h3 small", run: setLinePrefix("### ") },
  { id: "source", label: "Link to source", hint: "Link to a source in your library, or add one", keywords: "source reference cite library mention link page" },
  { id: "link", label: "Web link", hint: "Link to a web address", keywords: "link url web address href" },
  { id: "bullet", label: "Bulleted list", hint: "A simple list", keywords: "bullet list unordered ul -", run: setLinePrefix("- ") },
  { id: "number", label: "Numbered list", hint: "A list with numbers", keywords: "numbered ordered list ol 1.", run: setLinePrefix("1. ") },
  { id: "todo", label: "To-do list", hint: "Tick items off as you go", keywords: "todo task checkbox check", run: setLinePrefix("- [ ] ") },
  { id: "quote", label: "Quote", hint: "A quotation", keywords: "quote blockquote citation >", run: setLinePrefix("> ") },
  {
    id: "divider",
    label: "Divider",
    hint: "A line between sections",
    keywords: "divider rule line hr separator ---",
    run: insertBlock((empty) => (empty ? { insert: "---\n", cursor: 4 } : { insert: "\n\n---\n", cursor: 6 })),
  },
  {
    id: "code",
    label: "Code block",
    hint: "Text in a monospaced block",
    keywords: "code block pre monospace ```",
    run: insertBlock((empty) => (empty ? { insert: "```\n\n```", cursor: 4 } : { insert: "\n```\n\n```", cursor: 5 })),
  },
];

const TURN_INTO = "Turn into";

/** The menu for selected text (right-click): text styles, links, and what the lines are. */
export const FORMAT_COMMANDS: SlashCommand[] = [
  { id: "bold", label: "Bold", hint: "⌘/Ctrl B", keywords: "bold strong", group: "Style", run: inline("**") },
  { id: "italic", label: "Italic", hint: "⌘/Ctrl I", keywords: "italic emphasis", group: "Style", run: inline("*") },
  { id: "strike", label: "Strikethrough", hint: "⌘/Ctrl Shift X", keywords: "strikethrough", group: "Style", run: inline("~~") },
  { id: "inlinecode", label: "Code", hint: "⌘/Ctrl E", keywords: "code", group: "Style", run: inline("`") },
  { id: "source", label: "Link to source", hint: "A source in your library", keywords: "source link", group: "Link" },
  { id: "link", label: "Web link", hint: "⌘/Ctrl K", keywords: "link url", group: "Link" },
  ...["paragraph", "h1", "h2", "h3", "bullet", "number", "todo", "quote"].map((id) => ({
    ...SLASH_COMMANDS.find((c) => c.id === id)!,
    group: TURN_INTO,
  })),
];

export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.split(" ").some((k) => k.startsWith(q)));
}

/** Remove the "/query" text and close the menu. */
export function removeSlashText(view: EditorView, state: EditorState = view.state) {
  const slash = state.field(slashField);
  if (!slash) return;
  const head = state.selection.main.head;
  view.dispatch({ changes: { from: slash.from, to: head }, effects: closeSlash.of(null), userEvent: "delete" });
}
