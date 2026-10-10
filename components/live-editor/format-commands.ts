import { EditorSelection, type StateCommand } from "@codemirror/state";

/**
 * Formatting shortcuts for the live editor. Each wraps the selection in
 * Markdown markers, or removes them if the selection is already wrapped;
 * with no selection it inserts the pair and puts the cursor between.
 */
function toggleWrap(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const len = marker.length;
    const change = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - len, range.from);
      const after = state.sliceDoc(range.to, range.to + len);
      const inner = state.sliceDoc(range.from, range.to);
      // Already wrapped just outside the selection: unwrap.
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from, insert: "" },
            { from: range.to, to: range.to + len, insert: "" },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        };
      }
      // The selection includes the markers: unwrap.
      if (inner.length >= 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: inner.slice(len, -len) },
          range: EditorSelection.range(range.from, range.to - 2 * len),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      };
    });
    dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** Cmd/Ctrl+K: turn the selection into [text](url) with the cursor in the url. */
const insertLink: StateCommand = ({ state, dispatch }) => {
  const change = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    const cursor = text ? range.from + text.length + 3 : range.from + 1;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
  dispatch(state.update(change, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

export const formatKeymap = [
  { key: "Mod-b", run: toggleWrap("**") },
  { key: "Mod-i", run: toggleWrap("*") },
  { key: "Mod-e", run: toggleWrap("`") },
  { key: "Mod-Shift-x", run: toggleWrap("~~") },
  { key: "Mod-k", run: insertLink },
];
