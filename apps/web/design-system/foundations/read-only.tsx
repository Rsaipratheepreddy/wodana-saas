"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Why changes are off for everything below (for example "Read-only while viewing as Sara"), or null when they
 * are on. The shared Button, Switch, FileUploader, Form and action menus read it, so a page needs no code of its
 * own: an action that would write shows disabled with this reason as its tooltip. The server refuses the change
 * anyway; this only keeps people from trying.
 */
const ReadOnlyContext = createContext<string | null>(null);

export function ReadOnlyProvider({ reason, children }: { reason: string | null; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={reason}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnlyReason(): string | null {
  return useContext(ReadOnlyContext);
}
