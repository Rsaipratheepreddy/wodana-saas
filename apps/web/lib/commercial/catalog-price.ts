import type { CatalogPriceSnapshot, QuoteLine } from "./types";
import { translatorFor, type Translate } from "@/lib/i18n/keys";

export type CatalogPriceResult = {
  status: CatalogPriceSnapshot["status"];
  code: string;
  message: string;
  snapshot: CatalogPriceSnapshot;
};

export function usesCatalogPricing(line: QuoteLine) {
  if (line.pricingMode === "materials") return Boolean(line.catalogPrice);
  return Boolean(line.catalogPrice || line.catalogLinks?.some((link) =>
    (link.role === "work" || link.role === "variant") && link.snapshot.commerce?.pricingMode));
}

export function catalogPriceInput(line: QuoteLine, currency: string, taxRate: number) {
  const selected = (role: string) => line.catalogLinks?.find((link) => link.role === role);
  const work = selected("work"), variant = selected("variant"), unit = selected("unit");
  if (!work) return null;
  return {
    catalogId: work.snapshot.catalogId,
    workId: work.recordId,
    workVersion: work.version,
    ...(variant ? { variantId: variant.recordId, variantVersion: variant.version } : {}),
    ...(unit ? { unitId: unit.recordId, unitVersion: unit.version } : {}),
    unitLabel: line.unit,
    quantity: line.quantity,
    currency,
    taxRate,
  };
}

export function priceBasisCurrent(line: QuoteLine, currency: string, taxRate: number) {
  const snapshot = line.catalogPrice;
  const input = catalogPriceInput(line, currency, taxRate);
  if (!snapshot || !input) return false;
  return snapshot.catalogId === input.catalogId &&
    snapshot.work.id === input.workId && snapshot.work.version === input.workVersion &&
    snapshot.variant?.id === ("variantId" in input ? input.variantId : undefined) &&
    snapshot.variant?.version === ("variantVersion" in input ? input.variantVersion : undefined) &&
    (!('unitId' in input) || (snapshot.unit?.id === input.unitId && snapshot.unit?.version === input.unitVersion)) &&
    snapshot.unitLabel === input.unitLabel && snapshot.quantity === input.quantity &&
    snapshot.currency === input.currency && snapshot.taxRate === input.taxRate &&
    snapshot.status !== "stale";
}

export function catalogResolvedRate(snapshot: CatalogPriceSnapshot) {
  return snapshot.status === "resolved" ? snapshot.override?.amount ?? snapshot.rateCard?.appliedUnitRate ?? 0 : 0;
}

export type CatalogPriceProvenance = {
  basis: string;
  detail: string;
  issue?: string;
};

/**
 * Human-readable selling-price evidence. Purchase costs are never included.
 * Pass the person's `t` and the workspace `locale`/`timeZone`; without them it reads in English.
 */
export function catalogPriceProvenance(
  snapshot?: CatalogPriceSnapshot,
  { t = translatorFor({}), locale, timeZone = "UTC" }: { t?: Translate; locale?: string; timeZone?: string } = {},
): CatalogPriceProvenance | null {
  if (!snapshot) return null;
  // Effective and pricing dates are calendar dates: format them in UTC so they never shift a day.
  const displayDate = (value?: string) => value
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
    : t("open ended");
  if (snapshot.source === "manual_override" && snapshot.override) {
    return {
      basis: t("Manual override · {currency} {amount}", { currency: snapshot.currency, amount: snapshot.override.amount.toFixed(2) }),
      detail: `${snapshot.override.reason} · ${snapshot.override.by} · ${new Date(snapshot.override.at).toLocaleString(locale, { timeZone, timeZoneName: "short" })}`,
      ...(snapshot.issue?.message ? { issue: snapshot.issue.message } : {}),
    };
  }
  if (snapshot.rateCard) {
    const rate = snapshot.rateCard;
    const conversion = rate.sourceUnit
      ? ` · ${t("converted from {unit} v{version} (factor {factor})", { unit: rate.sourceUnit.label, version: rate.sourceUnit.version, factor: rate.sourceUnit.conversionFactor })}`
      : "";
    const dates = { from: displayDate(rate.effectiveFrom), to: displayDate(rate.effectiveTo), priced: displayDate(snapshot.pricingDate) };
    return {
      basis: `${rate.reference?.trim() || t("Catalog rate")} · v${rate.version}`,
      detail: `${rate.taxIncluded ? t("Effective {from} to {to} · priced {priced} · tax included", dates) : t("Effective {from} to {to} · priced {priced} · tax extra", dates)}${conversion}`,
      ...(snapshot.status !== "resolved" || snapshot.issue?.message ? { issue: snapshot.issue?.message ?? t("This price basis is no longer current.") } : {}),
    };
  }
  return {
    basis: snapshot.source === "catalog" ? t("Catalog price unavailable") : t("Manual price"),
    detail: t("Checked {date}", { date: displayDate(snapshot.pricingDate) }),
    ...(snapshot.issue?.message ? { issue: snapshot.issue.message } : {}),
  };
}
