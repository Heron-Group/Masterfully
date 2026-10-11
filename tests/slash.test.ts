import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { filterCommands, FORMAT_COMMANDS, SLASH_COMMANDS } from "@/components/live-editor/slash";

/** Enough of an EditorView for the commands: state and dispatch. */
function fakeView(doc: string, from: number, to = from) {
  const view = {
    state: EditorState.create({ doc, selection: EditorSelection.range(from, to) }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view;
}
const run = (id: string, doc: string, from: number, to = from, list = SLASH_COMMANDS) => {
  const view = fakeView(doc, from, to);
  list.find((c) => c.id === id)!.run!(view as never);
  return view.state.doc.toString();
};

describe("the / menu and right-click styling", () => {
  it("filters by name and keywords, with Paragraph first", () => {
    expect(SLASH_COMMANDS[0].label).toBe("Paragraph");
    expect(filterCommands("head").map((c) => c.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterCommands("sou").map((c) => c.id)).toEqual(["source"]);
    expect(filterCommands("zzz")).toEqual([]);
  });

  it("turns lines into headings, lists, quotes or back into paragraphs", () => {
    expect(run("h2", "Key ideas", 3)).toBe("## Key ideas");
    expect(run("paragraph", "## Key ideas", 5)).toBe("Key ideas");
    expect(run("bullet", "> quoted", 4)).toBe("- quoted");
    // Every selected line; numbered 1, 2, 3; blank lines left alone.
    expect(run("number", "one\ntwo\n\nthree", 0, 13, FORMAT_COMMANDS)).toBe("1. one\n2. two\n\n3. three");
    expect(run("paragraph", "- [ ] a\n- b", 0, 11, FORMAT_COMMANDS)).toBe("a\nb");
  });

  it("styles selected text from the right-click menu", () => {
    expect(run("bold", "make this bold", 5, 9, FORMAT_COMMANDS)).toBe("make **this** bold");
    expect(run("italic", "make *this* bold", 6, 10, FORMAT_COMMANDS)).toBe("make this bold");
  });
});
