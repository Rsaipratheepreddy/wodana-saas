import { getCountries, getCountryCallingCode, getExampleNumber, isSupportedCountry, parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from 'libphonenumber-js/max';
import mobileExamples from 'libphonenumber-js/examples.mobile.json';
import countryNames from './country-names.json';

/**
 * Phone numbers on the phone, by the web's rules (apps/web/lib/phone.ts, ported because that file imports through the
 * web's `@/` paths): a country picker and the local number, stored and sent as one E.164 number. The country comes
 * from the region (never a constant); nothing is guessed from digits alone. Pure, so node tests import it.
 */

/** The region of a locale tag ("ar-AE", "en_IN", "zh-Hant-TW"), read as a string: Hermes has no Intl.Locale. */
export function regionOf(locale: string | null | undefined): string | undefined {
  const parts = (locale ?? '').split('-u-')[0].replace(/_/g, '-').split('-').slice(1);
  const region = parts.find((part) => /^[A-Za-z]{2}$/.test(part));
  return region?.toUpperCase();
}

const supported = (country: string | null | undefined): CountryCode | undefined => {
  const upper = country?.trim().toUpperCase();
  return upper && isSupportedCountry(upper) ? upper as CountryCode : undefined;
};

/** Resolve a contact's country first, then the locale's region. */
export function phoneCountry(contactCountry?: string | null, locale?: string | null): CountryCode | undefined {
  return supported(contactCountry) ?? supported(regionOf(locale));
}

const deviceLocale = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { return ''; }
};

/** The country a sign-in starts on: the firm's (its portal's region), else this phone's region; '' when neither is known. */
export function defaultPhoneCountry(region: { country?: string | null; locale?: string | null } | null | undefined, device: string | null = deviceLocale()): string {
  return phoneCountry(region?.country, region?.locale) ?? phoneCountry(null, device) ?? '';
}

/** Text that reads left to right inside any sentence (U+2066 … U+2069), so RTL never moves a "+" or reorders digits. */
export const ltrText = (text: string) => `\u2066${text}\u2069`;

/** The flag of a country code, from its two letters. */
export const flagOf = (country: string) => [...country.toUpperCase()].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join('');

/** "+971" for a supported country. */
export const callingCode = (country: string) => (supported(country) ? `+${getCountryCallingCode(supported(country)!)}` : '');

type Names = { of: (code: string) => string | undefined };
/** Names bundled per app language (scripts/gen-country-names.mjs) for engines without Intl.DisplayNames, such as Hermes. */
const bundled = (locale: string): Names | null => {
  const table = (countryNames as Record<string, Record<string, string>>)[locale.split(/[-_]/)[0]?.toLowerCase() ?? ''] ?? countryNames.en;
  return { of: (code) => table[code] };
};
const regionNames = (locale: string): Names | null => {
  const Display = (Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: 'region' }) => Names }).DisplayNames;
  if (!Display) return bundled(locale);
  try { return new Display([locale], { type: 'region' }); } catch { try { return new Display([], { type: 'region' }); } catch { return bundled(locale); } }
};

/** The country's name in `locale`, or its code where the engine has no region names. */
export function countryName(country: string, locale: string) {
  return regionNames(locale)?.of(country.toUpperCase()) ?? country.toUpperCase();
}

/** Country codes with their names in `locale` (the person's language with the region): flag and code, then the name. */
export function phoneCountryOptions(locale: string) {
  const names = regionNames(locale);
  return getCountries().map((id) => {
    const name = names?.of(id) ?? id;
    return { id, label: ltrText(`${flagOf(id)} +${getCountryCallingCode(id)}`), description: name };
  }).sort((a, b) => a.description.localeCompare(b.description));
}

/**
 * Splits what was stored or pasted into the country picker and the local number, so the code is
 * never shown (or saved) twice. "+91 77807 68279", "0091…" or a stored "+917780768279" all become
 * { country: "IN", national: "7780768279" }. A leading trunk 0 ("050 123 4567" in AE) is dropped.
 */
export function splitPhone(raw: string, country?: string | null): { country: string; national: string } {
  const current = (country ?? '').toUpperCase();
  const trimmed = raw.trim();
  if (!trimmed) return { country: current, national: '' };
  const international = trimmed.startsWith('+') ? trimmed : trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : null;
  if (international) {
    const parsed = parsePhoneNumberFromString(international, { extract: false });
    // Codes shared by several countries (+1, +44, +7): keep the chosen country when it shares the code.
    const sameCode = parsed && current && isSupportedCountry(current) && getCountryCallingCode(current as CountryCode) === parsed.countryCallingCode;
    if (parsed && sameCode) return { country: current, national: String(parsed.nationalNumber) };
    if (parsed?.country) return { country: parsed.country, national: String(parsed.nationalNumber) };
    if (parsed) return { country: current, national: String(parsed.nationalNumber) };
    return { country: current, national: trimmed };
  }
  if (current && isSupportedCountry(current)) {
    const code = getCountryCallingCode(current as CountryCode);
    const digits = trimmed.replace(/[^\d]/g, '');
    // The calling code typed without "+" (e.g. 9715… with +971 selected) when that makes a valid number.
    if (digits.startsWith(code)) {
      const withoutCode = parsePhoneNumberFromString(`+${digits}`, { extract: false });
      if (withoutCode?.isValid() && withoutCode.country === current) return { country: current, national: String(withoutCode.nationalNumber) };
    }
    const parsed = parsePhoneNumberFromString(trimmed, { defaultCountry: current as CountryCode, extract: false });
    if (parsed && parsed.country === current && parsed.isValid()) return { country: current, national: String(parsed.nationalNumber) };
  }
  return { country: current, national: trimmed };
}

export type PhoneProblemText = {
  tooShort: (country: string, code: string, digits: number) => string;
  tooLong: (country: string, code: string, digits: number) => string;
  invalid: (country: string) => string;
  notMobile: (country: string) => string;
  chooseCountry: string;
};

/** Checks a local number against the selected country; returns a message for the person, or null. */
export function phoneProblem(national: string, country: string, text: PhoneProblemText, options: { mobile?: boolean; locale?: string } = {}): string | null {
  const value = national.trim();
  if (!value) return null;
  const upper = country.toUpperCase();
  if (!upper || !isSupportedCountry(upper)) return text.chooseCountry;
  const code = `+${getCountryCallingCode(upper as CountryCode)}`;
  const name = countryName(upper, options.locale ?? 'en');
  const example = getExampleNumber(upper as CountryCode, mobileExamples);
  const expected = example ? String(example.nationalNumber).length : 0;
  const length = validatePhoneNumberLength(value, upper as CountryCode);
  if (length === 'TOO_SHORT') return text.tooShort(name, code, expected);
  if (length === 'TOO_LONG') return text.tooLong(name, code, expected);
  const parsed = parsePhoneNumberFromString(value, { defaultCountry: upper as CountryCode, extract: false });
  if (!parsed?.isValid() || (parsed.country && parsed.country !== upper)) {
    // Some countries allow longer numbers of other types; for a mobile, compare with the mobile length.
    const digits = value.replace(/\D/g, '').replace(/^0+/, '').length;
    if (options.mobile && expected && digits > expected) return text.tooLong(name, code, expected);
    if (options.mobile && expected && digits < expected) return text.tooShort(name, code, expected);
    return text.invalid(name);
  }
  const type = parsed.getType();
  if (options.mobile && type && !['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER'].includes(type)) return text.notMobile(name);
  return null;
}

/**
 * A valid local number grouped as that country writes it after its calling code ("50 742 1938" beside +971):
 * the trunk 0 goes (the code is shown), the spacing stays. Anything not valid yet is kept as typed.
 */
export function groupNational(national: string, country: string): string {
  const upper = country.toUpperCase();
  if (!national.trim() || !isSupportedCountry(upper)) return national;
  const parsed = parsePhoneNumberFromString(national.trim(), { defaultCountry: upper as CountryCode, extract: false });
  if (!parsed?.isValid()) return national;
  const prefix = `+${parsed.countryCallingCode}`;
  const international = parsed.formatInternational();
  return international.startsWith(prefix) ? international.slice(prefix.length).trim() : String(parsed.nationalNumber);
}

/** A valid local number in its country as E.164 (+971501234567), dropping any trunk prefix; null if invalid. */
export function toE164(national: string, country: string): string | null {
  const upper = country.toUpperCase();
  if (!national.trim() || !isSupportedCountry(upper)) return null;
  const parsed = parsePhoneNumberFromString(national.trim(), { defaultCountry: upper as CountryCode, extract: false });
  return parsed?.isValid() ? parsed.number : null;
}

/** The mobile example of a country, written the local way, for the placeholder. */
export function phoneExample(country: string) {
  const code = supported(country);
  return code ? getExampleNumber(code, mobileExamples)?.formatNational() : undefined;
}

/**
 * A number to show inside a sentence: "+971 50 742 1938", isolated left-to-right (U+2066 … U+2069) so an Arabic or
 * Hebrew sentence never reorders its digits or moves the "+".
 */
export function phoneForText(e164: string) {
  const parsed = parsePhoneNumberFromString(e164.trim(), { extract: false });
  return `⁦${parsed?.isValid() ? parsed.formatInternational() : e164.trim()}⁩`;
}
