import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Prec, RangeSet, type Range, type Transaction, type TransactionSpec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * "Live" Markdown: text is styled as it will look on the page (large
 * headings, bold, italic, bullets, quotes), and the Markdown symbols are
 * always hidden, as in Notion. The document itself is never changed, so
 * files keep exactly what was typed.
 *
 * Because the symbols are hidden, editing next to them is adjusted:
 * Backspace/Delete beside bold, a link and so on remove the visible
 * character rather than a hidden "*"; a heading, list or quote marker is
 * removed as a whole; and markers left empty (e.g. "****") are removed.
 *
 * Class names here are matched by the .prose-rp styles in globals.css so the
 * editor and the read-only view look the same.
 */

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  constructor(readonly text: string, readonly depth: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.text === this.text && other.depth === this.depth;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = this.text;
    span.style.left = `${this.depth * 1.5}em`;
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-task";
    box.setAttribute("aria-label", this.checked ? "Done" : "To do");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // TaskMarker is "[ ]" or "[x]"; flip the character inside the brackets.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-md-hr";
    return hr;
  }
}

function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === "ListItem") depth++;
  }
  return Math.max(0, depth - 1);
}

type Built = {
  decorations: DecorationSet;
  /** Hidden line markers (heading, list, quote, divider): removed as a whole. */
  atomic: RangeSet<Decoration>;
  /** Hidden inline markers ("**", "[", "](url)"…), in document order. */
  inline: Array<{ from: number; to: number }>;
};

function buildDecorations(view: EditorView): Built {
  const { state } = view;
  const decos: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  const inline: Array<{ from: number; to: number }> = [];
  const hideInline = (from: number, to: number) => {
    if (to <= from) return;
    decos.push(hide.range(from, to));
    inline.push({ from, to });
  };
  const hideBlock = (deco: Decoration, from: number, to: number) => {
    decos.push(deco.range(from, to));
    atomic.push(deco.range(from, to));
  };
  const lineClass = (pos: number, cls: string, attrs?: Record<string, string>) =>
    decos.push(Decoration.line({ class: cls, attributes: attrs }).range(state.doc.lineAt(pos).from));

  for (const { from, to } of view.visibleRanges) {
    // Short blank lines so paragraph gaps match the rendered page.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (!line.text.trim()) lineClass(line.from, "cm-md-blank");
      pos = line.to + 1;
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node;
        const name = node.name;
        const heading = name.match(/^ATXHeading(\d)$/);
        if (heading) {
          lineClass(node.from, `cm-md-h cm-md-h${heading[1]}`);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            const next = state.doc.sliceString(node.to, node.to + 1);
            hideBlock(hide, node.from, next === " " ? node.to + 1 : node.to);
            break;
          }
          case "StrongEmphasis":
            decos.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
            break;
          case "Emphasis":
            decos.push(Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to));
            break;
          case "Strikethrough":
            decos.push(Decoration.mark({ class: "cm-md-strike" }).range(node.from, node.to));
            break;
          case "InlineCode":
            decos.push(Decoration.mark({ class: "cm-md-code" }).range(node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            hideInline(node.from, node.to);
            break;
          case "CodeMark":
            // Inline code backticks only; fences are styled per line below.
            if (node.parent?.name === "InlineCode") hideInline(node.from, node.to);
            break;
          case "Link": {
            // Links to a source in the library look like a mention; the
            // address is kept on the element so Cmd/Ctrl-click can open it.
            const urlNode = node.node.getChild("URL");
            const href = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : "";
            const source = href.startsWith("/library/");
            decos.push(
              Decoration.mark({
                class: source ? "cm-md-link cm-md-source-link" : "cm-md-link",
                attributes: href ? { "data-href": href, title: `${source ? "Source" : href} — ⌘/Ctrl-click to open` } : {},
              }).range(node.from, node.to),
            );
            // Hide "[", "](url "title")" leaving only the link text.
            const marks = node.getChildren("LinkMark");
            if (marks.length >= 2) {
              hideInline(marks[0].from, marks[0].to);
              hideInline(marks[1].from, node.to);
            }
            return false;
          }
          case "URL":
            if (node.parent?.name !== "Link") decos.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
            break;
          case "Blockquote":
            for (let pos = node.from; pos <= node.to; ) {
              const line = state.doc.lineAt(pos);
              lineClass(line.from, "cm-md-quote");
              pos = line.to + 1;
            }
            break;
          case "QuoteMark": {
            const next = state.doc.sliceString(node.to, node.to + 1);
            hideBlock(hide, node.from, next === " " ? node.to + 1 : node.to);
            break;
          }
          case "FencedCode":
          case "CodeBlock":
            for (let pos = node.from; pos <= node.to; ) {
              const line = state.doc.lineAt(pos);
              const fence = name === "FencedCode" && (line.from === node.from || line.to === node.to) && /^\s*(```|~~~)/.test(line.text);
              lineClass(line.from, fence ? "cm-md-codeblock cm-md-fence" : "cm-md-codeblock");
              pos = line.to + 1;
            }
            return false;
          case "HorizontalRule":
            hideBlock(Decoration.replace({ widget: new RuleWidget() }), node.from, node.to);
            break;
          case "ListMark": {
            const item = node.parent;
            if (!item) break;
            const depth = listDepth(node);
            const line = state.doc.lineAt(node.from);
            const ordered = item.parent?.name === "OrderedList";
            lineClass(line.from, "cm-md-li", { style: `--depth:${depth}` });
            const end = state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            // Task items show only their checkbox, as on the rendered page.
            if (item.getChild("Task")) {
              hideBlock(hide, line.from, end);
              break;
            }
            const marker = ordered ? state.doc.sliceString(node.from, node.to) : "•";
            // Hide indentation and the marker; draw the bullet in the margin.
            hideBlock(Decoration.replace({ widget: new BulletWidget(marker, depth) }), line.from, end);
            break;
          }
          case "TaskMarker": {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            const end = state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            hideBlock(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }), node.from, end);
            break;
          }
          case "Table":
            for (let pos = node.from; pos <= node.to; ) {
              const line = state.doc.lineAt(pos);
              lineClass(line.from, "cm-md-table");
              pos = line.to + 1;
            }
            return false;
        }
      },
    });
  }
  inline.sort((a, b) => a.from - b.from);
  return { decorations: Decoration.set(decos, true), atomic: Decoration.set(atomic, true), inline };
}

const plugin = ViewPlugin.fromClass(
  class {
    built: Built;
    constructor(view: EditorView) {
      this.built = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.built = buildDecorations(update.view);
    }
  },
  { decorations: (v) => v.built.decorations },
);

/**
 * Backspace/Delete beside hidden inline markers act on the visible text:
 * e.g. Backspace just after "**bold**" deletes the "d", not a "*".
 */
function deleteVisible(forward: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const built = view.plugin(plugin)?.built;
    // Backspace at the start of a heading, list item or quote: make it a paragraph.
    if (!forward && built) {
      const line = view.state.doc.lineAt(sel.head);
      let marker: { from: number; to: number } | null = null;
      built.atomic.between(line.from, line.from, (from, to) => {
        if (from === line.from && (sel.head === from || sel.head === to)) marker = { from, to };
      });
      const m = marker as { from: number; to: number } | null;
      if (m) {
        view.dispatch({ changes: { from: m.from, to: m.to }, selection: EditorSelection.cursor(m.from), userEvent: "delete.backward" });
        return true;
      }
    }
    const inline = built?.inline ?? [];
    let pos = sel.head;
    let moved = false;
    for (;;) {
      const mark = inline.find((m) => (forward ? m.from === pos : m.to === pos));
      if (!mark) break;
      pos = forward ? mark.to : mark.from;
      moved = true;
    }
    if (!moved) return false;
    const at = forward ? pos : pos - 1;
    if (at < 0 || at >= view.state.doc.length) return false;
    const char = view.state.sliceDoc(at, at + 1);
    if (char === "\n") return false; // let the normal command join lines
    view.dispatch({
      changes: { from: at, to: at + 1 },
      selection: EditorSelection.cursor(forward ? sel.head : sel.head - 1),
      userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
  };
}

// Markers left with nothing inside after a deletion: "****", "**", "~~~~", "``", "[](url)".
const EMPTY = [/\*\*\*\*$/, /(?<![*\w])\*\*$/, /~~~~$/, /``$/, /\[\]\([^)\s]*\)$/];

/** After deleting all the text inside bold, a link and so on, remove the empty markers too. */
const removeEmptyMarkers = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || !tr.isUserEvent("delete")) return tr;
  const doc = tr.newDoc;
  const head = tr.newSelection.main.head;
  const line = doc.lineAt(head);
  const before = doc.sliceString(line.from, head);
  const after = doc.sliceString(head, line.to);
  for (const pattern of EMPTY) {
    // The markers either side of the cursor, e.g. "**|**" or "[|](url)".
    for (let split = 0; split <= Math.min(after.length, 40); split++) {
      const around = before.slice(-40) + after.slice(0, split);
      const m = around.match(pattern);
      if (!m) continue;
      const from = head - Math.min(before.length, 40) + (m.index ?? 0);
      const to = head + split;
      if (from > head || to < head) continue;
      const spec: TransactionSpec = { changes: { from, to }, selection: EditorSelection.cursor(from), sequential: true };
      return [tr, spec];
    }
  }
  return tr;
});

export const liveMarkdown = [
  plugin,
  // Hidden line markers move and delete as one unit.
  EditorView.atomicRanges.of((view) => view.plugin(plugin)?.built.atomic ?? RangeSet.empty),
  Prec.high(
    keymap.of([
      { key: "Backspace", run: deleteVisible(false) },
      { key: "Delete", run: deleteVisible(true) },
    ]),
  ),
  removeEmptyMarkers,
];
