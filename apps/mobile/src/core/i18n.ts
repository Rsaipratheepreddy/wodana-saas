import { createContext, createElement, useCallback, useContext, useMemo, type PropsWithChildren } from 'react';

/**
 * Labels are the English text, the same keys as the web's `apps/web/lib/i18n/en.json`; another
 * language supplies a dictionary for those keys. `{name}` placeholders are filled from `vars`.
 */
type Dictionary = Record<string, string>;
const RTL = new Set(['ar', 'he', 'fa', 'ur']);
const I18nContext = createContext<{ language: string; dictionary: Dictionary }>({ language: 'en', dictionary: {} });

export function I18nProvider({ language = 'en', dictionary = {}, children }: PropsWithChildren<{ language?: string; dictionary?: Dictionary }>) {
  const value = useMemo(() => ({ language, dictionary }), [language, dictionary]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function translate(dictionary: Dictionary, key: string, vars?: Record<string, string | number>) {
  const text = dictionary[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text;
}

/** Marks English text used as a label key where `t()` runs later (tables of labels); the i18n check reads these. */
export const key = <S extends string>(text: S) => text;

export type T = (key: string, vars?: Record<string, string | number>) => string;
export function useT(): T {
  const { dictionary } = useContext(I18nContext);
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(dictionary, key, vars), [dictionary]);
}
export function useLanguage() {
  const { language } = useContext(I18nContext);
  return { language, direction: RTL.has(language.split('-')[0]) ? ('rtl' as const) : ('ltr' as const) };
}
