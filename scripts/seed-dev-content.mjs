#!/usr/bin/env node
// Development only: fill ./.dev-content (or CONTENT_DIR) with sample journal
// entries spread over several weeks, then commit them in the content repo.
// Usage: node scripts/seed-dev-content.mjs [count] [--library]
//   --library also adds a few sample sources and a reading group.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.CONTENT_DIR || ".dev-content");
if (!existsSync(path.join(dir, ".git"))) {
  console.error(`${dir} is not an initialised content repo. Start the app once first.`);
  process.exit(1);
}
const count = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 160);
const withLibrary = process.argv.includes("--library");
const lines = [
  "Studio day. Tried the **folded paper** prototype again; the hinge still tears after a dozen openings.",
  "Reading notes on co-design as *infrastructuring*: the work continues after the workshop ends.",
  "Supervision meeting.\n\n- Narrow the question to graphic language\n- Two case studies, not three\n- Write the methods chapter draft by December",
  "A short one: the colour cards worked better than the word cards.",
  "> Making is a way of thinking, not a way of illustrating thinking.\n\nNeed to find where I read this.",
  "Workshop with the community group. Seven people, two hours. Everyone drew a map of their route to the library; nobody drew the library itself.",
  "Idea for the next iteration:\n\n1. Larger sheets\n2. Fewer prompts\n3. Leave time for silence",
  "Tired. Nothing worked today, which is also data.",
];
const now = Date.now();
const span = 45 * 24 * 3600 * 1000;
for (let i = 0; i < count; i++) {
  const t = new Date(now - span + Math.floor((span * i) / count) + ((i * 7919) % 3600) * 1000);
  const iso = t.toISOString().replace(/\.\d{3}Z$/, "Z");
  const id = iso.replace(/:/g, "-");
  const sub = path.join(dir, "journal", iso.slice(0, 4), iso.slice(5, 7));
  mkdirSync(sub, { recursive: true });
  const body = `${lines[i % lines.length]}\n\n_Sample entry ${i + 1} of ${count}._`;
  writeFileSync(path.join(sub, `${id}.md`), `---\nid: ${id}\ncreated: ${iso}\nupdated: ${iso}\n---\n${body}\n`);
}
if (withLibrary) {
  const sources = [
    ["sanders-2008-co-creation-new", "Co-creation and the new landscapes of design", ["Sanders, Elizabeth B.-N.", "Stappers, Pieter Jan"], 2008, "article", "https://doi.org/10.1080/15710880701875068", "Distinguishes co-creation from co-design.\n\n- Useful framing of **who** designs\n- Map of design research approaches"],
    ["ehn-2008-participation-design-things", "Participation in design things", ["Ehn, Pelle"], 2008, "chapter", "", "Design *Things* as socio-material assemblies. Connects to infrastructuring."],
    ["schon-1983-reflective-practitioner", "The Reflective Practitioner: How Professionals Think in Action", ["Schön, Donald A."], 1983, "book", "", "Reflection-in-action; the conversation with the materials of a situation."],
    ["ingold-2013-making", "Making: Anthropology, Archaeology, Art and Architecture", ["Ingold, Tim"], 2013, "book", "", ""],
  ];
  mkdirSync(path.join(dir, "sources"), { recursive: true });
  mkdirSync(path.join(dir, "groups"), { recursive: true });
  const added = new Date(now - 20 * 24 * 3600 * 1000);
  sources.forEach(([id, title, authors, year, type, url, notes], i) => {
    const iso = new Date(added.getTime() + i * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const fm = [`id: ${id}`, `title: ${JSON.stringify(title)}`, `authors: [ ${authors.map((a) => JSON.stringify(a)).join(", ")} ]`, `year: ${year}`, `type: ${type}`, url ? `url: ${url}` : "", `added: ${iso}`, `updated: ${iso}`].filter(Boolean).join("\n");
    writeFileSync(path.join(dir, "sources", `${id}.md`), `---\n${fm}\n---\n## Notes\n\n${notes}\n`);
  });
  writeFileSync(
    path.join(dir, "groups", "co-design-foundations.md"),
    `---\nid: co-design-foundations\ntitle: "Co-design foundations"\ncreated: ${added.toISOString().replace(/\.\d{3}Z$/, "Z")}\nupdated: ${added.toISOString().replace(/\.\d{3}Z$/, "Z")}\nsources:\n  - id: sanders-2008-co-creation-new\n    note: "The vocabulary I keep returning to"\n  - id: ehn-2008-participation-design-things\n    note: "Infrastructuring and design Things"\n  - id: schon-1983-reflective-practitioner\n---\n## Overview\n\nFoundational texts on participation and co-design that frame the methods chapter.\n`,
  );
}
execFileSync("git", ["add", "-A"], { cwd: dir });
execFileSync("git", ["-c", "user.name=Seed", "-c", "user.email=seed@localhost", "commit", "-q", "-m", `dev: seed ${count} sample journal entries${withLibrary ? " and a sample library" : ""}`], { cwd: dir });
console.log(`Seeded ${count} journal entries${withLibrary ? " and a sample library" : ""} in ${dir}`);
