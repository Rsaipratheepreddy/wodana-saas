/** Optional tactile cue for a deliberate interaction; never required for feedback. */
export function emitHapticFeedback(kind: "selection" | "success" = "selection"): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(kind === "success" ? 12 : 8);
  } catch {
    return false;
  }
}
