#!/usr/bin/env node
// Development only: fill ./.dev-content (or CONTENT_DIR) with sample journal
// entries spread over several weeks, then commit them in the content repo.
// Usage: node scripts/seed-dev-content.mjs [count]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.CONTENT_DIR || ".dev-content");
if (!existsSync(path.join(dir, ".git"))) {
  console.error(`${dir} is not an initialised content repo. Start the app once first.`);
  process.exit(1);
}
const count = Number(process.argv[2] ?? 160);
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
execFileSync("git", ["add", "-A"], { cwd: dir });
execFileSync("git", ["-c", "user.name=Seed", "-c", "user.email=seed@localhost", "commit", "-q", "-m", `dev: seed ${count} sample journal entries`], { cwd: dir });
console.log(`Seeded ${count} journal entries in ${dir}`);
