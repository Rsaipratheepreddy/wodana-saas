import en from './en.json';
import ar from './ar.json';
import ur from './ur.json';
import hi from './hi.json';
import te from './te.json';
import ml from './ml.json';
import ta from './ta.json';
import type { AppLanguage } from './languages';

/**
 * en.json is the single source of every user-facing label (the English text is the key).
 * Other dictionaries may lag behind: a missing entry falls back to English until the
 * translation pass (`npm run i18n:missing` lists what is left).
 */
export type MessageKey = keyof typeof en;
export type Dictionary = Partial<Record<MessageKey, string>>;
export const messages: Record<AppLanguage, Dictionary> & { en: Record<MessageKey, string> } = { en, ar, ur, hi, te, ml, ta };

export function translator(language: AppLanguage) {
  return (key: MessageKey, values: Record<string, string | number> = {}) => {
    const message = messages[language][key] ?? en[key];
    return message.replace(/\{(\w+)\}/g, (token: string, name: string) => String(values[name] ?? token));
  };
}

/** Keys that still need translating, per language. */
export function missingTranslations() {
  const keys = Object.keys(en) as MessageKey[];
  return Object.fromEntries((Object.keys(messages) as AppLanguage[]).filter(id => id !== 'en')
    .map(id => [id, keys.filter(key => !messages[id][key])]));
}
