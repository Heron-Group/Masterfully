import { describe, expect, it } from "vitest";
import { formatAuthorName, formatAuthors } from "@/lib/sources/names";

describe("author names", () => {
  it.each([
    ["Tim Ingold", "Ingold, Tim"],
    ["INGOLD, TIM", "Ingold, Tim"],
    ["ingold, tim", "Ingold, Tim"],
    ["Ingold, Tim", "Ingold, Tim"],
    ["Schön, Donald A", "Schön, Donald A."],
    ["Schön, D.A.", "Schön, D. A."],
    ["Sanders, Elizabeth B.-N.", "Sanders, Elizabeth B.-N."],
    ["Sanders EBN", "Sanders, E. B. N."],
    ["Ingold T.", "Ingold, T."],
    ["Ludwig van Beethoven", "van Beethoven, Ludwig"],
    ["Pieter Jan Stappers", "Stappers, Pieter Jan"],
    ["O'NEILL, MARY", "O'Neill, Mary"],
    ["mcdonald, ann", "McDonald, Ann"],
    ["McKay, Ann", "McKay, Ann"],
    ["Ann Tester1,2*", "Tester, Ann"],
    ["by Ann Tester", "Tester, Ann"],
    ["Plato", "Plato"],
    ["Müller-Brockmann, JOSEF", "Müller-Brockmann, Josef"],
  ])("%s → %s", (raw, expected) => {
    expect(formatAuthorName(raw)).toBe(expected);
  });

  it("drops blanks and repeats", () => {
    expect(formatAuthors(["Tim Ingold", "INGOLD, TIM", " "])).toEqual(["Ingold, Tim"]);
  });
});
