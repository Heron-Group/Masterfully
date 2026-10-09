#!/usr/bin/env node
// After `next build`: make .next/standalone a complete, runnable app.
// The standalone server serves public/ and .next/static only if they are
// copied next to it, and loads .env files from its own folder.
import { cpSync, existsSync, rmSync } from "node:fs";

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) {
  console.error("postbuild: .next/standalone/server.js not found (is output: 'standalone' set?)");
  process.exit(1);
}
rmSync(`${out}/public`, { recursive: true, force: true });
rmSync(`${out}/.next/static`, { recursive: true, force: true });
cpSync("public", `${out}/public`, { recursive: true });
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
// Optional server-side env file (Plesk's environment variables panel is preferred).
if (existsSync(".env.production")) cpSync(".env.production", `${out}/.env.production`);
console.log("postbuild: standalone server ready at .next/standalone/server.js");
