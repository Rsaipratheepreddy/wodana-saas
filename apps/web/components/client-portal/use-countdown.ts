"use client";

import { useEffect, useState } from "react";

/** A moment some seconds from now (for when a new code can be asked for). */
export const secondsFromNow = (seconds: number) => Date.now() + seconds * 1000;

/** Seconds left until a new code can be asked for. */
export function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    if (until <= Date.now()) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
