"use client";

import { useSyncExternalStore } from "react";

const subscribeNothing = () => () => undefined;

/**
 * False on the server and during hydration, true once the page runs in the browser. Text that depends on the clock
 * or on the runtime's own date formatting (the server's ICU differs from the browser's: "1 – 12 Oct" vs "1–12 Oct")
 * renders only then, so the server and the first client render always match (QA-009).
 */
export function useHydrated() {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}
