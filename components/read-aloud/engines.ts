// The two reading voices. Each speaks one passage at a time and can be
// stopped; the player moves through the passages and does the highlighting.

export class Stopped extends Error {
  constructor() {
    super("stopped");
  }
}

export type Engine = {
  /** Speak `text`; resolves when it finishes, rejects with Stopped if stopped. */
  speak(text: string, rate: number, upcoming?: string[]): Promise<void>;
  stop(): void;
};

/** Prefer a British English voice, and the better-sounding ones where offered. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const good = /natural|enhanced|premium|neural|google uk/i;
  return (
    voices.find((v) => v.lang === "en-GB" && good.test(v.name)) ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith("en") && good.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en"))
  );
}

export function deviceVoiceAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * The device's built-in voices (Web Speech API): free and instant. Spoken a
 * sentence at a time, which also avoids Chrome cutting off long passages.
 */
export function deviceEngine(): Engine {
  let reject: ((e: Error) => void) | null = null;
  return {
    speak(text, rate) {
      return new Promise<void>((resolve, rej) => {
        reject = rej;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-GB";
        u.rate = rate;
        const voice = pickVoice();
        if (voice) u.voice = voice;
        u.onend = () => resolve();
        u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? rej(new Stopped()) : resolve());
        window.speechSynthesis.speak(u);
      });
    },
    stop() {
      reject?.(new Stopped());
      reject = null;
      window.speechSynthesis.cancel();
    },
  };
}

/**
 * The natural voice: audio from OpenAI via /api/tts, billed to the user's
 * own key. The next passages are fetched while the current one plays.
 */
export function naturalEngine(): Engine {
  const audioFor = new Map<string, Promise<string>>();
  let audio: HTMLAudioElement | null = null;
  let reject: ((e: Error) => void) | null = null;

  const load = (text: string) => {
    let url = audioFor.get(text);
    if (!url) {
      url = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }).then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `The voice service returned an error (${res.status}).`);
        }
        return URL.createObjectURL(await res.blob());
      });
      url.catch(() => audioFor.delete(text));
      audioFor.set(text, url);
    }
    return url;
  };

  return {
    async speak(text, rate, upcoming = []) {
      const url = await load(text);
      for (const next of upcoming.slice(0, 2)) void load(next).catch(() => {});
      await new Promise<void>((resolve, rej) => {
        reject = rej;
        audio = new Audio(url);
        audio.playbackRate = rate;
        audio.onended = () => resolve();
        audio.onerror = () => rej(new Error("The audio couldn't be played."));
        audio.play().catch((err) => rej(err instanceof Error ? err : new Error(String(err))));
      });
    },
    stop() {
      audio?.pause();
      audio = null;
      reject?.(new Stopped());
      reject = null;
    },
  };
}
