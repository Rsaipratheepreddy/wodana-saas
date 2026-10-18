import { tKey } from "@/lib/i18n/keys";

/**
 * What a country calls its first-level area (region pack data, keyed by country, never by tenant).
 * Extend here as region packs grow.
 */
const AREA_LABELS: Record<string, string> = {
  AE: tKey("Emirate"), US: tKey("State"), IN: tKey("State"), AU: tKey("State"), BR: tKey("State"), MX: tKey("State"), MY: tKey("State"), NG: tKey("State"),
  CA: tKey("Province / territory"), SA: tKey("Province"), ZA: tKey("Province"), PK: tKey("Province"), IE: tKey("County"), GB: tKey("County"),
};

/** Countries whose addresses have no postal code (region pack data). */
const NO_POSTAL_CODE = new Set(["AE", "QA", "HK", "MO", "BS", "BZ", "FJ", "GD", "JM", "TT", "BW", "ZW", "UG", "RW", "MW", "GH", "YE", "SY", "KI", "TV", "NR", "VU", "SB", "TO", "TL", "SR", "GY", "AG", "DM", "KN", "LC", "VC", "BO", "ML", "BF", "NE", "TD", "CF", "CG", "CD", "GQ", "GA", "CM", "BJ", "TG", "KM", "DJ", "ER", "SO", "MR", "SL", "LY", "AO", "AW", "BQ", "CW", "SX", "HM", "TK", "NU", "CK"]);
/** Countries where an address needs its first-level area (emirate, state, province). */
const AREA_REQUIRED = new Set(["AE", "US", "CA", "AU", "IN", "BR", "MX", "MY", "NG"]);

export function usesPostalCode(countryCode: string | null | undefined) {
  return !(countryCode && NO_POSTAL_CODE.has(countryCode.toUpperCase()));
}

export function requiresAdministrativeArea(countryCode: string | null | undefined) {
  return Boolean(countryCode && AREA_REQUIRED.has(countryCode.toUpperCase()));
}

export function administrativeAreaLabel(countryCode: string | null | undefined) {
  return (countryCode && AREA_LABELS[countryCode.toUpperCase()]) || tKey("Region");
}

export function countryFromLocale(locale: string | null | undefined) {
  if (!locale) return undefined;
  try { return new Intl.Locale(locale).region ?? undefined; } catch { return undefined; }
}
