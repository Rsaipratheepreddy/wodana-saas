"use client";

import { useCallback, useRef } from "react";

/** The CSS variable a table frame carries with its visible (not scrollable) inline size. */
export const TABLE_VISIBLE_INLINE_SIZE = "--wd-table-visible-inline-size";

/** Less than this much hidden width is rounding (a border, a focus ring), not content worth scrolling to. */
const OVERFLOW_SLACK = 8;

/**
 * Which inline sides of a scroll frame hide content: "end", "start", "both", or null when it all fits. Works in both
 * directions (an RTL frame scrolls with a negative or mirrored offset).
 */
export function overflowSides(frame: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollLeft">): "start" | "end" | "both" | null {
  const hidden = frame.scrollWidth - frame.clientWidth;
  if (hidden <= OVERFLOW_SLACK) return null;
  const scrolled = Math.abs(frame.scrollLeft);
  const start = scrolled > 1;
  const end = scrolled < hidden - 1;
  return start && end ? "both" : start ? "start" : end ? "end" : null;
}

/** Marks a scroll frame with `data-overflow` ("start" | "end" | "both") so its hidden side shows an edge fade. */
export function markOverflow(frame: HTMLElement) {
  const sides = overflowSides(frame);
  if (sides) frame.setAttribute("data-overflow", sides);
  else frame.removeAttribute("data-overflow");
}

/**
 * A callback ref for a table's scroll frame. It keeps `--wd-table-visible-inline-size` on the frame equal to
 * the frame's visible width, so a full-width message inside a wider table (the empty or no-results state)
 * can stick to the inline start and centre in what the person actually sees. It also marks the sides that hide
 * columns (`data-overflow`), because scrollbars are not drawn: the frame fades on that side (UX-030).
 */
export function useTableViewportRef<E extends HTMLElement>(forward?: { current: E | null }) {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((element: E | null) => {
    if (forward) forward.current = element;
    cleanup.current?.();
    cleanup.current = null;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) element.style.setProperty(TABLE_VISIBLE_INLINE_SIZE, `${element.clientWidth}px`);
      else element.style.removeProperty(TABLE_VISIBLE_INLINE_SIZE);
      markOverflow(element);
    };
    update();
    const onScroll = () => markOverflow(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(element);
      // The table inside grows with its columns and rows; the frame itself may keep its size.
      if (element.firstElementChild) observer.observe(element.firstElementChild);
    }
    cleanup.current = () => { element.removeEventListener("scroll", onScroll); observer?.disconnect(); };
  }, [forward]);
}
