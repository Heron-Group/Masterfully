import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AI_KEY_FILE, USERS_DIR } from "../accounts";
import { serverConfig } from "../config";
import { writeAtomicFile } from "../content/atomic";

/**
 * Each user's AI provider settings and API keys, in their own folder
 * (users/<id>/ai-key.json, readable only by the app's account). Keys are
 * encrypted with AES-256-GCM under a key derived from SESSION_SECRET, so a
 * copy of the folder alone is not enough to read them, and they are never
 * included in the user's data download.
 *
 * Changing SESSION_SECRET makes saved keys unreadable; users then add their
 * key again.
 */

export type AiProvider = "anthropic" | "openai";
export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai"];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.5",
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
};

type Encrypted = { iv: string; tag: string; data: string };
type StoredKey = { secret: Encrypted; hint: string; updated: string };

type StoredConfig = {
  version: 1;
  provider: AiProvider | null;
  models: Partial<Record<AiProvider, string>>;
  keys: Partial<Record<AiProvider, StoredKey>>;
};

/** What the settings page may show: never the key itself. */
export type AiSettingsView = {
  provider: AiProvider | null;
  models: Record<AiProvider, string>;
  keys: Record<AiProvider, { hint: string; updated: string; readable: boolean } | null>;
};

/** Everything needed to call the user's chosen provider. */
export type AiCredentials = { provider: AiProvider; model: string; apiKey: string };

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  // "research-portal" is the app's original name. It is part of the key, so
  // it stays: changing it would make every saved API key unreadable.
  return Buffer.from(hkdfSync("sha256", secret, "research-portal", "ai-api-keys v1", 32));
}

export function encryptSecret(plain: string, key = encryptionKey()): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/** The plain text, or null if it can't be decrypted (wrong key or tampered). */
export function decryptSecret(enc: Encrypted, key = encryptionKey()): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(enc.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "sk-ant-…a1b2": enough to recognise a key, not enough to use it. */
export function keyHint(key: string): string {
  const k = key.trim();
  const prefix = k.match(/^(sk-ant-|sk-proj-|sk-)/)?.[0] ?? "";
  return `${prefix}…${k.slice(-4)}`;
}

function filePath(userId: string, dir = serverConfig().contentDir): string {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error("Invalid user id");
  return path.join(dir, USERS_DIR, userId, AI_KEY_FILE);
}

const empty = (): StoredConfig => ({ version: 1, provider: null, models: {}, keys: {} });

async function read(userId: string): Promise<StoredConfig> {
  const raw = await fs.readFile(filePath(userId), "utf8").catch(() => null);
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as StoredConfig;
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

async function write(userId: string, config: StoredConfig): Promise<void> {
  await writeAtomicFile(filePath(userId), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function getAiSettings(userId: string): Promise<AiSettingsView> {
  const c = await read(userId);
  const key = encryptionKeyOrNull();
  const view = (p: AiProvider) => {
    const k = c.keys[p];
    return k ? { hint: k.hint, updated: k.updated, readable: !!key && decryptSecret(k.secret, key) !== null } : null;
  };
  return {
    provider: c.provider,
    models: {
      anthropic: c.models.anthropic || DEFAULT_MODELS.anthropic,
      openai: c.models.openai || DEFAULT_MODELS.openai,
    },
    keys: { anthropic: view("anthropic"), openai: view("openai") },
  };
}

function encryptionKeyOrNull(): Buffer | null {
  try {
    return encryptionKey();
  } catch {
    return null;
  }
}

/** The chosen provider, model and decrypted key, or null if not set up. */
export async function getAiCredentials(userId: string): Promise<AiCredentials | null> {
  const c = await read(userId);
  if (!c.provider) return null;
  const stored = c.keys[c.provider];
  const key = encryptionKeyOrNull();
  const apiKey = stored && key ? decryptSecret(stored.secret, key) : null;
  if (!apiKey) return null;
  return { provider: c.provider, model: c.models[c.provider] || DEFAULT_MODELS[c.provider], apiKey };
}

export type AiSettingsUpdate = {
  provider?: AiProvider;
  model?: string;
  /** A new key for `provider`; empty string removes it. */
  apiKey?: string;
};

export async function updateAiSettings(userId: string, update: AiSettingsUpdate): Promise<void> {
  const c = await read(userId);
  const provider = update.provider ?? c.provider;
  if (update.provider) c.provider = update.provider;
  if (provider && update.model !== undefined) {
    const model = update.model.trim();
    if (model.length > 100 || /\s/.test(model)) throw new Error("That doesn't look like a model name.");
    if (model && model !== DEFAULT_MODELS[provider]) c.models[provider] = model;
    else delete c.models[provider];
  }
  if (provider && update.apiKey !== undefined) {
    const apiKey = update.apiKey.trim();
    if (!apiKey) {
      delete c.keys[provider];
    } else {
      if (apiKey.length > 500 || /\s/.test(apiKey)) throw new Error("That doesn't look like an API key.");
      c.keys[provider] = { secret: encryptSecret(apiKey), hint: keyHint(apiKey), updated: new Date().toISOString() };
    }
  }
  await write(userId, c);
}
