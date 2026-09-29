"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

/**
 * Whose choices are remembered: the signed-in person in this workspace. Set once by the workspace shell; with
 * no scope (a public page, a test) nothing is remembered.
 */
const RememberScope = createContext<string | null>(null);

export function RememberProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  return <RememberScope.Provider value={scope}>{children}</RememberScope.Provider>;
}

const PREFIX = "wodana.remember.v1:";

/**
 * The last choice this person made for `key` (the source of their last enquiry, the follow-up length they
 * use), to start the next form with it. Only on this device; a choice that is no longer offered is ignored by
 * the caller's `allowed` check.
 */
export function useRememberedChoice(key: string, allowed?: (value: string) => boolean) {
  const scope = useContext(RememberScope);
  const storageKey = scope ? `${PREFIX}${scope}:${key}` : null;
  const read = useCallback((): string | null => {
    if (!storageKey) return null;
    try {
      const value = window.localStorage.getItem(storageKey);
      return value && (!allowed || allowed(value)) ? value : null;
    } catch { return null; }
  }, [storageKey, allowed]);
  const remember = useCallback((value: string | null | undefined) => {
    if (!storageKey) return;
    try { if (value) window.localStorage.setItem(storageKey, value); else window.localStorage.removeItem(storageKey); } catch { /* storage off: nothing to remember */ }
  }, [storageKey]);
  return useMemo(() => ({ read, remember }), [read, remember]);
}
