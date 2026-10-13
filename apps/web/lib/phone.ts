import { getCountries, getCountryCallingCode, isSupportedCountry, Metadata, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { tKey, type Translate } from "@/lib/i18n/keys";

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
  if (!input) return tKey("Not provided");
  const parsed = parsePhoneNumberFromString(input, { defaultCountry, extract: false });
  return parsed?.isValid() ? parsed.formatInternational() : input;
}

export function countryForPhone(rawNumber?: string | null): CountryCode | undefined {
  if (!rawNumber?.trim().startsWith("+")) return undefined;
  return parsePhoneNumberFromString(rawNumber, { extract: false })?.country;
}

/** Country codes with their names in `locale` (the person's language with the workspace region). */
export function phoneCountryOptions(locale: string) {
  let displayNames: Intl.DisplayNames;
  try { displayNames = new Intl.DisplayNames([locale], { type: "region" }); }
  catch { displayNames = new Intl.DisplayNames([], { type: "region" }); }
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

export type PhoneProblemText = {
  /** A mobile that isn't valid for the country: "Enter a valid mobile number for India (10 digits)". */
  mobile: (country: string, digits: string) => string;
  /** Any other number that isn't valid for the country. */
  phone: (country: string) => string;
  chooseCountry: string;
};

/** The one wording every form uses for a number that does not fit its country. */
export function phoneProblemText(t: Translate): PhoneProblemText {
  return {
    mobile: (country, digits) => t("Enter a valid mobile number for {country} ({digits} digits)", { country, digits }),
    phone: (country) => t("Enter a valid phone number for {country}", { country }),
    chooseCountry: t("Choose the country code"),
  };
}

const MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE", "PERSONAL_NUMBER"]);
/** Digits and the separators people type between them; anything else (letters, symbols) is never a number. */
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;

type TypedPlan = { possibleLengths(): number[]; type?: (kind: string) => { possibleLengths(): number[] | undefined } | undefined };

/**
 * How many digits a country's numbers have after its calling code, from the library's metadata (never a table of
 * our own): "10" for an Indian mobile, "10–11" where a country has more than one length.
 */
export function phoneDigits(country: string, options: { mobile?: boolean } = {}): string {
  const upper = country.toUpperCase();
  if (!isSupportedCountry(upper)) return "";
  const metadata = new Metadata();
  metadata.selectNumberingPlan(upper as CountryCode);
  const plan = metadata.numberingPlan as TypedPlan | undefined;
  const lengths = (options.mobile ? plan?.type?.("MOBILE")?.possibleLengths() : undefined) ?? plan?.possibleLengths() ?? [];
  if (!lengths.length) return "";
  const min = Math.min(...lengths), max = Math.max(...lengths);
  return min === max ? String(min) : `${min}–${max}`;
}

function countryName(country: string, locale?: string) {
  try { return new Intl.DisplayNames(locale ? [locale] : [], { type: "region" }).of(country) ?? country; } catch { return country; }
}

/**
 * Checks a local number against the selected country; returns one line for the person, or null. A mobile must be a
 * valid mobile number of that country (so exactly its length); any other number must be valid there.
 */
export function phoneProblem(national: string, country: string, text: PhoneProblemText, options: { mobile?: boolean; locale?: string } = {}): string | null {
  const value = national.trim();
  if (!value) return null;
  const upper = country.toUpperCase();
  if (!upper || !isSupportedCountry(upper)) return text.chooseCountry;
  const wrong = () => options.mobile ? text.mobile(countryName(upper, options.locale), phoneDigits(upper, { mobile: true })) : text.phone(countryName(upper, options.locale));
  if (!PHONE_CHARACTERS.test(value)) return wrong();
  const parsed = parsePhoneNumberFromString(value, { defaultCountry: upper as CountryCode, extract: false });
  if (!parsed?.isValid() || (parsed.country && parsed.country !== upper)) return wrong();
  const type = parsed.getType();
  if (options.mobile && type && !MOBILE_TYPES.has(type)) return wrong();
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

/** A local number and its country as one international number (+9715…), for storing. */
export function joinPhone(country: string, national: string): string {
  const digits = national.replace(/[^\d]/g, "");
  if (!digits) return "";
  const code = country && isSupportedCountry(country.toUpperCase()) ? getCountryCallingCode(country.toUpperCase() as CountryCode) : null;
  return code ? `+${code}${digits}` : national.trim();
}
