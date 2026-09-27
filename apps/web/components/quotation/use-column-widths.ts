"use client";

import { useCallback, useState, useSyncExternalStore, type PointerEvent } from "react";

const KEY = "wodana.quote.widths";
const read = () => { try { return window.localStorage.getItem(KEY) ?? "{}"; } catch { return "{}"; } };
const subscribe = (notify: () => void) => { window.addEventListener(KEY, notify); window.addEventListener("storage", notify); return () => { window.removeEventListener(KEY, notify); window.removeEventListener("storage", notify); }; };

/**
 * Column widths someone set by dragging a heading's edge, remembered on this device. While dragging,
 * the width follows the pointer; it's saved when the pointer lets go. A double-click puts it back.
 */
export function useColumnWidths(defaults: Record<string, number>, minimum = 48) {
  const saved = useSyncExternalStore(subscribe, read, () => "{}");
  const [dragging, setDragging] = useState<{ key: string; width: number } | null>(null);
  const stored = JSON.parse(saved) as Record<string, number>;
  const width = (key: string) => (dragging?.key === key ? dragging.width : stored[key] ?? defaults[key] ?? minimum);
  const save = useCallback((key: string, value: number | null) => {
    const next = { ...(JSON.parse(read()) as Record<string, number>) };
    if (value === null) delete next[key]; else next[key] = Math.round(value);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(KEY));
  }, []);
  const startResize = (key: string) => (event: PointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    const start = event.clientX, from = width(key);
    const rtl = getComputedStyle(handle).direction === "rtl";
    handle.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => setDragging({ key, width: Math.max(minimum, from + (next.clientX - start) * (rtl ? -1 : 1)) });
    const end = (last: globalThis.PointerEvent) => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end);
      save(key, Math.max(minimum, from + (last.clientX - start) * (rtl ? -1 : 1)));
      setDragging(null);
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  };
  // Keyboard: arrow keys on the edge widen or narrow the column.
  const nudge = (key: string, delta: number) => save(key, Math.max(minimum, width(key) + delta));
  return { width, startResize, nudge, reset: (key: string) => save(key, null) };
}
