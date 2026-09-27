"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

/** Light or dark, following the client's device (the portal has no theme switch of its own). */
export function useDeviceTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, () => (window.matchMedia?.(QUERY).matches ? "dark" : "light"), () => "light");
}
