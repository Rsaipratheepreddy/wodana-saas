import { TOUR_PACE } from "./timing";
import type { Tour, TourSpeed, TourStep, WoddyMood } from "./types";

export type TourStatus = "idle" | "running" | "paused" | "finished";
export type TourPhase = "seeking" | "moving" | "acting" | "speaking" | "resting";

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
};

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Everything the runner needs from the page. The browser host lives in `components/tours`; tests fake it. */
export type TourHost = {
  path(): string;
  navigate(href: string): void;
  /** The first visible element marked `data-tour="<target>"`. */
  find(target: string): HTMLElement | null;
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
};

const ACTS = new Set(["click", "open", "type"]);

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

  start(tour: Tour, values: Record<string, string> = {}) {
    this.halt();
    // Starting over from another tour: undo its demo changes first (never the page's own dialogs).
    if (this.state.status !== "idle") this.cleanup();
    this.values = { ...values };
    this.acted = -1;
    this.opened = [];
    this.set({ ...IDLE, speed: this.state.speed, status: "running", tour, mood: tour.steps[0]?.woddy ?? "hello" });
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
    if (!tour || this.state.status === "idle") return;
    this.halt();
    this.leave(tour.steps[index]);
    if (index >= tour.steps.length) return this.finish();
    this.acted = -1;
    this.set({ status: "running", index, missing: false });
    void this.loop();
  }

  setSpeed(speed: TourSpeed) { this.set({ speed }); }

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

  private async play(tour: Tour, step: TourStep, index: number, signal: AbortSignal) {
    this.set({ phase: "seeking", spotlight: null, missing: false, mood: step.woddy, text: this.host.line(tour, step, this.values) });
    if (step.route && this.host.path() !== step.route.split("?")[0]) this.host.navigate(step.route);
    if (step.target) {
      const element = await this.waitFor(step.target, signal);
      if (signal.aborted) return;
      if (!element) {
        this.set({ phase: "resting", missing: true, mood: "thinking" });
        await this.host.sleep(this.pace(TOUR_PACE.missing), signal);
        return;
      }
      await this.host.reveal(element);
      if (signal.aborted) return;
      this.set({ phase: "moving", pointer: element, spotlight: element });
      await this.host.sleep(this.pace(TOUR_PACE.glide), signal);
      if (signal.aborted) return;
      // The page may have re-rendered while the cursor moved: act on the element that is there now.
      const current = element.isConnected ? element : this.host.find(step.target) ?? element;
      if (current !== element) this.set({ pointer: current, spotlight: current });
      if (ACTS.has(step.action) && this.acted !== index) {
        this.set({ phase: "acting" });
        await this.act(step, current, signal);
        this.acted = index;
        if (signal.aborted) return;
      }
    } else {
      this.set({ pointer: null });
    }
    if (step.waitFor) {
      const shown = await this.waitFor(step.waitFor, signal);
      if (signal.aborted) return;
      if (shown) {
        await this.host.reveal(shown);
        this.set({ spotlight: shown });
      }
    }
    this.readExamples(tour);
    const text = this.host.line(tour, step, this.values);
    this.set({ phase: "speaking", text });
    await this.host.narrate(tour, step, text, this.state.speed, signal);
    if (signal.aborted) return;
    this.set({ phase: "resting" });
    await this.host.sleep(this.pace(TOUR_PACE.pause), signal);
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
    const href = step.action === "open" ? element.closest("a")?.getAttribute("href") : null;
    // Only links and controls marked safe are ever used: nothing a tour touches can save.
    if (!href && !safe) return;
    this.set({ clicks: this.state.clicks + 1 });
    const before = new Set(this.host.overlays());
    if (href) this.host.navigate(href);
    else this.host.press(element);
    await this.host.sleep(this.pace(TOUR_PACE.rest), signal);
    this.opened.push(...this.host.overlays().filter((overlay) => !before.has(overlay)));
  }

  private async waitFor(target: string, signal: AbortSignal): Promise<HTMLElement | null> {
    for (let waited = 0; waited <= TOUR_PACE.targetTimeout; waited += TOUR_PACE.poll) {
      const element = this.host.find(target);
      if (element) return element;
      await this.host.sleep(TOUR_PACE.poll, signal);
      if (signal.aborted) return null;
    }
    return null;
  }

  /** Real examples from the screen (the first enquiry, the open case…) fill the narration's placeholders. */
  private readExamples(tour: Tour) {
    for (const example of tour.examples ?? []) {
      if (this.values[example.key]) continue;
      const element = this.host.find(example.source);
      const text = (element?.getAttribute("title") || element?.textContent)?.replace(/\s+/gu, " ").trim();
      if (text) this.values[example.key] = text;
    }
  }

  /** Leaving a step: typed text goes; dialogs the tour opened close unless the next step points inside them. */
  private leave(upcoming: TourStep | undefined) {
    this.clearTyped();
    const keep = upcoming?.target ? this.host.find(upcoming.target) : null;
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
