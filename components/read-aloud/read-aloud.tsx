"use client";

import { Pause, Play, SkipBack, SkipForward, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chunk, formatClock, formatListeningTime, toSentences, type Block, type Sentence } from "@/lib/speech/text";
import { clearHighlight, findRange, highlight, keepInView, resetCursors } from "./dom";
import { deviceEngine, deviceVoiceAvailable, naturalEngine, Stopped, type Engine } from "./engines";

/** What a preview (PDF or web page) offers the reader. */
export type ReadSource = {
  /** Text to read for "Read all": the whole document, or from `fromPage` on. */
  all(): Promise<{ blocks: Block[]; fromPage?: number }>;
  /** The current selection inside the preview, with where it is on screen. */
  selection(): { text: string; page?: number; rect: DOMRect } | null;
  /** Where a sentence on `page` can be found, for highlighting. */
  target(page?: number): Promise<{ root: Element; win: Window; scroller: Element | Window; skip?: string } | null>;
  /** Call `cb` when the selection changes; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
  /** Clear the selection, so the reading highlight shows instead. */
  clearSelection(): void;
};

type Voice = "device" | "natural";
type Status = "idle" | "loading" | "playing" | "paused";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const NATURAL_CHUNK = 900; // characters per request to the natural voice

function load<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw === null ? null : JSON.parse(raw);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * Read aloud for the reading panel: read the selection or everything, with
 * the listening time shown first and a countdown while it plays, the current
 * sentence highlighted, and a choice of the device's voice (free) or a
 * natural voice (OpenAI, billed to the user's key).
 */
export function ReadAloud({
  source,
  open,
  onOpenChange,
}: {
  source: ReadSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState<Voice>("device");
  const [natural, setNatural] = useState(false);
  const [selection, setSelection] = useState<{ text: string; page?: number; rect: DOMRect } | null>(null);
  const [all, setAll] = useState<{ words: number; fromPage?: number } | null>(null);
  const [queue, setQueue] = useState<Sentence[]>([]);
  const [position, setPosition] = useState(0); // index of the sentence being read

  const run = useRef(0); // bumped to cancel the current playback loop
  const engine = useRef<Engine | null>(null);
  const highlightWin = useRef<Window | null>(null);
  const settings = useRef({ rate, voice });

  // Saved preferences, and whether the natural voice is available.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- read browser-only settings after mount */
    setRate(load("rp:read-rate", 1, (v) => RATES.includes(v as number)));
    setVoice(load<Voice>("rp:read-voice", "device", (v) => v === "device" || v === "natural"));
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch("/api/tts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { natural: false }))
      .then((d: { natural?: boolean }) => setNatural(!!d.natural))
      .catch(() => {});
  }, []);
  useEffect(() => {
    settings.current = { rate, voice };
  }, [rate, voice]);

  // Follow the selection in the preview.
  useEffect(() => {
    if (!source) return;
    const update = () => {
      const s = source.selection();
      setSelection(s && s.text.trim() ? s : null);
    };
    update();
    return source.subscribe(update);
  }, [source]);

  // Count the words for "Read all" when the bar opens.
  useEffect(() => {
    if (!open || !source) return;
    let cancelled = false;
    source
      .all()
      .then(({ blocks, fromPage }) => {
        if (!cancelled) setAll({ words: toSentences(blocks).reduce((n, s) => n + s.words, 0), fromPage });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, source]);

  const stopEngine = useCallback(() => {
    run.current++;
    engine.current?.stop();
  }, []);

  const stop = useCallback(() => {
    stopEngine();
    clearHighlight(highlightWin.current);
    setStatus("idle");
    setQueue([]);
    setPosition(0);
  }, [stopEngine]);

  // Stop when the preview changes or the panel closes.
  useEffect(() => stop, [source, stop]);

  const voiceOk = (v: Voice) => (v === "natural" ? natural : deviceVoiceAvailable());

  /** Read `sentences` from sentence `from`, in passages suited to the voice. */
  const play = useCallback(
    async (sentences: Sentence[], from: number) => {
      if (!source || !sentences.length) return;
      stopEngine();
      const gen = run.current;
      const { rate, voice } = settings.current;
      const useVoice: Voice = voice === "natural" && natural ? "natural" : "device";
      engine.current = useVoice === "natural" ? naturalEngine() : deviceEngine();
      const passages = useVoice === "natural" ? chunk(sentences, NATURAL_CHUNK) : sentences.map((_, i) => [i]);
      const start = Math.max(0, passages.findIndex((p) => p.includes(from)));
      setQueue(sentences);
      setError(null);
      setStatus(useVoice === "natural" ? "loading" : "playing");

      for (let p = start; p < passages.length; p++) {
        if (run.current !== gen) return;
        const ids = passages[p];
        setPosition(ids[0]);
        // Highlight and scroll to the passage.
        const ranges: Range[] = [];
        for (const i of ids) {
          const t = await source.target(sentences[i].page);
          if (!t) continue;
          const r = findRange(t.root, sentences[i].text, t.skip);
          if (r) {
            ranges.push(r);
            highlightWin.current = t.win;
          }
          if (r && i === ids[0]) keepInView(r, t.scroller);
        }
        if (highlightWin.current) highlight(highlightWin.current, ranges);
        try {
          const text = ids.map((i) => sentences[i].text).join(" ");
          const upcoming = passages.slice(p + 1, p + 3).map((ps) => ps.map((i) => sentences[i].text).join(" "));
          const speaking = engine.current.speak(text, rate, upcoming);
          if (run.current === gen) setStatus("playing");
          await speaking;
        } catch (err) {
          if (err instanceof Stopped || run.current !== gen) return;
          setError(err instanceof Error ? err.message : "Reading stopped because of an error.");
          setStatus("paused");
          return;
        }
      }
      if (run.current === gen) {
        clearHighlight(highlightWin.current);
        setStatus("idle");
        setQueue([]);
      }
    },
    [source, natural, stopEngine],
  );

  async function readAll() {
    if (!source) return;
    onOpenChange(true);
    const { blocks } = await source.all();
    resetCursors();
    void play(toSentences(blocks), 0);
  }

  async function readSelection() {
    if (!source || !selection) return;
    onOpenChange(true);
    resetCursors();
    const sentences = toSentences([{ text: selection.text, page: selection.page }]);
    source.clearSelection();
    void play(sentences, 0);
  }

  function pause() {
    stopEngine();
    setStatus("paused");
  }

  function resume() {
    void play(queue, position);
  }

  function skip(by: number) {
    const next = Math.min(Math.max(position + by, 0), queue.length - 1);
    if (status === "playing" || status === "loading") void play(queue, next);
    else setPosition(next);
  }

  // A change of speed or voice applies from the current sentence.
  function changeRate(r: number) {
    setRate(r);
    save("rp:read-rate", r);
    settings.current.rate = r;
    if (status === "playing" || status === "loading") void play(queue, position);
  }
  function changeVoice(v: Voice) {
    setVoice(v);
    save("rp:read-voice", v);
    settings.current.voice = v;
    if (status === "playing" || status === "loading") void play(queue, position);
  }

  const remaining = useMemo(() => queue.slice(position).reduce((n, s) => n + s.words, 0), [queue, position]);
  const selectionWords = selection ? toSentences([{ text: selection.text }]).reduce((n, s) => n + s.words, 0) : 0;
  const active = status !== "idle";

  // The small "Read aloud" button next to a selection.
  const chip =
    selection && !active ? (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep the selection
        onClick={() => void readSelection()}
        className="fixed z-50 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper shadow-lg shadow-black/20"
        style={{
          top: Math.min(selection.rect.bottom + 8, window.innerHeight - 44),
          left: Math.min(Math.max(selection.rect.left, 8), window.innerWidth - 140),
        }}
      >
        <Volume2 size={14} aria-hidden="true" />
        Read aloud
      </button>
    ) : null;

  if (!open) return chip;

  const btn = "rounded-md p-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-40";
  return (
    <>
      {chip}
      <div role="region" aria-label="Read aloud" className="shrink-0 border-t border-rule bg-surface px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {active ? (
            <>
              <button type="button" onClick={() => skip(-1)} disabled={position === 0} className={btn} aria-label="Previous sentence" title="Previous sentence">
                <SkipBack size={16} aria-hidden="true" />
              </button>
              {status === "paused" ? (
                <button type="button" onClick={resume} className="flex size-8 items-center justify-center rounded-full bg-accent text-white" aria-label="Play" title="Play">
                  <Play size={16} aria-hidden="true" className="translate-x-px" />
                </button>
              ) : (
                <button type="button" onClick={pause} className="flex size-8 items-center justify-center rounded-full bg-accent text-white" aria-label="Pause" title="Pause">
                  <Pause size={16} aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={() => skip(1)} disabled={position >= queue.length - 1} className={btn} aria-label="Next sentence" title="Next sentence">
                <SkipForward size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={stop} className={btn} aria-label="Stop" title="Stop">
                <Square size={14} aria-hidden="true" />
              </button>
              <span className="tabular-nums text-muted" aria-live="off" data-testid="read-remaining">
                {status === "loading" ? "Preparing the voice…" : `${formatClock(remaining, rate)} left`}
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void readSelection()}
                disabled={!selection}
                title={selection ? undefined : "Select some text in the document first"}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft/70 px-2.5 py-1 text-[13px] text-ink transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                <Volume2 size={14} aria-hidden="true" />
                Read selection
                {selection && <span className="text-muted">· {formatListeningTime(selectionWords, rate)}</span>}
              </button>
              <button
                type="button"
                onClick={() => void readAll()}
                disabled={!all?.words}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft/70 px-2.5 py-1 text-[13px] text-ink transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                <Play size={14} aria-hidden="true" />
                {all?.fromPage && all.fromPage > 1 ? `Read from page ${all.fromPage}` : "Read all"}
                <span className="text-muted">· {all ? (all.words ? formatListeningTime(all.words, rate) : "no text") : "counting…"}</span>
              </button>
            </>
          )}

          <span className="ml-auto flex items-center gap-1">
            <label className="sr-only" htmlFor="read-rate">
              Speed
            </label>
            <select
              id="read-rate"
              value={rate}
              onChange={(e) => changeRate(Number(e.target.value))}
              className="rounded-md bg-transparent px-1 py-1 text-[13px] text-muted hover:bg-accent-soft/60 focus:outline-none"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="read-voice">
              Voice
            </label>
            <select
              id="read-voice"
              value={voice === "natural" && !natural ? "device" : voice}
              onChange={(e) => changeVoice(e.target.value as Voice)}
              className="max-w-[9.5rem] rounded-md bg-transparent px-1 py-1 text-[13px] text-muted hover:bg-accent-soft/60 focus:outline-none"
            >
              <option value="device" disabled={!voiceOk("device")}>
                Device voice
              </option>
              <option value="natural" disabled={!natural}>
                {natural ? "Natural voice (OpenAI)" : "Natural voice (add an OpenAI key in Settings)"}
              </option>
            </select>
            <button
              type="button"
              onClick={() => {
                stop();
                onOpenChange(false);
              }}
              className={btn}
              aria-label="Close read aloud"
              title="Close read aloud"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        )}
        {voice === "natural" && natural && !active && (
          <p className="mt-1.5 text-xs text-faint">The natural voice is billed to your OpenAI key; passages you replay are free.</p>
        )}
      </div>
    </>
  );
}
