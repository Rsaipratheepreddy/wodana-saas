import en from './en.json';
import ar from './ar.json';
import hi from './hi.json';
import type { AppLanguage } from './languages';
import { translatorFor, type Dictionary, type MessageKey, type Translate } from './keys';

export { tKey, translatorFor, type Dictionary, type MessageKey, type Translate } from './keys';

/**
 * Every dictionary, for server code and tests. Client components must not import this module (it would ship
 * every language to the browser): they use `useT()`, and `I18nProvider` receives only the active dictionary.
 *
 * en.json is the single source of every user-facing label (the English text is the key). Other dictionaries
 * may lag behind: a missing entry falls back to English until `npm run i18n:translate` fills it.
 */
export const messages: Record<AppLanguage, Dictionary> & { en: Record<MessageKey, string> } = { en, ar, hi };

/** The active language's dictionary as sent to the browser (English needs none: its keys are its text). */
export function dictionaryFor(language: AppLanguage): Dictionary {
  return language === 'en' ? {} : messages[language];
}

export function translator(language: AppLanguage): Translate {
  return translatorFor(messages[language]);
}

/** Keys that still need translating, per language. */
export function missingTranslations() {
  const keys = Object.keys(en) as MessageKey[];
  return Object.fromEntries((Object.keys(messages) as AppLanguage[]).filter(id => id !== 'en')
    .map(id => [id, keys.filter(key => !messages[id][key])]));
}
