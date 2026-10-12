import { describe, expect, it } from "vitest";
import { detailsFromCsl, detailsFromHtml, detailsFromPdf, findDoi, mergeDetails, normaliseAuthor, splitAuthors, yearFrom } from "@/lib/sources/details-parse";

describe("reading a source's details", () => {
  it("finds DOIs in text and links", () => {
    expect(findDoi("Available at https://doi.org/10.1080/15710880701875068.")).toBe("10.1080/15710880701875068");
    expect(findDoi("https://www.tandfonline.com/doi/full/10.1080/15710880701875068")).toBe("10.1080/15710880701875068");
    expect(findDoi("https://example.org/10.1234%2Fabc.5/pdf")).toBe("10.1234/abc.5");
    expect(findDoi("No identifier here")).toBeUndefined();
  });

  it("puts names in the library's format", () => {
    expect(normaliseAuthor("Tim Ingold")).toBe("Ingold, Tim");
    expect(normaliseAuthor("Ingold, Tim")).toBe("Ingold, Tim");
    expect(normaliseAuthor("Ludwig van Beethoven")).toBe("van Beethoven, Ludwig");
    expect(splitAuthors("Elizabeth Sanders and Pieter Jan Stappers")).toEqual(["Sanders, Elizabeth", "Stappers, Pieter Jan"]);
    expect(yearFrom("2008-03-01")).toBe(2008);
    expect(yearFrom("3000")).toBeUndefined();
  });

  it("reads a DOI record (CSL JSON, including Crossref's type names)", () => {
    const d = detailsFromCsl({
      type: "journal-article",
      title: "Co-creation and the new landscapes of design",
      author: [
        { given: "Elizabeth B.-N.", family: "Sanders" },
        { given: "Pieter Jan", family: "Stappers" },
      ],
      issued: { "date-parts": [[2008, 3]] },
      DOI: "10.1080/15710880701875068",
    });
    expect(d).toEqual({
      title: "Co-creation and the new landscapes of design",
      authors: ["Sanders, Elizabeth B.-N.", "Stappers, Pieter Jan"],
      year: 2008,
      type: "article",
      doi: "10.1080/15710880701875068",
    });
    expect(detailsFromCsl({ type: "book-chapter", title: ["A chapter"], editor: [{ literal: "Jane Doe" }] })).toMatchObject({ type: "chapter", authors: ["Doe, Jane"] });
    expect(detailsFromCsl({ type: "monograph", title: "Making" }).type).toBe("book");
  });

  it("reads publishers' citation tags from a page", () => {
    const html = `<html><head><title>Making | Routledge</title>
      <meta name="citation_title" content="Making: Anthropology, Archaeology, Art and Architecture">
      <meta name="citation_author" content="Ingold, Tim">
      <meta name="citation_publication_date" content="2013/04/15">
      <meta name="citation_isbn" content="9780415567237">
      <meta name="citation_doi" content="10.4324/9780203559055">
      </head><body></body></html>`;
    expect(detailsFromHtml(html)).toEqual({
      title: "Making: Anthropology, Archaeology, Art and Architecture",
      authors: ["Ingold, Tim"],
      year: 2013,
      type: "book",
      doi: "10.4324/9780203559055",
    });
    const article = `<meta name="citation_title" content="A paper"><meta name="citation_author" content="Ann Tester"><meta name="citation_author" content="Bo Writer"><meta name="citation_journal_title" content="CoDesign">`;
    expect(detailsFromHtml(article)).toMatchObject({ type: "article", authors: ["Tester, Ann", "Writer, Bo"] });
  });

  it("falls back to JSON-LD, Open Graph and the page title for ordinary web pages", () => {
    const html = `<html><head><title>Fallback title</title>
      <meta property="og:title" content="Why making matters">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Why making matters","author":{"@type":"Person","name":"Ann Tester"},"datePublished":"2021-05-04"}</script>
      </head></html>`;
    expect(detailsFromHtml(html, "https://example.org/post")).toEqual({ title: "Why making matters", authors: ["Tester, Ann"], year: 2021, type: "web", doi: undefined });
    expect(detailsFromHtml("<title>Just a page</title>")).toMatchObject({ title: "Just a page", type: "web" });
  });

  it("reads a PDF's properties, ignoring file names and creation dates", () => {
    const text = "A thesis submitted for the degree of Doctor of Philosophy\n© 2019 Ann Tester\nhttps://doi.org/10.5555/12345678";
    expect(detailsFromPdf({ Title: "Material thinking", Author: "Ann Tester", CreationDate: "D:20240101" }, text)).toEqual({
      title: "Material thinking",
      authors: ["Tester, Ann"],
      year: 2019,
      type: "thesis",
      doi: "10.5555/12345678",
    });
    expect(detailsFromPdf({ Title: "Microsoft Word - draft3.docx", Author: "admin" }, "")).toEqual({
      title: undefined,
      authors: undefined,
      year: undefined,
      type: undefined,
      doi: undefined,
    });
  });

  it("prefers the DOI record, then fills gaps from the file", () => {
    expect(mergeDetails({ title: "From DOI", authors: [] }, { title: "From PDF", authors: ["Tester, Ann"], year: 2001 })).toEqual({
      title: "From DOI",
      authors: ["Tester, Ann"],
      year: 2001,
    });
  });
});
