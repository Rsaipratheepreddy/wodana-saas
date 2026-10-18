import { UnprocessableEntityException } from "@nestjs/common";
import { isSupportedCountry, Metadata, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

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

const MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE", "PERSONAL_NUMBER"]);
/** Digits and the separators people type between them; letters and other symbols are never part of a number. */
const PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;
type TypedPlan = { possibleLengths(): number[]; type?: (kind: string) => { possibleLengths(): number[] | undefined } | undefined };

/**
 * How many digits a country's numbers have after its calling code, from the library's metadata (never a table of our
 * own): "10" for an Indian mobile, "10–11" where a country has more than one length. Same as the web's `phoneDigits`.
 */
export function phoneDigits(country: string, mobile = true): string {
  const upper = country.toUpperCase();
  if (!isSupportedCountry(upper)) return "";
  const metadata = new Metadata();
  metadata.selectNumberingPlan(upper as CountryCode);
  const plan = metadata.numberingPlan as TypedPlan | undefined;
  const lengths = (mobile ? plan?.type?.("MOBILE")?.possibleLengths() : undefined) ?? plan?.possibleLengths() ?? [];
  if (!lengths.length) return "";
  const min = Math.min(...lengths), max = Math.max(...lengths);
  return min === max ? String(min) : `${min}–${max}`;
}

function countryName(country: string) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country; } catch { return country; }
}

/** The line the person reads for a number that does not fit its country (the web form words it the same way). */
function wrongNumber(label: "mobile" | "phone", country: string | undefined) {
  if (!country) return `Enter a valid ${label} number for the selected country`;
  return label === "mobile"
    ? `Enter a valid mobile number for ${countryName(country)} (${phoneDigits(country)} digits)`
    : `Enter a valid phone number for ${countryName(country)}`;
}

/**
 * A staff-typed number checked against its country: a mobile must be a valid mobile of that country (so exactly its
 * length), a phone any valid number there. Returns the line for the person, or null.
 */
export function phoneProblem(value: string | undefined | null, countryHint: string | undefined | null, label: "mobile" | "phone"): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const hint = countryHint?.trim().toUpperCase();
  const country = hint && isSupportedCountry(hint) ? hint as CountryCode : undefined;
  const international = raw.startsWith("+");
  if (!country && !international) return "Choose the country code";
  const parsed = parsePhoneNumberFromString(raw, { defaultCountry: country, extract: false });
  const target = international ? parsed?.country ?? country : country;
  if (!PHONE_CHARACTERS.test(raw) || !parsed?.isValid()) return wrongNumber(label, target);
  if (!international && parsed.country && parsed.country !== country) return wrongNumber(label, target);
  const type = parsed.getType();
  if (label === "mobile" && type && !MOBILE_TYPES.has(type)) return wrongNumber(label, target);
  return null;
}

/** Each staff-typed number that can't be saved, on its field (`mobile`, `phone`), for a ProblemList. */
export function staffPhoneProblems(party: PhoneParty, workspaceCountry?: CountryCode): Array<{ key: "mobile" | "phone"; label: string }> {
  const problems: Array<{ key: "mobile" | "phone"; label: string }> = [];
  const mobile = phoneProblem(party.mobile, party.mobileCountryCode ?? party.phoneCountryCode ?? workspaceCountry, "mobile");
  if (mobile) problems.push({ key: "mobile", label: mobile });
  const phone = phoneProblem(party.phone, party.phoneCountryCode ?? workspaceCountry, "phone");
  if (phone) problems.push({ key: "phone", label: phone });
  return problems;
}

function normalizePhone(value: string | undefined, countryHint: string | undefined, label: "mobile" | "phone") {
  if (!value?.trim()) return { number: value, country: countryHint?.toUpperCase() };
  const country = countryHint?.trim().toUpperCase();
  if (country && !isSupportedCountry(country)) throw new UnprocessableEntityException(`Select a valid ${label} country code`);
  const parsed = parsePhoneNumberFromString(value.trim(), { defaultCountry: country as CountryCode | undefined, extract: false });
  if (!country && !value.trim().startsWith("+")) throw new UnprocessableEntityException(`Choose the ${label} country code`);
  // Same rule as the form: a real number for that country, and a mobile where a mobile is asked for.
  if (!parsed?.isValid()) throw new UnprocessableEntityException(wrongNumber(label, (value.trim().startsWith("+") ? parsed?.country : undefined) ?? country));
  const type = parsed.getType();
  if (label === "mobile" && type && !MOBILE_TYPES.has(type))
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
