"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Focus = { title: string; backHref: string };
const Context = createContext<{ current: Focus | null; register: (focus: Focus) => () => void } | null>(null);
export function WorkspaceFocusProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Focus[]>([]);
  const register = useCallback((focus: Focus) => { setEntries((old) => [...old, focus]); return () => setEntries((old) => old.filter((entry) => entry !== focus)); }, []);
  return <Context.Provider value={{ current: entries.at(-1) ?? null, register }}>{children}</Context.Provider>;
}
export function useWorkspaceFocus(title?: string, backHref = "/workspace/crm") {
  const context = useContext(Context), register = context?.register;
  useEffect(() => { if (title) return register?.({ title, backHref }); }, [title, backHref, register]);
  return context?.current ?? null;
}
