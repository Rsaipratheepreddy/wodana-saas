/**
 * What a country calls its first-level area (region pack data, keyed by country, never by tenant).
 * Extend here as region packs grow.
 */
const AREA_LABELS: Record<string, string> = {
  AE: "Emirate", US: "State", IN: "State", AU: "State", BR: "State", MX: "State", MY: "State", NG: "State",
  CA: "Province / territory", SA: "Province", ZA: "Province", PK: "Province", IE: "County", GB: "County",
};

export function administrativeAreaLabel(countryCode: string | null | undefined) {
  return (countryCode && AREA_LABELS[countryCode.toUpperCase()]) || "Region";
}

export function countryFromLocale(locale: string | null | undefined) {
  if (!locale) return undefined;
  try { return new Intl.Locale(locale).region ?? undefined; } catch { return undefined; }
}
