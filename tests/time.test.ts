import { describe, expect, it } from "vitest";
import { journalIdFor, sourceSlug } from "@/lib/content/ids";
import {
  formatCommitTime,
  formatDayHeading,
  formatTime,
  londonDateKey,
  londonDayStartUtc,
} from "@/lib/time";

describe("Europe/London display", () => {
  it("formats in British Summer Time and GMT", () => {
    expect(formatDayHeading("2026-10-09T14:32:05Z")).toBe("Friday 9 October 2026");
    expect(formatTime("2026-10-09T14:32:05Z")).toBe("15:32");
    expect(formatTime("2026-12-01T14:32:05Z")).toBe("14:32");
    expect(formatCommitTime("2026-10-09T14:32:05Z")).toBe("2026-10-09 15:32");
  });

  it("puts late-night UTC times on the right London day", () => {
    expect(londonDateKey("2026-07-01T23:30:00Z")).toBe("2026-07-02");
    expect(londonDateKey("2026-12-01T23:30:00Z")).toBe("2026-12-01");
  });

  it("finds the UTC start of a London day across clock changes", () => {
    expect(londonDayStartUtc("2026-07-02")).toBe("2026-07-01T23:00:00Z");
    expect(londonDayStartUtc("2026-12-01")).toBe("2026-12-01T00:00:00Z");
    expect(londonDayStartUtc("2026-03-29")).toBe("2026-03-29T00:00:00Z"); // clocks go forward at 01:00
    expect(londonDayStartUtc("2026-10-25")).toBe("2026-10-24T23:00:00Z"); // clocks go back at 02:00
    expect(londonDayStartUtc("nonsense")).toBeNull();
  });

  it("tolerates invalid dates", () => {
    expect(formatTime("garbage")).toBe("");
    expect(formatDayHeading("garbage")).toBe("garbage");
  });
});

describe("ids", () => {
  it("builds journal ids from UTC time", () => {
    expect(journalIdFor(new Date("2026-10-09T14:32:05.123Z"))).toBe("2026-10-09T14-32-05Z");
  });

  it("builds source slugs from surname, year and title", () => {
    expect(sourceSlug({ title: "Graphic Language", authors: ["Brody, Ann"], year: 2025 })).toBe(
      "brody-2025-graphic-language",
    );
    expect(sourceSlug({ title: "Écrits sur l'art", authors: ["Anne Müller"] })).toBe(
      "muller-ecrits-sur-art",
    );
    expect(sourceSlug({ title: "!!!", authors: [] })).toBe("source");
  });
});
