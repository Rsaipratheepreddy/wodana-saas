"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { languageDirection, type AppLanguage } from "./languages";
import { translator } from "./messages";

const I18nContext = createContext<AppLanguage>("en");

/** Provides the chosen language to client components; the server resolves it from the language cookie. */
export function I18nProvider({ language, children }: { language: AppLanguage; children: ReactNode }) {
  return <I18nContext.Provider value={language}>{children}</I18nContext.Provider>;
}

/** Translator for the current language: `t("Label")`, with keys from en.json. */
export function useT() {
  const language = useContext(I18nContext);
  return useMemo(() => translator(language), [language]);
}

export function useLanguage() {
  const language = useContext(I18nContext);
  return { language, direction: languageDirection(language) };
}
