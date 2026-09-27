// A language is listed once its dictionary is complete (`npm run i18n:missing` shows 0 for it).
export const languages = [
  { id: 'en', label: 'English', direction: 'ltr' },
  { id: 'ar', label: 'العربية · Arabic', direction: 'rtl' },
  { id: 'hi', label: 'हिन्दी · Hindi', direction: 'ltr' },
] as const;
export type AppLanguage = typeof languages[number]['id'];
export const LANGUAGE_COOKIE = 'wodana_language';
export function resolveLanguage(value: string | null | undefined): AppLanguage {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return languages.find(language => language.id === base)?.id ?? 'en';
}
export function languageDirection(locale: string): 'ltr' | 'rtl' {
  return /^(ar|ur|fa|he)(-|_|$)/i.test(locale) ? 'rtl' : 'ltr';
}

/** A supported language named by a cookie or locale ("ar", "ar-AE"), or null. */
export function supportedLanguage(value: string | null | undefined): AppLanguage | null {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return languages.find(language => language.id === base)?.id ?? null;
}

export type LanguageFallback ={ preferredLocale?: string | null; workspaceLocale?: string | null };
/**
 * The person's UI language: the language cookie (their choice on this device), else the language saved on
 * their profile, else the workspace's default language, else English. A profile locale of plain "en" is the
 * column default, so it counts as "not chosen"; a saved choice carries the workspace region ("en-AE").
 */
export function chooseLanguage(cookie: string | null | undefined, fallback: LanguageFallback = {}): AppLanguage {
  const chosen = supportedLanguage(cookie);
  if (chosen) return chosen;
  if (fallback.preferredLocale && fallback.preferredLocale.toLowerCase() !== 'en') return resolveLanguage(fallback.preferredLocale);
  return resolveLanguage(fallback.workspaceLocale);
}

/** The locale a saved language choice is stored as: the language with the workspace's region. */
export function preferenceLocale(language: AppLanguage, workspaceLocale?: string | null): string {
  const region = workspaceLocale?.split(/[-_]/)[1];
  return region ? `${language}-${region.toUpperCase()}` : language;
}

/** Numbers, money and dates: the person's language with the workspace's region, always in Latin digits. */
export function formattingLocale(language: string | null | undefined, workspaceLocale: string): string {
  const base = workspaceLocale.split('-u-')[0].replace(/_/g, '-');
  const [regionLanguage, ...rest] = base.split('-');
  const region = rest.find(part => /^[A-Za-z]{2}$|^\d{3}$/.test(part));
  // Built as a string (not Intl.Locale), so engines without it (Hermes on the phone) get the same tag.
  const latin = (tag: string) => `${tag}-u-nu-latn`;
  if (!language || language === regionLanguage?.toLowerCase()) return /^(ar|ur|fa)$/i.test(regionLanguage ?? '') ? latin(base) : base;
  return latin(region ? `${language}-${region.toUpperCase()}` : language);
}
