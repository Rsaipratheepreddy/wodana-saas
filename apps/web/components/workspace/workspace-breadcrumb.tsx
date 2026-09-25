"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type Breadcrumb = { pathname: string; title: string };
const Context = createContext<{ current: Breadcrumb | null; register: (entry: Breadcrumb) => () => void } | null>(null);

export function WorkspaceBreadcrumbProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Breadcrumb | null>(null);
  const register = useCallback((entry: Breadcrumb) => {
    setCurrent(entry);
    return () => setCurrent(value => value === entry ? null : value);
  }, []);
  return <Context.Provider value={{ current, register }}>{children}</Context.Provider>;
}

export function useWorkspaceBreadcrumb(title?: string) {
  const pathname = usePathname();
  const context = useContext(Context);
  const register = context?.register;
  useEffect(() => {
    if (title) return register?.({ pathname, title });
  }, [pathname, title, register]);
  return context?.current?.pathname === pathname ? context.current : null;
}
