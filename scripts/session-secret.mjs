#!/usr/bin/env node
// Print a new SESSION_SECRET. Usage: npm run session-secret
import { randomBytes } from "node:crypto";

console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
