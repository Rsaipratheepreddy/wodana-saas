"use client";
import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { PreProjectCase } from "@/lib/pre-project/types";

type SelectedCase = { record: PreProjectCase; search: string } | null;
const Context = createContext<{ selected: SelectedCase; setSelected: Dispatch<SetStateAction<SelectedCase>> }>({ selected: null, setSelected: () => undefined });
export function PreProjectProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedCase>(null);
  return <Context.Provider value={{ selected, setSelected }}>{children}</Context.Provider>;
}
export const usePreProject = () => useContext(Context);
