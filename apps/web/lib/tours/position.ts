/**
 * Where Woddy's cursor, spotlight and bubble go. Pure geometry (unit-tested) plus one DOM reader that turns an
 * element into the part of it a person can actually see: inside the viewport and every scrolling or clipping
 * container around it (a dialog body, a table scroller, a popover).
 */
export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** What the overlay needs to know about a target right now. */
export type TargetView = {
  /** The target's whole box (with an open list it controls), for the spotlight. */
  box: Box;
  /** The part that is on screen; null when nothing of it can be seen (scrolled away, clipped, hidden). */
  visible: Box | null;
};

export const SPOT_PADDING = 8;
const GAP = 16;
const EDGE = 16;
/** Smaller than this (in either direction) counts as not visible: a sliver at a scroller's edge. */
const MIN_VISIBLE = 4;

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

export function sameView(a: TargetView | null, b: TargetView | null): boolean {
  if (!a || !b) return a === b;
  return sameBox(a.box, b.box) && sameBox(a.visible, b.visible);
}

/** The overlap of two boxes, or null when they don't meet. */
export function intersect(a: Box, b: Box): Box | null {
  const top = Math.max(a.top, b.top);
  const left = Math.max(a.left, b.left);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const right = Math.min(a.left + a.width, b.left + b.width);
  if (bottom - top < MIN_VISIBLE || right - left < MIN_VISIBLE) return null;
  return { top, left, width: right - left, height: bottom - top };
}

/** The part of `box` inside the viewport and every clipping container around it. */
export function visiblePart(box: Box, clips: Box[], view: Size): Box | null {
  let visible: Box | null = intersect(box, { top: 0, left: 0, width: view.width, height: view.height });
  for (const clip of clips) {
    if (!visible) return null;
    visible = intersect(visible, clip);
  }
  return visible;
}

/**
 * The cursor's tip: near the start of what is visible of the target (the inline start, so it mirrors in
 * right-to-left), never more than a short reach into a wide or tall element.
 */
export function pointerTip(visible: Box, rtl: boolean): Point {
  const reachX = Math.min(visible.width / 2, 56);
  const reachY = Math.min(visible.height / 2, 28);
  return { x: rtl ? visible.left + visible.width - reachX : visible.left + reachX, y: visible.top + reachY };
}

/** The spotlight's cut-out: the target with a little room around it, kept on screen. */
export function spotlightHole(box: Box, view: Size, padding = SPOT_PADDING): Box {
  const top = Math.max(0, box.top - padding);
  const left = Math.max(0, box.left - padding);
  const bottom = Math.min(view.height, box.top + box.height + padding);
  const right = Math.min(view.width, box.left + box.width + padding);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Where the bubble goes: beside the target, never on it; pinned to the bottom when the target fills the screen. */
export function placeBubble(target: Box | null, bubble: Size, view: Size): { top: number; left: number } {
  const clampLeft = (left: number) => Math.min(Math.max(EDGE, left), view.width - bubble.width - EDGE);
  const clampTop = (top: number) => Math.min(Math.max(EDGE, top), view.height - bubble.height - EDGE);
  if (!target) return { top: view.height - bubble.height - EDGE * 2, left: (view.width - bubble.width) / 2 };
  const below = view.height - (target.top + target.height);
  if (below >= bubble.height + GAP * 2) return { top: target.top + target.height + GAP, left: clampLeft(target.left) };
  if (target.top >= bubble.height + GAP * 2) return { top: target.top - bubble.height - GAP, left: clampLeft(target.left) };
  const after = view.width - (target.left + target.width);
  if (after >= bubble.width + GAP * 2) return { top: clampTop(target.top), left: target.left + target.width + GAP };
  if (target.left >= bubble.width + GAP * 2) return { top: clampTop(target.top), left: target.left - bubble.width - GAP };
  return { top: view.height - bubble.height - EDGE, left: clampLeft(view.width - bubble.width - EDGE) };
}

/** Where the cursor rests when a step points at nothing: just above the bubble's start corner. */
export function restingTip(bubble: { top: number; left: number; width: number }, rtl: boolean): Point {
  return { x: rtl ? bubble.left + bubble.width - 24 : bubble.left + 24, y: bubble.top - 12 };
}

/** Converts a physical x into the cursor's transform, which is laid out from the inline start. */
export function cursorOffset(tip: Point, view: Size, rtl: boolean): Point {
  return { x: rtl ? tip.x - view.width : tip.x, y: tip.y };
}

function toBox(rect: DOMRect | { top: number; left: number; width: number; height: number }): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

const CLIPPING = /(auto|scroll|hidden|clip)/;

/** The element as seen right now: its box and the part of it that is visible, or null when it is gone. */
export function measureTarget(element: HTMLElement | null, view: Size): TargetView | null {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none" || (style.opacity !== "" && Number(style.opacity) === 0)) return { box: toBox(rect), visible: null };
  // A field's open suggestions belong to it: keep them in the spotlight.
  let box = toBox(rect);
  const controlled = element.getAttribute("aria-controls");
  const list = controlled && element.getAttribute("aria-expanded") === "true" ? document.getElementById(controlled)?.getBoundingClientRect() : null;
  if (list && (list.width || list.height)) {
    const top = Math.min(rect.top, list.top), left = Math.min(rect.left, list.left);
    box = { top, left, width: Math.max(rect.right, list.right) - left, height: Math.max(rect.bottom, list.bottom) - top };
  }
  const clips: Box[] = [];
  for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.position === "fixed") {
      // A fixed layer (a dialog, a popover) is clipped only by itself and the viewport.
      if (CLIPPING.test(parentStyle.overflow + parentStyle.overflowX + parentStyle.overflowY)) clips.push(toBox(parent.getBoundingClientRect()));
      break;
    }
    if (CLIPPING.test(parentStyle.overflow + parentStyle.overflowX + parentStyle.overflowY)) clips.push(toBox(parent.getBoundingClientRect()));
  }
  const visible = visiblePart(rect, clips, view);
  return { box, visible: visible && covered(element, visible) ? null : visible };
}

/**
 * Whether something else sits on top of the visible part (a dialog's backdrop, a drawer, a sticky bar): the
 * middle of it is checked, ignoring Woddy's own layers.
 */
function covered(element: HTMLElement, visible: Box): boolean {
  if (typeof document.elementsFromPoint !== "function") return false;
  const x = visible.left + visible.width / 2, y = visible.top + visible.height / 2;
  const top = document.elementsFromPoint(x, y).find((node) => !node.closest(".wd-tour, .wd-tour-loader"));
  return Boolean(top && top !== element && !element.contains(top) && !top.contains(element));
}

export function viewport(): Size {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
}

export type FrameScheduler = { frame: (callback: () => void) => number; cancel: (id: number) => void };
const browserFrames: FrameScheduler = {
  frame: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};
/** Frames a moving layout is followed for after something changed (a drawer sliding in, a smooth scroll). */
const SETTLE_FRAMES = 45;
/** A last resort for changes no event reports (a CSS animation): look again this often. */
const FALLBACK_MS = 400;

/**
 * Keeps an element's `TargetView` current: on scroll (any container), resize, layout shifts (ResizeObserver),
 * DOM changes (MutationObserver) and the end of transitions, following a moving layout frame by frame until it
 * settles. Calls `onChange` only when something moved. Returns the function that stops watching.
 */
export function watchTarget(element: HTMLElement | null, onChange: (view: TargetView | null) => void, scheduler: FrameScheduler = browserFrames): () => void {
  let last: TargetView | null | undefined;
  let frame = 0;
  let still = 0;
  const measure = () => {
    const next = measureTarget(element, viewport());
    if (last === undefined || !sameView(last, next)) { last = next; still = 0; onChange(next); }
    else still += 1;
  };
  const follow = () => {
    frame = 0;
    measure();
    if (still < SETTLE_FRAMES) frame = scheduler.frame(follow);
  };
  const changed = () => {
    still = 0;
    if (!frame) frame = scheduler.frame(follow);
  };
  measure();
  if (!element) return () => undefined;
  const passive = { capture: true, passive: true } as const;
  window.addEventListener("scroll", changed, passive);
  window.addEventListener("resize", changed, passive);
  window.visualViewport?.addEventListener("resize", changed, passive);
  document.addEventListener("transitionend", changed, passive);
  document.addEventListener("animationend", changed, passive);
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(changed);
  resize?.observe(element);
  resize?.observe(document.documentElement);
  // The overlay's own updates are not layout changes of the page.
  const outside = (record: MutationRecord) => {
    const node = record.target instanceof Element ? record.target : record.target.parentElement;
    return !node?.closest(".wd-tour, .wd-tour-loader");
  };
  const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver((records) => { if (records.some(outside)) changed(); });
  mutation?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "aria-expanded", "data-state"] });
  const timer = window.setInterval(measure, FALLBACK_MS);
  changed();
  return () => {
    window.removeEventListener("scroll", changed, passive);
    window.removeEventListener("resize", changed, passive);
    window.visualViewport?.removeEventListener("resize", changed, passive);
    document.removeEventListener("transitionend", changed, passive);
    document.removeEventListener("animationend", changed, passive);
    resize?.disconnect();
    mutation?.disconnect();
    window.clearInterval(timer);
    if (frame) scheduler.cancel(frame);
  };
}
