import type { Tour, TourActor, TourSpeed } from "./types";

/** Human pace at 1×, in milliseconds. Every value is divided by the chosen speed. */
export const TOUR_PACE = {
  /** Cursor glide to the next target. */
  glide: 850,
  /** Rest on the target before a click. */
  rest: 300,
  /** Pause after a line has been spoken. */
  pause: 750,
  /** Per typed character, with a little variation. */
  typeMin: 40,
  typeMax: 70,
  /** How long a missing target's note stays up. */
  missing: 2600,
  /** How long "Now as Finance" shows when another person takes over. */
  persona: 1500,
  /** Longest wait for a target to appear. */
  targetTimeout: 9000,
  /** Longest wait for the first screen before the tour shows anyway (its step then says what's missing). */
  prepareTimeout: 15000,
  poll: 120,
} as const;

const WORDS_PER_MINUTE = 180;
const MIN_READING = 2500;

/** Reading time for a line nobody speaks aloud: about 180 words a minute, at least 2.5 s. */
export function readingTime(text: string, speed: TourSpeed = 1): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(MIN_READING, (words / WORDS_PER_MINUTE) * 60_000) / speed;
}

/** Whole minutes a tour takes at 1×, for the tour list. */
export function tourMinutes(tour: Tour, text: (key: string) => string = (key) => key): number {
  let actor: TourActor | undefined;
  const total = tour.steps.reduce((sum, step) => {
    const moving = step.target ? TOUR_PACE.glide + (step.action === "point" || step.action === "wait" ? 0 : TOUR_PACE.rest) : 0;
    const typing = step.action === "type" ? (step.value?.length ?? 0) * ((TOUR_PACE.typeMin + TOUR_PACE.typeMax) / 2) : 0;
    const switching = step.actor && step.actor !== actor ? TOUR_PACE.persona : 0;
    actor = step.actor ?? actor;
    return sum + moving + typing + switching + readingTime(text(step.narration)) + TOUR_PACE.pause;
  }, 0);
  return Math.max(1, Math.round(total / 60_000));
}
