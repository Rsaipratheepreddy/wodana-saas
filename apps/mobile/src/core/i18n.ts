import { createContext, useCallback, useContext } from 'react';
import { languageDirection, languages, type AppLanguage } from '../../../web/lib/i18n/languages';

export { formattingLocale, languages, preferenceLocale, supportedLanguage, type AppLanguage } from '../../../web/lib/i18n/languages';

/**
 * Labels are the English text, the same keys as the web's `apps/web/lib/i18n/en.json`; the languages are the
 * web's (`apps/web/lib/i18n/languages.ts`) and their translations come from `npm run sync:i18n`.
 * `{name}` placeholders are filled from `vars`. This module stays free of native code (models and node tests
 * import it); `I18nProvider` in `i18n-provider.ts` remembers the choice and switches direction.
 */
export type Dictionary = Record<string, string>;

export type I18nValue = {
  language: AppLanguage;
  dictionary: Dictionary;
  /** Whether the person chose the language on this phone (otherwise it follows their profile or workspace). */
  chosen: boolean;
  ready: boolean;
  /** The person's own choice: remembered on this phone; a change of direction restarts the app once. */
  setLanguage: (language: AppLanguage) => Promise<void>;
  /** The profile's or workspace's language, used while the person has not chosen on this phone. */
  adopt: (language: AppLanguage) => void;
};
export const I18nContext = createContext<I18nValue>({ language: 'en', dictionary: {}, chosen: false, ready: true, setLanguage: async () => undefined, adopt: () => undefined });

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
  const { language, chosen, ready, setLanguage, adopt } = useContext(I18nContext);
  return { language, direction: languageDirection(language), chosen, ready, setLanguage, adopt, label: languages.find((item) => item.id === language)?.label ?? language };
}
