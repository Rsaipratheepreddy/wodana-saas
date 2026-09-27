import { readingTime } from "./timing";
import type { TourSpeed } from "./types";

/** Where the player looks for a recorded line (written by `scripts/tours-voice.mjs`). */
export function audioPath(language: string, tourId: string, stepId: string): string {
  return `/tours/audio/${language}/${tourId}/${stepId}.mp3`;
}

const availability = new Map<string, Promise<boolean>>();

/** Whether a recorded line exists; asked once per file and remembered for the session. */
export function hasAudio(src: string, request: typeof fetch = (...args) => fetch(...args)): Promise<boolean> {
  let known = availability.get(src);
  if (!known) {
    known = request(src, { method: "HEAD", cache: "force-cache" })
      .then((response) => response.ok && (response.headers.get("content-type") ?? "audio").includes("audio"))
      .catch(() => false);
    availability.set(src, known);
  }
  return known;
}

/** Resolves after `ms`, or as soon as the signal aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export type Narration = {
  text: string;
  /** The language the text is written in (untranslated lines are English). */
  language: string;
  /** A recorded line to play instead of the browser voice. */
  audio?: string | null;
  speed: TourSpeed;
  /** Voice off: the line is only shown, for its reading time. */
  voice: boolean;
  signal: AbortSignal;
};

export type Narrator = {
  /** Resolves when the line has finished (spoken, played or read). */
  speak(narration: Narration): Promise<void>;
  stop(): void;
  /** Whether this browser can speak at all. */
  supported(): boolean;
};

type SpeechEnvironment = {
  speech?: SpeechSynthesis;
  Utterance?: typeof SpeechSynthesisUtterance;
  createAudio?: (src: string) => HTMLAudioElement;
};

const PREFERRED_VOICE = /natural|neural|premium|enhanced|google|siri|samantha|daniel|lekha|maged/i;

function voiceFor(speech: SpeechSynthesis, language: string): SpeechSynthesisVoice | null {
  const matching = speech.getVoices().filter((voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(language));
  return matching.find((voice) => PREFERRED_VOICE.test(voice.name)) ?? matching.find((voice) => voice.default) ?? matching[0] ?? null;
}

async function voicesReady(speech: SpeechSynthesis): Promise<void> {
  if (speech.getVoices().length) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 800);
    speech.addEventListener?.("voiceschanged", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Browser voice (SpeechSynthesis) in the UI language, recorded audio when present, else reading time. */
export function createNarrator(environment: SpeechEnvironment = typeof window === "undefined" ? {} : {
  speech: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  createAudio: (src) => new Audio(src),
}): Narrator {
  const { speech, Utterance, createAudio } = environment;
  let playing: HTMLAudioElement | null = null;

  const stop = () => {
    if (playing) { playing.pause(); playing.src = ""; playing = null; }
    try { speech?.cancel(); } catch { /* Nothing is speaking. */ }
  };

  const play = (src: string, { speed, signal }: Narration) => new Promise<boolean>((resolve) => {
    if (!createAudio) return resolve(false);
    const audio = createAudio(src);
    playing = audio;
    audio.playbackRate = speed;
    const finish = (ok: boolean) => { signal.removeEventListener("abort", abort); if (playing === audio) playing = null; resolve(ok); };
    const abort = () => { audio.pause(); finish(true); };
    audio.addEventListener("ended", () => finish(true), { once: true });
    audio.addEventListener("error", () => finish(false), { once: true });
    signal.addEventListener("abort", abort, { once: true });
    audio.play().catch(() => finish(false));
  });

  const say = async ({ text, language, speed, signal }: Narration) => {
    if (!speech || !Utterance) return false;
    await voicesReady(speech);
    const voice = voiceFor(speech, language);
    if (!voice || signal.aborted) return false;
    return new Promise<boolean>((resolve) => {
      const utterance = new Utterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = speed;
      // Some browsers never fire `end` for a line; don't wait forever.
      const safety = setTimeout(() => finish(true), readingTime(text, speed) * 1.8 + 4000);
      const started = Date.now();
      function finish(ok: boolean) { clearTimeout(safety); signal.removeEventListener("abort", abort); resolve(ok); }
      function abort() { speech!.cancel(); finish(true); }
      utterance.onend = () => finish(true);
      // Blocked before any interaction (autoplay rules), or no voice after all: read it instead.
      utterance.onerror = (event) => finish(event.error === "interrupted" || event.error === "canceled" ? true : Date.now() - started > 1500);
      signal.addEventListener("abort", abort, { once: true });
      speech.cancel();
      speech.speak(utterance);
    });
  };

  return {
    stop,
    supported: () => Boolean(speech && Utterance),
    async speak(narration) {
      const { text, speed, voice, audio, signal } = narration;
      if (signal.aborted) return;
      if (voice && audio && await play(audio, narration)) return;
      if (voice && await say(narration)) return;
      await pause(readingTime(text, speed), signal);
    },
  };
}
