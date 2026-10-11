import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { fakeAiEnabled } from "@/lib/ai/client";
import { describeError } from "@/lib/ai/providers";
import { recordUsage } from "@/lib/ai/usage";
import { getProviderKey } from "@/lib/ai/user-config";
import { currentAccount } from "@/lib/auth";
import { serverConfig } from "@/lib/config";

/**
 * The natural reading voice: speech from OpenAI using the user's own OpenAI
 * key. Each passage's audio is cached (per user, in CACHE_DIR), so playing
 * it again costs nothing.
 */

const MODEL = process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const VOICE = "coral";
const INSTRUCTIONS = "Read clearly and naturally at a steady pace, like an audiobook narrator reading academic writing.";
const MAX_CHARS = 4000;

/** Whether the natural voice is available to this user. */
export async function GET() {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
  const key = await getProviderKey(account.id, "openai");
  return Response.json({ natural: !!key }, { headers: { "Cache-Control": "no-store" } });
}

/** A short silent WAV, for development without an API key (AI_FAKE=1). */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_CHARS) return Response.json({ error: "Nothing to read, or too much at once." }, { status: 400 });

  const apiKey = await getProviderKey(account.id, "openai");
  if (!apiKey) {
    return Response.json({ error: "The natural voice needs an OpenAI API key in Settings → AI summaries." }, { status: 400 });
  }
  if (fakeAiEnabled()) {
    await recordUsage(account.id, { provider: "openai", model: "fake-voice", speechChars: text.length });
    return new Response(new Uint8Array(silentWav(0.3)), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  }

  const hash = createHash("sha256").update(`${MODEL}\n${VOICE}\n${INSTRUCTIONS}\n${text}`).digest("hex");
  const file = path.join(serverConfig().cacheDir, "tts", account.id, `${hash}.mp3`);
  const headers = { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" };
  const cached = await fs.readFile(file).catch(() => null);
  if (cached) return new Response(new Uint8Array(cached), { headers });

  try {
    const client = new OpenAI({ apiKey, maxRetries: 2 });
    const speech = await client.audio.speech.create(
      { model: MODEL, voice: VOICE, input: text, instructions: INSTRUCTIONS, response_format: "mp3" },
      { signal: request.signal },
    );
    const audio = Buffer.from(await speech.arrayBuffer());
    await recordUsage(account.id, { provider: "openai", model: MODEL, speechChars: text.length });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, audio).catch(() => {});
    return new Response(new Uint8Array(audio), { headers });
  } catch (err) {
    const { message } = describeError(err, { provider: "openai", model: MODEL, apiKey: "" });
    return Response.json({ error: message }, { status: 502 });
  }
}
