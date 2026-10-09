import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * "Live" Markdown: text is styled as it will look on the page (large
 * headings, bold, italic, bullets, quotes), and the Markdown symbols are
 * hidden on every line except the one being edited. The document itself is
 * never changed, so files keep exactly what was typed.
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

function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state, view.hasFocus);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
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
            if (isActive(node.from)) break;
            const next = state.doc.sliceString(node.to, node.to + 1);
            decos.push(hide.range(node.from, next === " " ? node.to + 1 : node.to));
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
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to));
            break;
          case "CodeMark":
            // Inline code backticks only; fences are styled per line below.
            if (node.parent?.name === "InlineCode" && !isActive(node.from)) decos.push(hide.range(node.from, node.to));
            break;
          case "Link": {
            decos.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
            if (isActive(node.from)) break;
            // Hide "[", "](url "title")" leaving only the link text.
            const marks = node.getChildren("LinkMark");
            if (marks.length >= 2) {
              decos.push(hide.range(marks[0].from, marks[0].to));
              decos.push(hide.range(marks[1].from, node.to));
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
            if (isActive(node.from)) break;
            const next = state.doc.sliceString(node.to, node.to + 1);
            decos.push(hide.range(node.from, next === " " ? node.to + 1 : node.to));
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
            if (!isActive(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            break;
          case "ListMark": {
            const item = node.parent;
            if (!item) break;
            const depth = listDepth(node);
            const line = state.doc.lineAt(node.from);
            const ordered = item.parent?.name === "OrderedList";
            lineClass(line.from, "cm-md-li", { style: `--depth:${depth}` });
            if (isActive(node.from)) {
              lineClass(line.from, "cm-md-li-raw");
              break;
            }
            const end = state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            // Task items show only their checkbox, as on the rendered page.
            if (item.getChild("Task")) {
              decos.push(hide.range(line.from, end));
              break;
            }
            const marker = ordered ? state.doc.sliceString(node.from, node.to) : "•";
            // Hide indentation and the marker; draw the bullet in the margin.
            decos.push(Decoration.replace({ widget: new BulletWidget(marker, depth) }).range(line.from, end));
            break;
          }
          case "TaskMarker": {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            const end = state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, end));
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
  return Decoration.set(decos, true);
}

export const liveMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
