"use client";

import { useEffectEvent, useLayoutEffect, type RefObject } from "react";

/**
 * Brings a popover's trigger fully into view (a dialog's scrolling body, the page) before the popover opens, so
 * the popover is placed against a trigger the person can see and has room to open below or flip above it.
 */
export function revealAnchor(anchor: HTMLElement | null) {
  anchor?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/**
 * While a popover is open, closes it when something that holds its trigger scrolls and the trigger moves (a
 * dialog's body, the page). The list's own scrolling, and scrolling that leaves the trigger where it was, keep
 * it open. Without this the popover would stay where it opened, detached from its field.
 */
export function useCloseOnAnchorScroll(anchorRef: RefObject<HTMLElement | null>, isOpen: boolean, close: () => void) {
  const onMoved = useEffectEvent(close);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!isOpen || !anchor) return;
    // Measured once the popover is placed (after revealAnchor scrolled the trigger into view).
    const start = anchor.getBoundingClientRect();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !target.contains(anchor)) return;
      const now = anchor.getBoundingClientRect();
      if (Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1) onMoved();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [anchorRef, isOpen]);
}
