"use client";

import { createContext, useContext, type ReactNode } from "react";

/** A list's workspace default (plan §0.7 R14): the columns that start hidden for everyone. */
export type GridDefault = { hiddenColumns: string[]; version: number; canManage: boolean };

/** Where lists read and save their workspace default. Set once by the workspace shell. */
export type GridDefaultsSource = {
  load: (gridKey: string) => Promise<GridDefault>;
  save: (gridKey: string, input: { hiddenColumns: string[]; version: number; requestId: string }) => Promise<GridDefault>;
};

const Context = createContext<GridDefaultsSource | null>(null);

/** With no source (a public page, a test) a list keeps its own columns and offers no workspace default. */
export function GridDefaultsProvider({ source, children }: { source: GridDefaultsSource | null; children: ReactNode }) {
  return <Context.Provider value={source}>{children}</Context.Provider>;
}

export function useGridDefaultsSource() {
  return useContext(Context);
}
