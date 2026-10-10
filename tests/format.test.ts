import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { formatKeymap } from "@/components/live-editor/format-commands";

function run(key: string, doc: string, from: number, to = from) {
  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  const command = formatKeymap.find((k) => k.key === key)!.run;
  command({ state, dispatch: (tr: Transaction) => (state = tr.state) });
  const sel = state.selection.main;
  return { doc: state.doc.toString(), selected: state.sliceDoc(sel.from, sel.to), cursor: sel.head };
}

describe("formatting shortcuts", () => {
  it("bold wraps the selection and keeps it selected", () => {
    expect(run("Mod-b", "make this bold", 10, 14)).toMatchObject({ doc: "make this **bold**", selected: "bold" });
  });
  it("bold again removes it", () => {
    expect(run("Mod-b", "make this **bold**", 12, 16)).toMatchObject({ doc: "make this bold", selected: "bold" });
    expect(run("Mod-b", "make this **bold**", 10, 18)).toMatchObject({ doc: "make this bold", selected: "bold" });
  });
  it("with nothing selected, inserts the pair with the cursor inside", () => {
    expect(run("Mod-i", "a ", 2)).toMatchObject({ doc: "a **", cursor: 3 });
  });
  it("link puts the cursor in the url", () => {
    expect(run("Mod-k", "see paper", 4, 9)).toMatchObject({ doc: "see [paper]()", cursor: 12 });
  });
  it("code and strikethrough", () => {
    expect(run("Mod-e", "x", 0, 1).doc).toBe("`x`");
    expect(run("Mod-Shift-x", "x", 0, 1).doc).toBe("~~x~~");
  });
});
