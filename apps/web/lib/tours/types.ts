import type { MessageKey } from "../i18n/keys";

/**
 * What Woddy's cursor does on a step. Tours never save:
 * - `point` only points;
 * - `click` presses a control marked `data-tour-safe` (a tab, menu, dialog or drawer trigger);
 * - `open` follows a link or opens a record (navigation only);
 * - `type` fills a field for show and is cleared afterwards;
 * - `wait` waits for the target, then narrates.
 */
export type TourAction = "point" | "click" | "type" | "open" | "wait";

/** Woddy's expression in the caption bubble. */
export type WoddyMood = "hello" | "thinking" | "working" | "celebrating";

export type TourStep = {
  /** Stable id: names the recorded audio file (`public/tours/audio/<lang>/<tour>/<id>.mp3`). */
  id: string;
  /** A path to open first when the current path differs. */
  route?: string;
  /** The `data-tour` value of the element to point at. No target: the bubble speaks to the whole screen. */
  target?: string;
  action: TourAction;
  /** Text typed by a `type` step. */
  value?: string;
  /** What Woddy says; may use example placeholders such as `{client}`. */
  narration: MessageKey;
  /** The same line without names, recorded once as audio (used when the audio file exists). */
  voice?: MessageKey;
  woddy: WoddyMood;
  /** After acting, wait for this `data-tour` element and spotlight it while narrating. */
  waitFor?: string;
};

/** A real example from the workspace, read from the screen when a step needs it. */
export type TourExample = {
  /** The placeholder it fills, e.g. `client` for `{client}`. */
  key: string;
  /** The `data-tour` element whose text is the example. */
  source: string;
  /** Used when nothing is on screen yet. */
  fallback: MessageKey;
};

export type Tour = {
  id: string;
  title: MessageKey;
  /** The screens this tour explains, as path patterns (`*` matches the rest of a segment). */
  screens: string[];
  steps: TourStep[];
  examples?: TourExample[];
  /** The tour suggested when this one ends. */
  next?: string;
};

export type TourSpeed = 0.75 | 1 | 1.25;
export const TOUR_SPEEDS: TourSpeed[] = [0.75, 1, 1.25];
