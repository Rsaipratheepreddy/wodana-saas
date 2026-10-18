import { TOUR_PACE } from "./timing";
import type { Tour, TourActor, TourSpeed, TourStep, WoddyMood } from "./types";

/**
 * - `preparing`: the first screen is opening behind the loader; the tour shows once its first target is ready.
 * - `running`, `paused`: the tour is on screen.
 * - `finished`: the last line has been said; the bubble offers the next tour.
 */
export type TourStatus = "idle" | "preparing" | "running" | "paused" | "finished";
/**
 * - `switching`: another person takes over ("Now as Finance");
 * - `loading`: a step is opening another screen (the bubble shows a short loading state, the cursor waits);
 * - `seeking`, `moving`, `acting`, `speaking`, `resting`: finding the target, gliding there, clicking or typing,
 *   narrating, and the pause before the next step.
 */
export type TourPhase = "switching" | "loading" | "seeking" | "moving" | "acting" | "speaking" | "resting";

export type TourSnapshot = {
  status: TourStatus;
  tour: Tour | null;
  index: number;
  phase: TourPhase;
  /** Where Woddy's cursor points. */
  pointer: HTMLElement | null;
  /** What the spotlight leaves undimmed. */
  spotlight: HTMLElement | null;
  /** The step's target never appeared; it is skipped with a note. */
  missing: boolean;
  text: string;
  mood: WoddyMood;
  speed: TourSpeed;
  /** Counts clicks, so the overlay can replay its ripple. */
  clicks: number;
  /** Who is working on the current step (the cursor's colour and name, and the "view as" presentation). */
  actor: TourActor | null;
  /** How far the first screen has got while preparing, 0 to 1. */
  progress: number;
};

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Everything the runner needs from the page. The browser host lives in `components/tours`; tests fake it. */
export type TourHost = {
  path(): string;
  /** The path and query, for the values a tour captures (`{case}`, `{project}`). Defaults to the path. */
  location?(): string;
  navigate(href: string): void;
  /** The first visible element marked `data-tour="<target>"`; with `record`, the first one that opens that record. */
  find(target: string, record?: string): HTMLElement | null;
  /** Scrolls the element into view; resolves when it has settled. */
  reveal(element: HTMLElement): Promise<void> | void;
  /** A real-looking click. Only ever called for `data-tour-safe` controls. */
  press(element: HTMLElement): void;
  /** Sets a field's text the way typing would, so the app's own handlers see it. */
  fill(field: Field, value: string): void;
  /** Dialogs, drawers and menus open in the app right now. */
  overlays(): HTMLElement[];
  dismiss(overlay: HTMLElement): void;
  /** The line shown and spoken for a step, translated, with its examples filled in. */
  line(tour: Tour, step: TourStep, values: Record<string, string>): string;
  /** Resolves when the line has finished: spoken, played or given its reading time. */
  narrate(tour: Tour, step: TourStep, text: string, speed: TourSpeed, signal: AbortSignal): Promise<void>;
  silence(): void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  random?(): number;
};

const IDLE: TourSnapshot = {
  status: "idle", tour: null, index: 0, phase: "seeking", pointer: null, spotlight: null, missing: false, text: "", mood: "hello", speed: 1, clicks: 0,
  actor: null, progress: 0,
};

const ACTS = new Set(["click", "open", "type"]);
/** Where a step with no target waits on its screen before the tour shows. */
const PAGE = "page-content";

/** The person working on a step: its own actor, or the last one named before it. */
export function actorAt(tour: Tour, index: number): TourActor | null {
  for (let at = Math.min(index, tour.steps.length - 1); at >= 0; at -= 1) {
    const actor = tour.steps[at]?.actor;
    if (actor) return actor;
  }
  return null;
}

/**
 * A route with its `{placeholders}` filled from captured values, or null when one is still unknown.
 * `a|b` means "a, or else b": the first alternative whose records are known.
 */
export function fillRoute(route: string, values: Record<string, string>): string | null {
  for (const option of route.split("|")) {
    let unknown = false;
    const filled = option.trim().replace(/\{(\w+)\}/g, (_token, key: string) => {
      const value = values[key];
      if (!value) { unknown = true; return ""; }
      return encodeURIComponent(value);
    });
    if (!unknown) return filled;
  }
  return null;
}

/**
 * Plays a tour step by step at a human pace: find the target (skipping it with a note when it never
 * appears), glide the cursor there, act, narrate until the line has finished, pause, move on. Tours never
 * save: only `data-tour-safe` controls are pressed, typed text is cleared and opened dialogs are closed.
 */
export class TourRunner {
  private state: TourSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private typed: Array<{ field: Field; value: string }> = [];
  /** Dialogs, drawers and menus the tour opened; the only ones it closes. */
  private opened: HTMLElement[] = [];
  private values: Record<string, string> = {};
  private acted = -1;

  constructor(private readonly host: TourHost) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  /** Opens the first screen behind the loader (`preparing`), then plays the tour from its first step. */
  start(tour: Tour, values: Record<string, string> = {}) {
    this.halt();
    // Starting over from another tour: undo its demo changes first (never the page's own dialogs).
    if (this.state.status !== "idle") this.cleanup();
    this.values = { ...values };
    this.acted = -1;
    this.opened = [];
    this.set({ ...IDLE, speed: this.state.speed, status: "preparing", tour, mood: tour.steps[0]?.woddy ?? "hello" });
    void this.loop();
  }

  pause() {
    if (this.state.status !== "running") return;
    this.halt();
    this.set({ status: "paused" });
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.set({ status: "running" });
    void this.loop();
  }

  toggle() {
    if (this.state.status === "running") this.pause();
    else this.resume();
  }

  next() { this.go(this.state.index + 1); }

  back() { this.go(Math.max(0, this.state.index - 1)); }

  go(index: number) {
    const { tour } = this.state;
    if (!tour || this.state.status === "idle" || this.state.status === "preparing") return;
    this.halt();
    this.leave(tour.steps[index]);
    if (index >= tour.steps.length) return this.finish();
    this.acted = -1;
    this.set({ status: "running", index, missing: false });
    void this.loop();
  }

  setSpeed(speed: TourSpeed) { this.set({ speed }); }

  /** Stops at once: nothing more is said, typed text is cleared and the dialogs the tour opened close. */
  exit() {
    this.halt();
    this.cleanup();
    this.set({ ...IDLE, speed: this.state.speed });
  }

  private set(patch: Partial<TourSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private halt() {
    this.controller?.abort();
    this.controller = null;
    this.host.silence();
  }

  private finish() {
    this.halt();
    this.cleanup();
    this.set({ status: "finished", phase: "resting", pointer: null, spotlight: null, missing: false, mood: "celebrating" });
  }

  private async loop() {
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    try {
      if (this.state.status === "preparing") {
        await this.prepare(signal);
        if (signal.aborted) return;
        this.set({ status: "running", progress: 1 });
      }
      while (!signal.aborted && this.state.status === "running" && this.state.tour) {
        const { tour, index } = this.state;
        const step = tour.steps[index];
        if (!step) return this.finish();
        await this.play(tour, step, index, signal);
        if (signal.aborted) return;
        this.leave(tour.steps[index + 1]);
        if (index + 1 >= tour.steps.length) return this.finish();
        this.set({ index: index + 1 });
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error("Tour stopped", error);
      this.exit();
    }
  }

  private pace(ms: number) { return ms / this.state.speed; }

  /** The first screen, opened while the loader shows: its route, then its first target (or the page itself). */
  private async prepare(signal: AbortSignal) {
    const { tour } = this.state;
    const step = tour?.steps[0];
    if (!tour || !step) return;
    this.set({ progress: 0.35 });
    const route = step.route ? fillRoute(step.route, this.values) : null;
    if (route && this.host.path() !== route.split("?")[0]) this.host.navigate(route);
    this.set({ progress: 0.65 });
    await this.waitFor(step.target ?? PAGE, signal, TOUR_PACE.prepareTimeout);
    this.capture(tour);
  }

  private async play(tour: Tour, step: TourStep, index: number, signal: AbortSignal) {
    const actor = actorAt(tour, index);
    if (actor !== this.state.actor) {
      // Another person takes over: a short, clear switch before anything moves.
      this.set({ phase: "switching", actor, pointer: null, spotlight: null, missing: false, mood: step.woddy, text: this.host.line(tour, step, this.values) });
      await this.host.sleep(this.pace(TOUR_PACE.persona), signal);
      if (signal.aborted) return;
    }
    this.set({ phase: "seeking", spotlight: null, missing: false, mood: step.woddy, text: this.host.line(tour, step, this.values) });
    if (step.route) {
      const route = fillRoute(step.route, this.values);
      if (!route) return this.skip(signal);
      if (this.host.path() !== route.split("?")[0]) {
        // Another screen: the cursor waits out of sight and the bubble shows a short loading state.
        this.set({ phase: "loading", pointer: null });
        this.host.navigate(route);
      }
    }
    if (step.target) {
      const element = await this.waitFor(step.target, signal);
      if (signal.aborted) return;
      if (!element) return this.skip(signal);
      if (this.state.phase === "loading") this.set({ phase: "seeking" });
      await this.host.reveal(element);
      if (signal.aborted) return;
      this.set({ phase: "moving", pointer: element, spotlight: element });
      await this.host.sleep(this.pace(TOUR_PACE.glide), signal);
      if (signal.aborted) return;
      // The page may have re-rendered while the cursor moved: act on the element that is there now.
      const current = element.isConnected ? element : this.find(step.target) ?? element;
      if (current !== element) this.set({ pointer: current, spotlight: current });
      if (ACTS.has(step.action) && this.acted !== index) {
        this.set({ phase: "acting" });
        await this.act(step, current, signal);
        this.acted = index;
        if (signal.aborted) return;
      }
    } else {
      if (step.route) await this.waitFor(PAGE, signal);
      if (signal.aborted) return;
      this.set({ pointer: null, phase: "seeking" });
    }
    if (step.waitFor) {
      const shown = await this.waitFor(step.waitFor, signal);
      if (signal.aborted) return;
      if (shown) {
        await this.host.reveal(shown);
        // What appeared opened in a dialog over the target: the cursor follows it there, never pointing behind it.
        const pointer = this.state.pointer;
        const covered = !pointer?.isConnected || this.opened.some((overlay) => overlay.contains(shown) && !overlay.contains(pointer));
        this.set({ spotlight: shown, ...(covered || this.state.phase === "loading" ? { pointer: covered ? shown : pointer } : {}), ...(this.state.phase === "loading" ? { phase: "seeking" as const } : {}) });
      }
    }
    this.capture(tour);
    this.readExamples(tour);
    const text = this.host.line(tour, step, this.values);
    this.set({ phase: "speaking", text });
    await this.host.narrate(tour, step, text, this.state.speed, signal);
    if (signal.aborted) return;
    this.set({ phase: "resting" });
    await this.host.sleep(this.pace(TOUR_PACE.pause), signal);
  }

  /** The step can't be shown right now: a short note, then the tour carries on. */
  private async skip(signal: AbortSignal) {
    this.set({ phase: "resting", missing: true, mood: "thinking", pointer: null, spotlight: null });
    await this.host.sleep(this.pace(TOUR_PACE.missing), signal);
  }

  private async act(step: TourStep, element: HTMLElement, signal: AbortSignal) {
    if (step.action === "type") {
      const asField = (node: HTMLElement | null) => (node?.matches("input, textarea") ? node : node?.querySelector("input, textarea")) as Field | null;
      let field = asField(element);
      // A safe control that opens the field (e.g. "New line"): press it, then type into what appears.
      if (!field && step.waitFor && element.closest("[data-tour-safe]")) {
        await this.host.sleep(this.pace(TOUR_PACE.rest), signal);
        this.set({ clicks: this.state.clicks + 1 });
        this.host.press(element);
        const shown = await this.waitFor(step.waitFor, signal);
        field = asField(shown);
        if (shown && field) {
          this.set({ pointer: shown, spotlight: shown });
          await this.host.sleep(this.pace(TOUR_PACE.glide), signal);
        }
      }
      if (!field || signal.aborted) return;
      this.typed.push({ field, value: field.value });
      this.set({ clicks: this.state.clicks + 1 });
      let text = "";
      for (const character of step.value ?? "") {
        text += character;
        this.host.fill(field, text);
        const jitter = (this.host.random?.() ?? Math.random()) * (TOUR_PACE.typeMax - TOUR_PACE.typeMin);
        await this.host.sleep(this.pace(TOUR_PACE.typeMin + jitter), signal);
        if (signal.aborted) return;
      }
      return;
    }
    await this.host.sleep(this.pace(TOUR_PACE.rest), signal);
    if (signal.aborted) return;
    const safe = element.closest("[data-tour-safe]");
    const link = step.action === "open" ? element.closest("a")?.getAttribute("href") : null;
    // Already there (a tab of the page that is open): nothing to open.
    const href = link && link !== (this.host.location?.() ?? this.host.path()) ? link : null;
    // Only links and controls marked safe are ever used: nothing a tour touches can save.
    if (!href && !safe) return;
    this.set({ clicks: this.state.clicks + 1 });
    const before = new Set(this.host.overlays());
    const from = this.host.path();
    if (href) this.host.navigate(href);
    else this.host.press(element);
    await this.host.sleep(this.pace(TOUR_PACE.rest), signal);
    // The click opened another screen: the cursor waits out of sight until it has loaded.
    if (href && href.split("?")[0] !== from) this.set({ phase: "loading", pointer: null, spotlight: null });
    this.opened.push(...this.host.overlays().filter((overlay) => !before.has(overlay)));
  }

  /**
   * `a|b`: the first of the targets that is on screen. `a#{case}`: the `a` that opens the record captured as
   * `case` (skipped while that record is unknown), e.g. the row of the job the tour follows.
   */
  private find(target: string): HTMLElement | null {
    for (const option of target.split("|")) {
      const [name, template] = option.trim().split("#");
      const record = template ? fillRoute(template, this.values) : undefined;
      if (template && !record) continue;
      const element = this.host.find(name, record ?? undefined);
      if (element) return element;
    }
    return null;
  }

  private async waitFor(target: string, signal: AbortSignal, timeout: number = TOUR_PACE.targetTimeout): Promise<HTMLElement | null> {
    for (let waited = 0; waited <= timeout; waited += TOUR_PACE.poll) {
      const element = this.find(target);
      if (element) return element;
      await this.host.sleep(TOUR_PACE.poll, signal);
      if (signal.aborted) return null;
    }
    return null;
  }

  /** Records the ids a later step returns to (the case, the quote, the project), read from the address. */
  private capture(tour: Tour) {
    if (!tour.captures?.length) return;
    const where = this.host.location?.() ?? this.host.path();
    for (const { key, pattern } of tour.captures) {
      const match = where.match(new RegExp(pattern, "u"));
      if (match?.[1]) this.values[key] = decodeURIComponent(match[1]);
    }
  }

  /** Real examples from the screen (the first enquiry, the open case…) fill the narration's placeholders. */
  private readExamples(tour: Tour) {
    for (const example of tour.examples ?? []) {
      if (this.values[example.key]) continue;
      const element = this.find(example.source);
      const text = (element?.getAttribute("title") || element?.textContent)?.replace(/\s+/gu, " ").trim();
      if (text) this.values[example.key] = text;
    }
  }

  /** Leaving a step: typed text goes; dialogs the tour opened close unless the next step points inside them. */
  private leave(upcoming: TourStep | undefined) {
    this.clearTyped();
    const keep = upcoming?.target ? this.find(upcoming.target) : null;
    this.opened = this.opened.filter((overlay) => {
      if (!overlay.isConnected) return false;
      if (keep && overlay.contains(keep)) return true;
      this.host.dismiss(overlay);
      return false;
    });
  }

  private clearTyped() {
    for (const { field, value } of this.typed.reverse()) if (field.isConnected) this.host.fill(field, value);
    this.typed = [];
  }

  private cleanup() {
    this.clearTyped();
    for (const overlay of this.opened) if (overlay.isConnected) this.host.dismiss(overlay);
    this.opened = [];
  }
}
