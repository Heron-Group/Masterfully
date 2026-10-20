// One format for author names, however they arrive (typed, from a PDF's
// properties, a publisher's page or a DOI record): "Surname, Given names",
// with initials as "A." and names in normal capitals.
//
//   "Tim Ingold" / "INGOLD, TIM" / "ingold, tim"  → "Ingold, Tim"
//   "Schön, Donald A" / "Schön, D.A."              → "Schön, Donald A." / "Schön, D. A."
//   "Sanders EBN" (Vancouver style)               → "Sanders, E. B. N."
//   "Ludwig van Beethoven"                         → "van Beethoven, Ludwig"
// Single names ("Plato") and organisations without a comma stay as they are.

const PARTICLES = /^(van|von|de|der|den|da|di|du|la|le|del|della|dos|das|ter|ten|bin|ibn|al)$/i;
/** Footnote marks and affiliation numbers stuck to names: "Ann Tester1,2*". */
const MARKS = /[\d*†‡§¶#]+$/;

/** "INGOLD" → "Ingold"; "o'neill" → "O'Neill"; "mcdonald" → "McDonald"; leaves mixed case ("McKay", "DiCaprio") alone. */
function fixCase(word: string): string {
  if (!word || /\p{Ll}.*\p{Lu}|\p{Lu}.*\p{Ll}/u.test(word)) return word; // already mixed case
  if (PARTICLES.test(word)) return word.toLowerCase();
  return word
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/^Mc(\p{Ll})/u, (_, ch: string) => `Mc${ch.toUpperCase()}`);
}

/** Given names: "donald a" → "Donald A."; "D.A." → "D. A."; "E.B.-N." → "E. B.-N.". */
function formatGiven(given: string): string {
  return given
    .replace(/\.(?=\p{L})/gu, ". ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^\p{L}$/u.test(w)) return `${w.toUpperCase()}.`; // a lone initial
      if (/^(\p{L}\.)+(-\p{L}\.)*$/u.test(w)) return w.toUpperCase(); // "A." or "B.-N."
      return fixCase(w);
    })
    .join(" ");
}

function formatFamily(family: string): string {
  return family
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i, all) => (i < all.length - 1 && PARTICLES.test(w) ? w.toLowerCase() : fixCase(w)))
    .join(" ");
}

export function formatAuthorName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim().replace(/^by\s+/i, "");
  // Marks can be several, with commas between ("Tester1,2*").
  for (let prev = ""; prev !== name; ) {
    prev = name;
    name = name.replace(MARKS, "").replace(/[\s,;]+$/, "");
  }
  if (!name) return "";

  if (name.includes(",")) {
    const [family, ...rest] = name.split(",");
    const given = rest.join(" ").trim();
    return given ? `${formatFamily(family.trim())}, ${formatGiven(given)}` : formatFamily(family.trim());
  }

  const parts = name.split(" ");
  if (parts.length < 2) return fixCase(name);
  // "Sanders EBN" / "Ingold T." (surname first, then capital initials): Vancouver style.
  const last = parts[parts.length - 1];
  if (parts.length === 2 && /^(\p{Lu}\.?){1,3}$/u.test(last) && !/^\p{Lu}+$/u.test(parts[0])) {
    return `${formatFamily(parts[0])}, ${formatGiven(last.replace(/\./g, "").split("").join(" "))}`;
  }
  // "Given Middle Family", keeping particles with the surname.
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.test(parts[i - 1])) i--;
  return `${formatFamily(parts.slice(i).join(" "))}, ${formatGiven(parts.slice(0, i).join(" "))}`;
}

/** Several names, tidied, without blanks or repeats. */
export function formatAuthors(names: string[]): string[] {
  return [...new Set(names.map(formatAuthorName).filter(Boolean))];
}
