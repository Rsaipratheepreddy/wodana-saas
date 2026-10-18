"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme-bootstrap";

type WorkspaceTheme = "dark" | "light";
const THEME_CHANGE_EVENT = "wodana-theme-change";

function themeSnapshot(): WorkspaceTheme {
  if (typeof window === "undefined") return "light";
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  } catch {
    // Theme switching still works when the browser blocks persistent storage.
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToTheme(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    media.removeEventListener("change", onStoreChange);
  };
}

export function useWorkspaceTheme() {
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, () => "light");

  // The root layout's inline bootstrap puts the theme on <html> before paint. This keeps it there when the
  // device's preference or another tab's choice changes, and after React's development remount clears it. It
  // writes what is stored, not the value rendered while hydrating (always light), so a dark page never blinks.
  useLayoutEffect(() => {
    const current = themeSnapshot();
    if (document.documentElement.dataset.theme !== current) document.documentElement.dataset.theme = current;
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* Use the current page preference. */ }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return { theme, toggleTheme };
}
