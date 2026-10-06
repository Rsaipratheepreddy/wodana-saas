"use client";

import { useCallback, useRef } from "react";

/** The CSS variable a table frame carries with its visible (not scrollable) inline size. */
export const TABLE_VISIBLE_INLINE_SIZE = "--wd-table-visible-inline-size";

/**
 * A callback ref for a table's scroll frame. It keeps `--wd-table-visible-inline-size` on the frame equal to
 * the frame's visible width, so a full-width message inside a wider table (the empty or no-results state)
 * can stick to the inline start and centre in what the person actually sees.
 */
export function useTableViewportRef<E extends HTMLElement>(forward?: { current: E | null }) {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((element: E | null) => {
    if (forward) forward.current = element;
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) element.style.setProperty(TABLE_VISIBLE_INLINE_SIZE, `${element.clientWidth}px`);
      else element.style.removeProperty(TABLE_VISIBLE_INLINE_SIZE);
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(update);
      observer.current.observe(element);
    }
  }, [forward]);
}
