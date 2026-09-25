import { UnprocessableEntityException } from "@nestjs/common";
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

type PhoneParty = {
  mobile?: string;
  phone?: string;
  mobileCountryCode?: string;
  phoneCountryCode?: string;
};

export function countryFromLocale(locale?: string | null): CountryCode | undefined {
  if (!locale) return undefined;
  try {
    const region = new Intl.Locale(locale).region;
    return region && isSupportedCountry(region) ? region as CountryCode : undefined;
  } catch {
    return undefined;
  }
}

function normalizePhone(value: string | undefined, countryHint: string | undefined, label: string) {
  if (!value?.trim()) return { number: value, country: countryHint?.toUpperCase() };
  const country = countryHint?.trim().toUpperCase();
  if (country && !isSupportedCountry(country)) throw new UnprocessableEntityException(`Select a valid ${label} country code`);
  const parsed = parsePhoneNumberFromString(value.trim(), { defaultCountry: country as CountryCode | undefined, extract: false });
  if (!country && !value.trim().startsWith("+")) throw new UnprocessableEntityException(`Choose the ${label} country code`);
  // Same rule as the form: a real number for that country, and a mobile where a mobile is asked for.
  if (!parsed?.isValid()) throw new UnprocessableEntityException(`Enter a valid ${label} number for the selected country`);
  const type = parsed.getType();
  if (label === "mobile" && type && !["MOBILE", "FIXED_LINE_OR_MOBILE", "PERSONAL_NUMBER"].includes(type))
    throw new UnprocessableEntityException("The mobile number is a landline. Enter a mobile number");
  return { number: parsed.number, country: parsed.country ?? country };
}

/** Canonicalize every CRM intake path before identity matching and contact persistence. */
export function needsWorkspacePhoneCountry(party: PhoneParty): boolean {
  return Boolean((party.mobile?.trim() && !party.mobile.trim().startsWith("+") && !party.mobileCountryCode && !party.phoneCountryCode)
    || (party.phone?.trim() && !party.phone.trim().startsWith("+") && !party.phoneCountryCode));
}

export function normalizeIntakePartyPhones<T extends PhoneParty>(party: T, workspaceCountry?: CountryCode): T {
  const mobile = normalizePhone(party.mobile, party.mobileCountryCode ?? party.phoneCountryCode ?? workspaceCountry, "mobile");
  const phone = normalizePhone(party.phone, party.phoneCountryCode ?? workspaceCountry, "phone");
  return {
    ...party,
    mobile: mobile.number,
    phone: phone.number,
    mobileCountryCode: mobile.country,
    phoneCountryCode: phone.country,
  };
}
