#!/usr/bin/env node
// Generate APP_PASSWORD_HASH (bcrypt) and, if needed, a SESSION_SECRET.
// Usage: npm run hash-password            (prompts, input hidden)
//        echo -n 'pw' | npm run hash-password --silent
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, "");
  }
  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let pw = "";
  return new Promise((resolve) => {
    process.stdin.on("data", (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(pw);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        pw = pw.slice(0, -1);
      } else {
        pw += ch;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);

console.log(`
For Plesk's environment variables panel (paste as-is):
  APP_PASSWORD_HASH = ${hash}

For a .env file (each $ escaped, because Next.js expands $VARS in .env files):
  APP_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}

If you don't have a session secret yet:
  SESSION_SECRET=${randomBytes(32).toString("base64url")}
`);
