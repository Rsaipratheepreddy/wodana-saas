import type en from "./en.json";

/**
 * Client-safe i18n helpers. They never import a dictionary: the English text is the key, so a label that is
 * not translated yet simply shows its key. Components get their dictionary through `I18nProvider`.
 */
export type MessageKey = keyof typeof en;
export type Dictionary = Partial<Record<MessageKey, string>>;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * Marks an English label kept in a constant (option lists, status maps) so `npm run i18n:extract`
 * adds it to en.json; translate it where it renders: `t(item.label)`.
 */
export function tKey(key: string): MessageKey {
  return key as MessageKey;
}

/** `t()` over one dictionary; `{name}` placeholders are filled from `values`. */
export function translatorFor(dictionary: Dictionary): Translate {
  return (key, values = {}) => {
    const message = dictionary[key] ?? String(key);
    return message.replace(/\{(\w+)\}/g, (token: string, name: string) => String(values[name] ?? token));
  };
}

/** A server message in the person's language when it is a known label; otherwise the message as sent. */
export function translateKnown(t: Translate, message: string): string {
  return t(message as MessageKey);
}
