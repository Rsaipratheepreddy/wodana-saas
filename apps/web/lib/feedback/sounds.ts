"use client";

/**
 * Tiny, soft sounds for a few moments that matter: Woddy's reply arriving, a confirmed action, an approval, a
 * message sent, and a new chat or notice. They're made with the Web Audio API (no audio files), play only after the
 * person has interacted with the page (never on load), never while viewing as someone, never with reduced motion,
 * and never when the person turned "Sound & haptics" off in their profile. On iPhones the audio session is ambient,
 * so the ring/silent switch mutes them.
 */
export type FeedbackSound = "reply" | "confirm" | "approve" | "send" | "notice";

type Note = { frequency: number; to?: number; at: number; length: number };

/** Each sound: a few short, quiet sine notes (seconds from the start). */
const SOUNDS: Record<FeedbackSound, Note[]> = {
  reply: [{ frequency: 660, at: 0, length: 0.09 }, { frequency: 880, at: 0.08, length: 0.12 }],
  confirm: [{ frequency: 740, at: 0, length: 0.1 }],
  approve: [{ frequency: 523.25, at: 0, length: 0.08 }, { frequency: 659.25, at: 0.07, length: 0.08 }, { frequency: 783.99, at: 0.14, length: 0.14 }],
  send: [{ frequency: 440, to: 880, at: 0, length: 0.14 }],
  notice: [{ frequency: 880, at: 0, length: 0.1 }, { frequency: 660, at: 0.11, length: 0.14 }],
};
const PEAK = 0.05;
const REPEAT_GAP_MS = 1_200;

const state = { enabled: true, viewingAs: false, interacted: false, context: null as AudioContext | null, last: new Map<FeedbackSound, number>() };

/** The person's setting and whether they are viewing as someone (set by the workspace shell). */
export function configureFeedback(options: { enabled?: boolean; viewingAs?: boolean }) {
  if (options.enabled !== undefined) state.enabled = options.enabled;
  if (options.viewingAs !== undefined) state.viewingAs = options.viewingAs;
}

export function feedbackEnabled() {
  return state.enabled && !state.viewingAs;
}

function reducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

// Browsers only start audio after a gesture; waiting for one also means nothing ever plays on load.
function listenForInteraction() {
  const mark = () => {
    state.interacted = true;
    window.removeEventListener("pointerdown", mark, true);
    window.removeEventListener("keydown", mark, true);
  };
  window.addEventListener("pointerdown", mark, true);
  window.addEventListener("keydown", mark, true);
}
if (typeof window !== "undefined") listenForInteraction();

function audio(): AudioContext | null {
  if (state.context) return state.context;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  // Safari 16.4+: an ambient session mixes with other audio and follows the ring/silent switch.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) try { session.type = "ambient"; } catch { /* Older Safari */ }
  state.context = new Context();
  return state.context;
}

/** Plays a sound when allowed; returns whether it played. */
export function playFeedback(kind: FeedbackSound): boolean {
  if (typeof window === "undefined" || !feedbackEnabled() || !state.interacted || reducedMotion()) return false;
  const now = Date.now();
  if (now - (state.last.get(kind) ?? 0) < REPEAT_GAP_MS) return false;
  state.last.set(kind, now);
  try {
    const context = audio();
    if (!context) return false;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const start = context.currentTime + 0.01;
    for (const note of SOUNDS[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, start + note.at);
      if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.at + note.length);
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(PEAK, start + note.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + note.length + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** For tests: back to a fresh page. */
export function resetFeedbackForTests() {
  state.enabled = true; state.viewingAs = false; state.interacted = false; state.context = null; state.last.clear();
  listenForInteraction();
}
