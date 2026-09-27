"use client";

import { useSyncExternalStore } from "react";

/** Phone width: below the shell's 40rem breakpoint. Tablets and desktops are wider. */
export const PHONE_MEDIA_QUERY = "(max-width: 40rem)";

/** Whether a media query matches now, updating as the viewport changes. False while rendering on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", notify);
      return () => list?.removeEventListener?.("change", notify);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
