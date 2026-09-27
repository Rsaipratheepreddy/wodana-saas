import { tKey } from "@/lib/i18n/keys";

/**
 * What a country calls its first-level area (region pack data, keyed by country, never by tenant).
 * Extend here as region packs grow.
 */
const AREA_LABELS: Record<string, string> = {
  AE: tKey("Emirate"), US: tKey("State"), IN: tKey("State"), AU: tKey("State"), BR: tKey("State"), MX: tKey("State"), MY: tKey("State"), NG: tKey("State"),
  CA: tKey("Province / territory"), SA: tKey("Province"), ZA: tKey("Province"), PK: tKey("Province"), IE: tKey("County"), GB: tKey("County"),
};

export function administrativeAreaLabel(countryCode: string | null | undefined) {
  return (countryCode && AREA_LABELS[countryCode.toUpperCase()]) || tKey("Region");
}

export function countryFromLocale(locale: string | null | undefined) {
  if (!locale) return undefined;
  try { return new Intl.Locale(locale).region ?? undefined; } catch { return undefined; }
}
