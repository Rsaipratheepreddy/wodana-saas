"use client";

import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { DesignSystemProvider } from "@/design-system";

const DARK = "(prefers-color-scheme: dark)";

const noop = () => () => undefined;

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Sets the theme before the page paints, so a dark system never flashes the light page (React then keeps
 * the same value once it hydrates).
 */
const BEFORE_PAINT = `(function(){try{var d=window.matchMedia(${JSON.stringify(DARK)}).matches?"dark":"light";`
  + `var e=document.currentScript&&document.currentScript.parentElement;if(e)e.setAttribute("data-wd-theme",d);`
  + `document.documentElement.setAttribute("data-theme",d)}catch(_){}})();`;

/**
 * The public pages' surface: the design-system provider in the visitor's system theme (light or dark) and
 * the brand colour. The product screenshots follow the same system setting, so the page and its images agree.
 */
export function MarketingSurface({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const dark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK).matches, () => false);
  // True once the page has hydrated: the script is only needed in the server's HTML (a page opened by a
  // client-side navigation already knows the theme, and React never runs a script it renders itself).
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const theme = dark ? "dark" : "light";
  // The document's own background follows too; leaving the public pages hands it back to the next page light.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { document.documentElement.dataset.theme = "light"; };
  }, [theme]);
  return <DesignSystemProvider className={className} style={style} suppressHydrationWarning theme={theme}>
    {hydrated ? null : <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} suppressHydrationWarning />}
    {children}
  </DesignSystemProvider>;
}
