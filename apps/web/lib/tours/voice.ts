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
  createAudio?: (src: string) => HTMLAudioElement;
};

/** Woddy speaks only with a recorded voice; without a recording the caption stays up for its reading time. The browser's synthetic voice is never used. */
export function createNarrator(environment: SpeechEnvironment = typeof window === "undefined" ? {} : {
  createAudio: (src) => new Audio(src),
}): Narrator {
  const { createAudio } = environment;
  let playing: HTMLAudioElement | null = null;

  const stop = () => {
    if (playing) { playing.pause(); playing.src = ""; playing = null; }
  };

  const play = (src: string, { speed, signal }: Narration) => new Promise<boolean>((resolve) => {
    if (!createAudio) return resolve(false);
    const audio = createAudio(src);
    playing = audio;
    audio.playbackRate = speed;
    audio.volume = 1;
    const finish = (ok: boolean) => { signal.removeEventListener("abort", abort); if (playing === audio) playing = null; resolve(ok); };
    const abort = () => { audio.pause(); finish(true); };
    audio.addEventListener("ended", () => finish(true), { once: true });
    audio.addEventListener("error", () => finish(false), { once: true });
    signal.addEventListener("abort", abort, { once: true });
    audio.play().catch(() => finish(false));
  });

  return {
    stop,
    supported: () => Boolean(createAudio),
    async speak(narration) {
      const { text, speed, voice, audio, signal } = narration;
      if (signal.aborted) return;
      if (voice && audio && await play(audio, narration)) return;
      await pause(readingTime(text, speed), signal);
    },
  };
}
