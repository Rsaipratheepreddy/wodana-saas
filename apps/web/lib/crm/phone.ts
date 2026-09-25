import { getCountries, getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

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
