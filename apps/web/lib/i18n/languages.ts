export const languages = [
  { id: 'en', label: 'English', direction: 'ltr' },
  { id: 'ur', label: 'اردو · Urdu', direction: 'rtl' },
  { id: 'ar', label: 'العربية · Arabic', direction: 'rtl' },
  { id: 'hi', label: 'हिन्दी · Hindi', direction: 'ltr' },
  { id: 'te', label: 'తెలుగు · Telugu', direction: 'ltr' },
  { id: 'ml', label: 'മലയാളം · Malayalam', direction: 'ltr' },
  { id: 'ta', label: 'தமிழ் · Tamil', direction: 'ltr' },
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
