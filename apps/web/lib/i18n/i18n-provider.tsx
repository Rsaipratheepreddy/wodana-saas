"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGE_COOKIE, languageDirection, preferenceLocale, type AppLanguage } from "./languages";
import { translatorFor, type Dictionary, type Translate } from "./keys";

/**
 * Each language's dictionary is its own chunk: the browser downloads only the one in use. The server renders
 * the first page with the active dictionary (`dictionary` prop), so text never flashes in English.
 */
const loaders: Record<AppLanguage, () => Promise<Dictionary>> = {
  en: async () => ({}),
  ar: () => import("./ar.json").then((module) => module.default as Dictionary),
  hi: () => import("./hi.json").then((module) => module.default as Dictionary),
};

type I18nValue = {
  language: AppLanguage;
  t: Translate;
  /** Switches the interface language now and remembers it on this device. */
  setLanguage: (language: AppLanguage) => Promise<void>;
  isSwitching: boolean;
};

const english = translatorFor({});
const I18nContext = createContext<I18nValue>({ language: "en", t: english, setLanguage: async () => undefined, isSwitching: false });
/** The chosen UI language, or null outside an I18nProvider (the design system then follows its locale). */
export const UiLanguageContext = createContext<AppLanguage | null>(null);

function hasLanguageCookie() {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${LANGUAGE_COOKIE}=`));
}

export function rememberLanguage(language: AppLanguage) {
  document.cookie = `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

function applyToDocument(language: AppLanguage) {
  document.documentElement.lang = language;
  document.documentElement.dir = languageDirection(language);
}

/**
 * Provides the chosen language to client components. The server resolves it (cookie, then profile, then the
 * workspace default) and passes that language's dictionary; switching loads the new dictionary, updates
 * `<html lang dir>` at once and refreshes server-rendered text without a full reload.
 */
export function I18nProvider({ language, dictionary, children }: { language: AppLanguage; dictionary?: Dictionary; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ language: AppLanguage; dictionary: Dictionary | null }>({ language, dictionary: language === "en" ? {} : dictionary ?? null });
  const [served, setServed] = useState(language);
  const [isSwitching, setIsSwitching] = useState(false);
  const request = useRef(0);
  // The server rendered another language (after a refresh or a navigation): follow it.
  if (served !== language) {
    setServed(language);
    setState({ language, dictionary: language === "en" ? {} : dictionary ?? null });
  }
  // Rendered without its dictionary (tests, or a caller that has none): load it.
  useEffect(() => {
    if (state.dictionary) return;
    let active = true;
    void loaders[state.language]().then((loaded) => { if (active) setState((current) => current.language === state.language ? { ...current, dictionary: loaded } : current); });
    return () => { active = false; };
  }, [state.language, state.dictionary]);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    const id = ++request.current;
    setIsSwitching(true);
    rememberLanguage(next);
    try {
      const loaded = await loaders[next]();
      if (id !== request.current) return;
      applyToDocument(next);
      setState({ language: next, dictionary: loaded });
      router.refresh();
    } finally {
      if (id === request.current) setIsSwitching(false);
    }
  }, [router]);

  const value = useMemo<I18nValue>(() => ({
    language: state.language,
    t: state.dictionary ? translatorFor(state.dictionary) : english,
    setLanguage,
    isSwitching,
  }), [state, setLanguage, isSwitching]);
  return <UiLanguageContext.Provider value={state.language}><I18nContext.Provider value={value}>{children}</I18nContext.Provider></UiLanguageContext.Provider>;
}

/** Where a signed-in person's choice is also saved, so it follows them to other devices. */
export type LanguagePersistence = { workspaceId: string; workspaceLocale?: string | null };
const PersistenceContext = createContext<LanguagePersistence | null>(null);

/**
 * Inside the workspace: a language choice is also saved on the person's profile. When this device has no
 * choice yet, the language the server picked (profile, then workspace default) is remembered here too.
 */
export function LanguagePreferenceProvider({ persist, resolved, children }: { persist: LanguagePersistence | null; resolved?: AppLanguage; children: ReactNode }) {
  useEffect(() => {
    if (!resolved || hasLanguageCookie()) return;
    rememberLanguage(resolved);
    applyToDocument(resolved);
  }, [resolved]);
  return <PersistenceContext.Provider value={persist}>{children}</PersistenceContext.Provider>;
}

/** Saves the choice on the person's profile. Best effort: the cookie already holds it on this device. */
async function saveLanguagePreference(language: AppLanguage, persist: LanguagePersistence) {
  await fetch("/api/workspace/profile/language", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: persist.workspaceId, preferredLocale: preferenceLocale(language, persist.workspaceLocale) }),
  }).catch(() => null);
}

/** Translator for the current language: `t("Label")`, with keys from en.json. */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

/** The current language, and a switch that also saves the choice on the profile when signed in. */
export function useLanguage() {
  const { language, setLanguage, isSwitching } = useContext(I18nContext);
  const persist = useContext(PersistenceContext);
  const chooseLanguage = useCallback(async (next: AppLanguage) => {
    await Promise.all([setLanguage(next), persist ? saveLanguagePreference(next, persist) : null]);
  }, [persist, setLanguage]);
  return { language, direction: languageDirection(language), setLanguage: chooseLanguage, isSwitching };
}
