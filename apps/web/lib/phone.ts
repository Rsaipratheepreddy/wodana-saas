import { getCountries, getCountryCallingCode, getExampleNumber, isSupportedCountry, parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from "libphonenumber-js/max";
import mobileExamples from "libphonenumber-js/examples.mobile.json";

/** Resolve a contact's country first, then the workspace locale. Never guess a country from digits alone. */
export function phoneCountry(contactCountry?: string | null, workspaceLocale?: string | null): CountryCode | undefined {
  const explicit = contactCountry?.trim().toUpperCase();
  if (explicit && isSupportedCountry(explicit)) return explicit as CountryCode;
  if (!workspaceLocale) return undefined;
  try {
    const region = new Intl.Locale(workspaceLocale).region;
    return region && isSupportedCountry(region) ? region as CountryCode : undefined;
  } catch {
    return undefined;
  }
}

/** WhatsApp requires the full international number, with digits only in the URL path. */
export function whatsappUrl(rawNumber: string, defaultCountry?: CountryCode): string | null {
  const input = rawNumber.trim();
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(input, { defaultCountry, extract: false });
  if (!parsed?.isValid()) return null;
  return `https://wa.me/${parsed.number.slice(1)}`;
}

/** Format only the visible value; keep the original number unchanged for storage and links. */
export function formatPhoneForDisplay(rawNumber?: string | null, defaultCountry?: CountryCode): string {
  const input = rawNumber?.trim() ?? "";
  if (!input) return "Not provided";
  const parsed = parsePhoneNumberFromString(input, { defaultCountry, extract: false });
  return parsed?.isValid() ? parsed.formatInternational() : input;
}

export function countryForPhone(rawNumber?: string | null): CountryCode | undefined {
  if (!rawNumber?.trim().startsWith("+")) return undefined;
  return parsePhoneNumberFromString(rawNumber, { extract: false })?.country;
}

export function phoneCountryOptions(locale = "en") {
  let displayNames: Intl.DisplayNames;
  try { displayNames = new Intl.DisplayNames([locale], { type: "region" }); }
  catch { displayNames = new Intl.DisplayNames(["en"], { type: "region" }); }
  return getCountries().map(id => {
    const name = displayNames.of(id) ?? id;
    const flag = [...id].map(letter => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");
    return { id, label: `${flag} +${getCountryCallingCode(id)}`, description: name };
  }).sort((a, b) => a.description.localeCompare(b.description));
}

/**
 * Splits what was stored or pasted into the country picker and the local number, so the code is
 * never shown (or saved) twice. "+91 77807 68279", "0091…" or a stored "+917780768279" all become
 * { country: "IN", national: "7780768279" }. A leading trunk 0 ("050 123 4567" in AE) is dropped.
 */
export function splitPhone(raw: string, country?: string | null): { country: string; national: string } {
  const current = (country ?? "").toUpperCase();
  const trimmed = raw.trim();
  if (!trimmed) return { country: current, national: "" };
  const international = trimmed.startsWith("+") ? trimmed : trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : null;
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
    const digits = trimmed.replace(/[^\d]/g, "");
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

type PhoneProblemText = {
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
  let name: string = upper;
  try { name = new Intl.DisplayNames([options.locale ?? "en"], { type: "region" }).of(upper) ?? upper; } catch { /* keep the code */ }
  const example = getExampleNumber(upper as CountryCode, mobileExamples);
  const expected = example ? String(example.nationalNumber).length : 0;
  const length = validatePhoneNumberLength(value, upper as CountryCode);
  if (length === "TOO_SHORT") return text.tooShort(name, code, expected);
  if (length === "TOO_LONG") return text.tooLong(name, code, expected);
  const parsed = parsePhoneNumberFromString(value, { defaultCountry: upper as CountryCode, extract: false });
  if (!parsed?.isValid() || (parsed.country && parsed.country !== upper)) {
    // Some countries allow longer numbers of other types; for a mobile, compare with the mobile length.
    const digits = value.replace(/\D/g, "").replace(/^0+/, "").length;
    if (options.mobile && expected && digits > expected) return text.tooLong(name, code, expected);
    if (options.mobile && expected && digits < expected) return text.tooShort(name, code, expected);
    return text.invalid(name);
  }
  const type = parsed.getType();
  if (options.mobile && type && !["MOBILE", "FIXED_LINE_OR_MOBILE", "PERSONAL_NUMBER"].includes(type)) return text.notMobile(name);
  return null;
}

/** A local number and its country as one international number (+9715…), for storing. */
export function joinPhone(country: string, national: string): string {
  const digits = national.replace(/[^\d]/g, "");
  if (!digits) return "";
  const code = country && isSupportedCountry(country.toUpperCase()) ? getCountryCallingCode(country.toUpperCase() as CountryCode) : null;
  return code ? `+${code}${digits}` : national.trim();
}
