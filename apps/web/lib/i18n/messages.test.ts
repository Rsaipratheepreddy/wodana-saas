import { describe, expect, it } from 'vitest';
import { languages, languageDirection, resolveLanguage } from './languages';
import { messages, missingTranslations, translator, type MessageKey } from './messages';
describe('language foundation', () => {
  it('keeps every dictionary a subset of English with matching placeholders', () => {
    const keys = new Set(Object.keys(messages.en));
    for (const { id } of languages) {
      const dictionary = messages[id];
      for (const [key, value] of Object.entries(dictionary) as [MessageKey, string][]) {
        expect(keys.has(key), `${id} has an entry that is not in en.json: ${key}`).toBe(true);
        expect(value.trim()).not.toBe('');
        expect((value.match(/\{\w+\}/g) ?? []).sort()).toEqual((messages.en[key].match(/\{\w+\}/g) ?? []).sort());
      }
    }
  });
  it('falls back to English for labels that are not translated yet', () => {
    const untranslated = missingTranslations().ar[0];
    if (untranslated) expect(translator('ar')(untranslated)).toBe(messages.en[untranslated]);
  });
  it('resolves region variants and uses RTL for both Arabic and Urdu', () => {
    expect(resolveLanguage('ur-PK')).toBe('ur');
    expect(resolveLanguage('AR-ae')).toBe('ar');
    expect(resolveLanguage('unknown')).toBe('en');
    for (const locale of ['ur', 'ur-PK', 'ar-AE']) expect(languageDirection(locale)).toBe('rtl');
    for (const locale of ['en', 'hi-IN', 'te-IN', 'ml-IN', 'ta-IN', 'art']) expect(languageDirection(locale)).toBe('ltr');
  });
  it('interpolates names as plain text without translating business data', () => {
    expect(translator('ar')('Your workspace is ready, {name}.', { name: 'Palm Living' })).toContain('Palm Living');
  });
});
