import { findText } from "@/lib/speech/text";

// Finding text on the page so the sentence being read can be highlighted
// (with the CSS Custom Highlight API, which doesn't change the page's DOM)
// and kept in view.

const BLOCK = /^(P|H[1-6]|LI|DIV|BLOCKQUOTE|PRE|FIGCAPTION|TD|TH|TR|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|TABLE|FIGURE)$/;

export type TextIndex = {
  text: string;
  /** For each character of `text`: the text node and offset it came from. */
  points: Array<[Text, number]>;
  /** Where the last match ended, so repeated sentences are found in order. */
  cursor: number;
  /** Cursors from before the last resetCursors() are ignored. */
  epoch: number;
};

const cache = new WeakMap<Element, TextIndex>();
let epoch = 0;

/**
 * The text of an element as read aloud, with block boundaries and line
 * breaks as newlines. Elements matching `skip` are left out.
 */
export function indexText(root: Element, skip?: string): TextIndex {
  const hit = cache.get(root);
  if (hit) {
    if (hit.epoch !== epoch) {
      hit.epoch = epoch;
      hit.cursor = 0;
    }
    return hit;
  }
  let text = "";
  const points: Array<[Text, number]> = [];
  let last: [Text, number] | null = null;
  const newline = () => {
    if (last && !text.endsWith("\n")) {
      text += "\n";
      points.push(last);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      for (let i = 0; i < t.data.length; i++) {
        text += t.data[i];
        points.push([t, i]);
      }
      if (t.data.length) last = [t, t.data.length - 1];
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || (skip && el.matches(skip))) return;
    if (el.tagName === "BR") return newline();
    const block = BLOCK.test(el.tagName);
    if (block) newline();
    for (const child of el.childNodes) walk(child);
    if (block) newline();
  };
  walk(root);
  const index = { text, points, cursor: 0, epoch };
  cache.set(root, index);
  return index;
}

/** A Range covering `sentence` in `root`, searching from where the last one ended. */
export function findRange(root: Element, sentence: string, skip?: string): Range | null {
  const index = indexText(root, skip);
  const at = findText(index.text, sentence, index.cursor);
  if (!at) return null;
  index.cursor = at.end;
  const [startNode, startOffset] = index.points[at.start];
  const [endNode, endOffset] = index.points[at.end - 1];
  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset + 1);
  return range;
}

/** Search every page from the top again (when reading starts over). */
export function resetCursors() {
  epoch++;
}

type HighlightWindow = Window & {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS: typeof CSS & { highlights?: Map<string, unknown> };
};

const HIGHLIGHT = "rp-reading";

export function highlight(win: Window, ranges: Range[]) {
  const w = win as HighlightWindow;
  if (!w.Highlight || !w.CSS.highlights) return; // older browsers: no highlight, reading still works
  if (ranges.length) w.CSS.highlights.set(HIGHLIGHT, new w.Highlight(...ranges));
  else w.CSS.highlights.delete(HIGHLIGHT);
}

export function clearHighlight(win: Window | null | undefined) {
  if (win) highlight(win, []);
}

/** Scroll so the range is comfortably in view, if it isn't already. */
export function keepInView(range: Range, scroller: Element | Window) {
  const rect = range.getBoundingClientRect();
  if (!rect.height && !rect.width) return;
  if (scroller instanceof Element) {
    const box = scroller.getBoundingClientRect();
    if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
      scroller.scrollBy({ top: rect.top - box.top - box.height / 3, behavior: "smooth" });
    }
  } else if (rect.top < 40 || rect.bottom > scroller.innerHeight - 40) {
    scroller.scrollBy({ top: rect.top - scroller.innerHeight / 3, behavior: "smooth" });
  }
}
