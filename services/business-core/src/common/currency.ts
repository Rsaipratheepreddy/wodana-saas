/** A currency's minor units (2 for most, 0 for JPY, 3 for KWD/BHD/OMR), from ISO 4217 via Intl; 2 when unknown. */
export function currencyDecimals(currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}
