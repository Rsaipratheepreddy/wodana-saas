import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorOffset, intersect, measureTarget, placeBubble, pointerTip, restingTip, sameBox, spotlightHole, visiblePart, watchTarget, type Box, type FrameScheduler } from "./position";

const view = { width: 1440, height: 900 };
const box = (top: number, left: number, width: number, height: number): Box => ({ top, left, width, height });

describe("where the cursor points", () => {
  it("points near the start of what can be seen, mirrored in right-to-left", () => {
    expect(pointerTip(box(100, 200, 300, 40), false)).toEqual({ x: 256, y: 120 });
    expect(pointerTip(box(100, 200, 300, 40), true)).toEqual({ x: 444, y: 120 });
    // A small control: the middle of it.
    expect(pointerTip(box(10, 10, 20, 20), false)).toEqual({ x: 20, y: 20 });
    // The cursor is laid out from the inline start: in right-to-left that is the right edge.
    expect(cursorOffset({ x: 444, y: 120 }, view, true)).toEqual({ x: 444 - 1440, y: 120 });
    expect(cursorOffset({ x: 256, y: 120 }, view, false)).toEqual({ x: 256, y: 120 });
  });

  it("only counts the part inside the viewport and every scrolling container around it", () => {
    // Inside a scroller that shows rows 100–300: a row at 250–290 is visible, one at 320 is not.
    const scroller = box(100, 0, 800, 200);
    expect(visiblePart(box(250, 20, 200, 40), [scroller], view)).toEqual(box(250, 20, 200, 40));
    expect(visiblePart(box(320, 20, 200, 40), [scroller], view)).toBeNull();
    // Half-scrolled: only the visible half is pointed at.
    expect(visiblePart(box(280, 20, 200, 40), [scroller], view)).toEqual(box(280, 20, 200, 20));
    // Off the screen altogether.
    expect(visiblePart(box(1200, 20, 200, 40), [], view)).toBeNull();
    // A sliver at an edge is not something to point at.
    expect(intersect(box(0, 0, 100, 100), box(98, 0, 100, 100))).toBeNull();
  });

  it("keeps the spotlight on screen and the bubble beside its target, never on it", () => {
    expect(spotlightHole(box(4, 4, 100, 40), view)).toEqual(box(0, 0, 112, 52));
    expect(spotlightHole(box(880, 1400, 100, 40), view)).toEqual(box(872, 1392, 48, 28));
    const bubble = { width: 380, height: 160 };
    const below = placeBubble(box(100, 100, 300, 40), bubble, view);
    expect(below.top).toBeGreaterThanOrEqual(140);
    const above = placeBubble(box(800, 100, 300, 40), bubble, view);
    expect(above.top + bubble.height).toBeLessThanOrEqual(800);
    // With nothing to point at, the bubble sits at the bottom, in the middle.
    expect(placeBubble(null, bubble, view)).toEqual({ top: 900 - 160 - 32, left: (1440 - 380) / 2 });
    expect(restingTip({ top: 500, left: 100, width: 380 }, false)).toEqual({ x: 124, y: 488 });
    expect(restingTip({ top: 500, left: 100, width: 380 }, true)).toEqual({ x: 456, y: 488 });
    expect(sameBox(box(1, 1, 1, 1), box(1.2, 1, 1, 1))).toBe(true);
    expect(sameBox(box(1, 1, 1, 1), null)).toBe(false);
  });
});

/** Frames run only when the test says so. */
function frames(): FrameScheduler & { flush(): void } {
  let queue: Array<() => void> = [];
  return {
    frame: (callback) => { queue.push(callback); return queue.length; },
    cancel: () => { queue = []; },
    flush() { for (let turn = 0; turn < 100 && queue.length; turn += 1) { const run = queue; queue = []; run.forEach((callback) => callback()); } },
  };
}

function placed(rect: Box) {
  const element = document.createElement("button");
  document.body.append(element);
  let current = rect;
  element.getBoundingClientRect = () => ({ ...current, right: current.left + current.width, bottom: current.top + current.height, x: current.left, y: current.top, toJSON: () => current }) as DOMRect;
  return { element, move: (next: Box) => { current = next; } };
}

describe("following a target", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("measures at once, follows scrolling and layout changes, and stops when told", () => {
    const { element, move } = placed(box(100, 100, 120, 32));
    const scheduler = frames();
    const seen = vi.fn();
    const stop = watchTarget(element, seen, scheduler);
    expect(seen).toHaveBeenLastCalledWith({ box: box(100, 100, 120, 32), visible: box(100, 100, 120, 32) });
    move(box(40, 100, 120, 32));
    window.dispatchEvent(new Event("scroll"));
    scheduler.flush();
    expect(seen).toHaveBeenLastCalledWith({ box: box(40, 100, 120, 32), visible: box(40, 100, 120, 32) });
    // Scrolled out of sight: there is nothing visible to point at.
    move(box(-200, 100, 120, 32));
    window.dispatchEvent(new Event("resize"));
    scheduler.flush();
    expect(seen).toHaveBeenLastCalledWith({ box: box(-200, 100, 120, 32), visible: null });
    const calls = seen.mock.calls.length;
    stop();
    move(box(300, 100, 120, 32));
    window.dispatchEvent(new Event("scroll"));
    scheduler.flush();
    expect(seen).toHaveBeenCalledTimes(calls);
  });

  it("never reports a target that has left the page or is hidden", () => {
    const { element } = placed(box(100, 100, 120, 32));
    expect(measureTarget(element, view)?.visible).not.toBeNull();
    element.style.visibility = "hidden";
    expect(measureTarget(element, view)?.visible).toBeNull();
    element.remove();
    expect(measureTarget(element, view)).toBeNull();
  });

  it("clips a target inside a scrolling dialog body to what the dialog shows", () => {
    const dialog = document.createElement("div");
    dialog.style.overflow = "auto";
    document.body.append(dialog);
    dialog.getBoundingClientRect = () => ({ top: 200, left: 400, width: 500, height: 300, right: 900, bottom: 500, x: 400, y: 200, toJSON: () => null }) as DOMRect;
    const row = document.createElement("button");
    dialog.append(row);
    row.getBoundingClientRect = () => ({ top: 480, left: 420, width: 200, height: 40, right: 620, bottom: 520, x: 420, y: 480, toJSON: () => null }) as DOMRect;
    expect(measureTarget(row, view)?.visible).toEqual(box(480, 420, 200, 20));
  });
});
