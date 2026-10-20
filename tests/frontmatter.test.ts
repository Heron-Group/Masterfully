import { describe, expect, it } from "vitest";
import { isoDate, num, parseFile, str, stringifyFile, strList } from "@/lib/content/frontmatter";
import {
  parseGroup,
  parseJournalEntry,
  parseSource,
  serializeJournalEntry,
  serializeSource,
} from "@/lib/content/schemas";

const meta = (id: string, dir: string) => ({
  id,
  path: `${dir}/${id}.md`,
  fallbackDate: "2026-01-01T00:00:00Z",
});

describe("parseFile", () => {
  it("keeps timestamps as strings rather than Date objects", () => {
    const { data } = parseFile("---\ncreated: 2026-10-09T14:32:05Z\nyear: 2025\n---\nBody\n");
    expect(data.created).toBe("2026-10-09T14:32:05Z");
    expect(data.year).toBe(2025);
  });

  it("handles files with no frontmatter", () => {
    const parsed = parseFile("Just some text\n");
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("Just some text\n");
    expect(parsed.error).toBeUndefined();
  });

  it("returns an error instead of throwing on broken YAML", () => {
    const raw = "---\ntitle: [unclosed\nauthors: : :\n---\nBody\n";
    const parsed = parseFile(raw);
    expect(parsed.error).toBeTruthy();
    expect(parsed.body).toBe(raw);
  });

  it("treats non-object frontmatter as empty", () => {
    expect(parseFile("---\n- a\n- b\n---\nx").data).toEqual({});
  });
});

describe("stringifyFile", () => {
  it("writes ISO dates unquoted and round-trips", () => {
    const out = stringifyFile({ id: "x", created: "2026-10-09T14:32:05Z" }, "Hello");
    expect(out).toBe("---\nid: x\ncreated: 2026-10-09T14:32:05Z\n---\nHello\n");
    expect(parseFile(out).data.created).toBe("2026-10-09T14:32:05Z");
  });

  it("writes flow lists for the given keys and quotes when needed", () => {
    const out = stringifyFile(
      { authors: ["Surname, Firstname", "Other, A"], title: "Colon: a title" },
      "",
      { flow: ["authors"] },
    );
    expect(out).toContain('authors: [ "Surname, Firstname", "Other, A" ]');
    expect(parseFile(out).data.title).toBe("Colon: a title");
  });

  it("omits undefined fields", () => {
    expect(stringifyFile({ a: 1, b: undefined }, "")).toBe("---\na: 1\n---\n");
  });
});

describe("field readers", () => {
  it("are tolerant of wrong types", () => {
    expect(str(undefined)).toBe("");
    expect(str(12)).toBe("12");
    expect(num("2025")).toBe(2025);
    expect(num("n.d.")).toBeUndefined();
    expect(strList("Solo, Author")).toEqual(["Solo, Author"]);
    expect(strList([1, "", "B"])).toEqual(["1", "B"]);
    expect(isoDate("not a date", "fallback")).toBe("fallback");
    expect(isoDate("2026-10-09", "f")).toBe("2026-10-09T00:00:00Z");
  });
});

describe("journal entries", () => {
  it("parses the documented example", () => {
    const raw = `---
id: 2026-10-09T14-32-05Z
created: 2026-10-09T14:32:05Z
updated: 2026-10-09T14:32:05Z
attachments:
  - file: attachments/journal/2026-10-09T14-32-05Z/sketch.jpg
    name: sketch.jpg
    type: image/jpeg
    size: 482113
---
Entry body in Markdown.
`;
    const entry = parseJournalEntry(raw, meta("2026-10-09T14-32-05Z", "journal/2026/10"));
    expect(entry.created).toBe("2026-10-09T14:32:05Z");
    expect(entry.attachments).toEqual([
      {
        file: "attachments/journal/2026-10-09T14-32-05Z/sketch.jpg",
        name: "sketch.jpg",
        type: "image/jpeg",
        size: 482113,
      },
    ]);
    expect(entry.body).toBe("Entry body in Markdown.");
    expect(serializeJournalEntry(entry)).toBe(raw);
  });

  it("falls back to the id for a missing created date and ignores bad attachments", () => {
    const entry = parseJournalEntry(
      "---\nattachments: nope\n---\nHi",
      meta("2026-03-01T09-00-00Z", "journal/2026/03"),
    );
    expect(entry.created).toBe("2026-03-01T09:00:00Z");
    expect(entry.updated).toBe("2026-03-01T09:00:00Z");
    expect(entry.attachments).toEqual([]);
  });

  it("keeps an entry with unreadable frontmatter and flags it", () => {
    const entry = parseJournalEntry(
      "---\ncreated: [oops\n---\nText",
      meta("2026-03-01T09-00-00Z", "journal/2026/03"),
    );
    expect(entry.problem).toBeTruthy();
    expect(entry.body).toContain("Text");
  });
});

describe("sources", () => {
  const raw = `---
id: brody-2025-graphic-language
title: "Full title of the source"
authors: ["Surname, Firstname"]
year: 2025
type: article # book | chapter | article | report | web | thesis | other
url: https://example.org/paper
pdf: attachments/sources/brody-2025-graphic-language.pdf
added: 2026-10-09T14:32:05Z
updated: 2026-10-09T14:32:05Z
---
## Notes
My notes in Markdown.

## AI summary
<!-- generated: 2026-10-09T15:00:00Z -->
Generated text, replaced on regeneration.
`;

  it("parses the documented example", () => {
    const s = parseSource(raw, meta("brody-2025-graphic-language", "sources"));
    expect(s.title).toBe("Full title of the source");
    expect(s.authors).toEqual(["Surname, Firstname"]);
    expect(s.year).toBe(2025);
    expect(s.type).toBe("article");
    expect(s.url).toBe("https://example.org/paper");
    expect(s.pdf).toBe("attachments/sources/brody-2025-graphic-language.pdf");
    expect(s.notes).toBe("My notes in Markdown.");
    expect(s.aiSummary).toEqual({
      text: "Generated text, replaced on regeneration.",
      generated: "2026-10-09T15:00:00Z",
    });
  });

  it("reads one url/pdf (older files) or links/pdfs lists, and writes lists", () => {
    const old = parseSource(raw, meta("brody-2025-graphic-language", "sources"));
    expect(old.links).toEqual(["https://example.org/paper"]);
    expect(old.pdfs).toEqual(["attachments/sources/brody-2025-graphic-language.pdf"]);
    const out = serializeSource(old);
    expect(out).toMatch(/^links:\n  - https:\/\/example\.org\/paper$/m);
    expect(out).not.toMatch(/^url:/m);
    expect(out).not.toMatch(/^pdf:/m);

    const both = parseSource(
      raw.replace("pdf: attachments", "links:\n  - https://example.org/paper\n  - https://other.example/b\npdf: attachments"),
      meta("brody-2025-graphic-language", "sources"),
    );
    expect(both.links).toEqual(["https://example.org/paper", "https://other.example/b"]);
    expect(both.url).toBe("https://example.org/paper");
  });

  it("re-serialises without losing the body or unknown fields", () => {
    const s = parseSource(
      raw.replace("year: 2025", "year: 2025\ndoi: 10.1000/xyz"),
      meta("brody-2025-graphic-language", "sources"),
    );
    expect(s.extra).toEqual({ doi: "10.1000/xyz" });
    const out = serializeSource(s);
    expect(out).toContain("doi: 10.1000/xyz");
    expect(out).toContain("## Notes\nMy notes in Markdown.\n\n## AI summary");
    expect(parseSource(out, meta("brody-2025-graphic-language", "sources"))).toMatchObject({
      title: s.title,
      authors: s.authors,
      notes: s.notes,
    });
  });

  it("survives missing and malformed fields", () => {
    const s = parseSource("---\nyear: soon\ntype: podcast\nauthors: Single Author\n---\nLoose notes", meta("x", "sources"));
    expect(s.title).toBe("x");
    expect(s.year).toBeUndefined();
    expect(s.type).toBe("other");
    expect(s.authors).toEqual(["Author, Single"]); // in the library's one name format
    expect(s.notes).toBe("Loose notes");
    expect(s.aiSummary).toBeNull();
  });
});

describe("groups", () => {
  it("parses ordered source refs, tolerating bare ids and duplicates", () => {
    const g = parseGroup(
      `---
title: "Co-design foundations"
sources:
  - id: a
    note: "Why A matters"
  - b
  - id: a
  - note: missing id
---
## Overview
Mine.
`,
      meta("co-design-foundations", "groups"),
    );
    expect(g.sources).toEqual([
      { id: "a", note: "Why A matters" },
      { id: "b", note: "" },
    ]);
    expect(g.overview).toBe("Mine.");
  });
});
