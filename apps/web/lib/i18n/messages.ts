import en from './en.json';
import ar from './ar.json';
import ur from './ur.json';
import hi from './hi.json';
import te from './te.json';
import ml from './ml.json';
import ta from './ta.json';
import type { AppLanguage } from './languages';
export const messages = { en, ar, ur, hi, te, ml, ta };
export type MessageKey = keyof typeof en;
export function translator(language: AppLanguage) {
  return (key: MessageKey, values: Record<string, string | number> = {}) => {
    const message = messages[language][key] ?? en[key];
    return message.replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
  };
}
