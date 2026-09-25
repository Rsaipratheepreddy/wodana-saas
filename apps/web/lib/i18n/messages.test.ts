import { describe, expect, it } from 'vitest';
import { languages, languageDirection, resolveLanguage } from './languages';
import { messages, translator, type MessageKey } from './messages';
describe('language foundation', () => {
  it('keeps every supported dictionary complete with matching placeholders', () => {
    const keys = Object.keys(messages.en).sort() as MessageKey[];
    for (const { id } of languages) {
      expect(Object.keys(messages[id]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(messages[id][key].trim()).not.toBe('');
        expect((messages[id][key].match(/\{\w+\}/g) ?? []).sort()).toEqual((messages.en[key].match(/\{\w+\}/g) ?? []).sort());
      }
    }
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
