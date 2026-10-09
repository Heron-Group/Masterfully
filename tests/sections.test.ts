import { describe, expect, it } from "vitest";
import {
  demoteHeadings,
  getAiSummary,
  getSection,
  GROUP_SECTIONS,
  replaceSection,
  setAiSummary,
  SOURCE_SECTIONS,
} from "@/lib/content/sections";

const summary = (text: string) => ({
  text,
  generated: "2026-10-10T09:00:00Z",
  model: "claude-opus-5-5",
});

/** Everything before the `## AI summary` heading must be untouched. */
function beforeAi(body: string): string {
  return body.slice(0, body.indexOf("## AI summary"));
}

describe("getSection", () => {
  const body = "## Notes\n\nFirst.\n\n### A sub-point\n\nMore.\n\n## AI summary\n\nGen.\n";

  it("returns a section's content without its heading", () => {
    expect(getSection(body, "Notes", SOURCE_SECTIONS)).toBe("First.\n\n### A sub-point\n\nMore.");
    expect(getSection(body, "AI summary", SOURCE_SECTIONS)).toBe("Gen.");
  });

  it("treats unknown ## headings as part of the section", () => {
    const b = "## Notes\nIntro\n## My own heading\nDetail\n## AI summary\nGen";
    expect(getSection(b, "Notes", SOURCE_SECTIONS)).toBe("Intro\n## My own heading\nDetail");
  });

  it("ignores headings inside fenced code blocks", () => {
    const b = "## Notes\n```md\n## AI summary\nnot real\n```\n## AI summary\nreal";
    expect(getSection(b, "Notes", SOURCE_SECTIONS)).toBe("```md\n## AI summary\nnot real\n```");
    expect(getSection(b, "AI summary", SOURCE_SECTIONS)).toBe("real");
  });

  it("matches headings case-insensitively", () => {
    expect(getSection("## ai Summary\nx", "AI summary", SOURCE_SECTIONS)).toBe("x");
  });

  it("falls back to the preamble for a file with no headings", () => {
    expect(getSection("Hand-written notes\n", "Notes", SOURCE_SECTIONS, { preambleFallback: true })).toBe(
      "Hand-written notes",
    );
    expect(getSection("Hand-written notes\n", "Notes", SOURCE_SECTIONS)).toBe("");
  });
});

describe("replaceSection / setAiSummary", () => {
  it("rewrites only the AI summary, leaving notes byte-for-byte unchanged", () => {
    const notes = "## Notes\n\nLine one  \nwith trailing spaces\n\n## Not a section\n\n- list\n\n";
    const body = `${notes}## AI summary\n\n<!-- generated: 2026-10-09T15:00:00Z -->\n\nOld text.\n`;
    const out = setAiSummary(body, summary("New text."), SOURCE_SECTIONS);
    expect(beforeAi(out)).toBe(notes);
    expect(out).toContain("<!-- generated: 2026-10-10T09:00:00Z; model: claude-opus-5-5 -->");
    expect(out).toContain("New text.");
    expect(out).not.toContain("Old text.");
  });

  it("appends the AI summary when there is none, keeping notes", () => {
    const body = "## Notes\n\nMine.\n";
    const out = setAiSummary(body, summary("Gen."), SOURCE_SECTIONS);
    expect(out.startsWith("## Notes\n\nMine.\n\n## AI summary\n")).toBe(true);
    expect(getAiSummary(out, SOURCE_SECTIONS)).toEqual(summary("Gen."));
  });

  it("keeps a group's overview untouched", () => {
    const body = "## Overview\n\nMy summary of the group.\n";
    const first = setAiSummary(body, summary("One."), GROUP_SECTIONS);
    const second = setAiSummary(first, summary("Two."), GROUP_SECTIONS);
    expect(getSection(second, "Overview", GROUP_SECTIONS)).toBe("My summary of the group.");
    expect(getAiSummary(second, GROUP_SECTIONS)?.text).toBe("Two.");
    expect(second.match(/## AI summary/g)).toHaveLength(1);
  });

  it("cannot be broken by headings in generated text", () => {
    const body = "## Notes\n\nMine.\n";
    const out = setAiSummary(body, summary("# Title\n\n## Notes\n\nFake"), SOURCE_SECTIONS);
    expect(getSection(out, "Notes", SOURCE_SECTIONS)).toBe("Mine.");
    const again = setAiSummary(out, summary("Clean."), SOURCE_SECTIONS);
    expect(getSection(again, "Notes", SOURCE_SECTIONS)).toBe("Mine.");
    expect(getAiSummary(again, SOURCE_SECTIONS)?.text).toBe("Clean.");
  });

  it("rewrites notes without touching the AI summary", () => {
    const ai = "## AI summary\n\n<!-- generated: 2026-10-09T15:00:00Z -->\n\nKeep me.\n";
    const body = `## Notes\n\nOld.\n\n${ai}`;
    const out = replaceSection(body, "Notes", "New notes.", SOURCE_SECTIONS, { position: "start" });
    expect(out).toBe(`## Notes\n\nNew notes.\n\n${ai}`);
  });

  it("puts notes before the AI summary when the notes heading is missing", () => {
    const body = "Loose hand-written notes.\n\n## AI summary\n\nGen.\n";
    const out = replaceSection(body, "Notes", "Edited.", SOURCE_SECTIONS, {
      position: "start",
      preambleFallback: true,
    });
    expect(out).toBe("## Notes\n\nEdited.\n\n## AI summary\n\nGen.\n");
  });

  it("creates a section in an empty body", () => {
    expect(replaceSection("", "Notes", "", SOURCE_SECTIONS, { position: "start" })).toBe("## Notes\n");
    expect(replaceSection("", "Notes", "Hi", SOURCE_SECTIONS, { position: "start" })).toBe(
      "## Notes\n\nHi\n",
    );
  });
});

describe("getAiSummary", () => {
  it("reads the generated comment in either format", () => {
    expect(
      getAiSummary("## AI summary\n<!-- generated: 2026-10-09T15:00:00Z -->\nText", SOURCE_SECTIONS),
    ).toEqual({ text: "Text", generated: "2026-10-09T15:00:00Z" });
    expect(getAiSummary("## Notes\nx", SOURCE_SECTIONS)).toBeNull();
  });
});

describe("demoteHeadings", () => {
  it("demotes # and ## outside code fences only", () => {
    expect(demoteHeadings("# A\n## B\n### C\n```\n## code\n```")).toBe(
      "### A\n### B\n### C\n```\n## code\n```",
    );
  });
});
