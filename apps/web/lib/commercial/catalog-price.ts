import type { CatalogPriceSnapshot, QuoteLine } from "./types";

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

const displayDate = (value?: string) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
  : "open ended";

/** Human-readable selling-price evidence. Purchase costs are never included. */
export function catalogPriceProvenance(snapshot?: CatalogPriceSnapshot): CatalogPriceProvenance | null {
  if (!snapshot) return null;
  if (snapshot.source === "manual_override" && snapshot.override) {
    return {
      basis: `Manual override · ${snapshot.currency} ${snapshot.override.amount.toFixed(2)}`,
      detail: `${snapshot.override.reason} · ${snapshot.override.by} · ${new Date(snapshot.override.at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`,
      ...(snapshot.issue?.message ? { issue: snapshot.issue.message } : {}),
    };
  }
  if (snapshot.rateCard) {
    const rate = snapshot.rateCard;
    const conversion = rate.sourceUnit
      ? ` · converted from ${rate.sourceUnit.label} v${rate.sourceUnit.version} (factor ${rate.sourceUnit.conversionFactor})`
      : "";
    return {
      basis: `${rate.reference?.trim() || "Catalog rate"} · v${rate.version}`,
      detail: `Effective ${displayDate(rate.effectiveFrom)} to ${displayDate(rate.effectiveTo)} · priced ${displayDate(snapshot.pricingDate)}${rate.taxIncluded ? " · tax included" : " · tax extra"}${conversion}`,
      ...(snapshot.status !== "resolved" || snapshot.issue?.message ? { issue: snapshot.issue?.message ?? "This price basis is no longer current." } : {}),
    };
  }
  return {
    basis: snapshot.source === "catalog" ? "Catalog price unavailable" : "Manual price",
    detail: `Checked ${displayDate(snapshot.pricingDate)}`,
    ...(snapshot.issue?.message ? { issue: snapshot.issue.message } : {}),
  };
}
