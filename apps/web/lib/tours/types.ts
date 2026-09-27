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

/**
 * Who is working on a step. The cursor takes that person's colour and name, and the workspace is shown the way
 * that role sees it (a demo-only presentation: real permissions never change and nothing is written).
 */
export type TourActor = "sales" | "designer" | "estimator" | "approver" | "finance" | "buyer" | "factory" | "site" | "client";

export type TourStep = {
  /** Stable id: names the recorded audio file (`public/tours/audio/<lang>/<tour>/<id>.mp3`). */
  id: string;
  /**
   * A path to open first when the current path differs. It may use values captured earlier in the tour,
   * e.g. `/workspace/client-view/{case}`; a step whose route can't be filled is skipped with a note.
   */
  route?: string;
  /**
   * The `data-tour` value of the element to point at. `a|b` means "a, or else b": the first one on screen wins.
   * No target: the bubble speaks to the whole screen.
   */
  target?: string;
  action: TourAction;
  /** Text typed by a `type` step. */
  value?: string;
  /** What Woddy says; may use example placeholders such as `{client}`. */
  narration: MessageKey;
  /** The same line without names, recorded once as audio (used when the audio file exists). */
  voice?: MessageKey;
  /**
   * A short on-screen caption for a longer spoken line (minimal UI: one short sentence in the bubble). When set,
   * the bubble always shows it; the narration and voice are what is heard.
   */
  caption?: MessageKey;
  woddy: WoddyMood;
  /** After acting, wait for this `data-tour` element and spotlight it while narrating. */
  waitFor?: string;
  /** Who is working on this step; later steps keep it until another actor takes over. */
  actor?: TourActor;
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

/** A value read from the address after a step, so later steps can return to the same record (`{case}`, `{project}`). */
export type TourCapture = {
  key: string;
  /** A regular expression over the path and query; its first group is the value. */
  pattern: string;
};

export type Tour = {
  id: string;
  title: MessageKey;
  /** The screens this tour explains, as path patterns (`*` matches the rest of a segment). */
  screens: string[];
  steps: TourStep[];
  examples?: TourExample[];
  captures?: TourCapture[];
  /**
   * The job the tour follows, picked before it starts so every step shows real work on the same job (see
   * `journey.ts`): `furthest-job` (a released project and its planning case; `{case}` and `{project}` start out
   * known) or `quote-in-progress` (a case whose quote is still being prepared; `{case}` starts out known).
   */
  follows?: "furthest-job" | "quote-in-progress";
  /** The tour suggested when this one ends. */
  next?: string;
};

export type TourSpeed = 0.75 | 1 | 1.25;
export const TOUR_SPEEDS: TourSpeed[] = [0.75, 1, 1.25];
