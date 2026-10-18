"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Coordinates } from "./map-link";

/**
 * "Use my location": one fix from the browser's GPS (high accuracy, never a cached one), to six decimals.
 * `failed` once the browser has no location or the person declined.
 */
export function useCurrentPosition() {
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const locate = useCallback((onFix: (position: Coordinates) => void) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setFailed(true); return; }
    setLocating(true); setFailed(false);
    navigator.geolocation.getCurrentPosition((fix) => {
      if (!alive.current) return;
      setLocating(false);
      onFix({ latitude: Number(fix.coords.latitude.toFixed(6)), longitude: Number(fix.coords.longitude.toFixed(6)) });
    }, () => { if (alive.current) { setLocating(false); setFailed(true); } }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }, []);
  return { locate, locating, failed };
}
