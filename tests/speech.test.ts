import { describe, expect, it } from "vitest";
import { chunk, countWords, findText, formatClock, formatListeningTime, toSentences } from "@/lib/speech/text";

describe("reading aloud: text", () => {
  it("splits blocks into sentences, keeping the page", () => {
    const s = toSentences([
      { text: "Making is a way of\nthinking. It is not an\nillustration of thinking!", page: 3 },
      { text: "  ", page: 4 },
      { text: "Dr. Brody agrees.", page: 5 },
    ]);
    expect(s.map((x) => x.text)).toEqual(["Making is a way of thinking.", "It is not an illustration of thinking!", "Dr. Brody agrees."]);
    expect(s.map((x) => x.page)).toEqual([3, 3, 5]);
    expect(s[0].words).toBe(6);
  });

  it("doesn't end sentences at academic abbreviations", () => {
    const s = toSentences([{ text: "Sanders et al. (2008) argue this, e.g. in workshops. See p. 12 and Fig. 3 for details." }]);
    expect(s.map((x) => x.text)).toEqual(["Sanders et al. (2008) argue this, e.g. in workshops.", "See p. 12 and Fig. 3 for details."]);
  });

  it("counts words, not punctuation", () => {
    expect(countWords("Hello — world, 2026 …")).toBe(3);
  });

  it("estimates listening time at a speaking pace, adjusted for speed", () => {
    expect(formatListeningTime(155)).toBe("About 1 min");
    expect(formatListeningTime(2170)).toBe("About 14 min");
    expect(formatListeningTime(2170, 2)).toBe("About 7 min");
    expect(formatListeningTime(100)).toBe("About 40 sec");
    expect(formatListeningTime(3)).toBe("About 5 sec");
    expect(formatListeningTime(155 * 75)).toBe("About 1 hr 15 min");
    expect(formatClock(155 * 12.5)).toBe("12:30");
    expect(formatClock(155 * 61)).toBe("1:01:00");
  });

  it("finds a sentence despite different line breaks and case, in order", () => {
    const page = "Intro.\nMaking is a way of\n  thinking. Later: making is a WAY of thinking.";
    const first = findText(page, "Making is a way of thinking.")!;
    expect(page.slice(first.start, first.end)).toBe("Making is a way of\n  thinking.");
    const second = findText(page, "making is a way of thinking.", first.end)!;
    expect(page.slice(second.start, second.end)).toBe("making is a WAY of thinking.");
    expect(findText(page, "Not on this page.")).toBeNull();
  });

  it("groups sentences into passages for the natural voice, never across pages", () => {
    const s = toSentences([
      { text: "One two. Three four. Five six.", page: 1 },
      { text: "Seven eight.", page: 2 },
    ]);
    expect(chunk(s, 20)).toEqual([[0, 1], [2], [3]]);
    expect(chunk(s, 1000)).toEqual([[0, 1, 2], [3]]);
  });
});
