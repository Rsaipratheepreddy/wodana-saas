import { UnprocessableEntityException } from "@nestjs/common";
import { Dec } from "../catalog-core/decimal";

export type PricingMethod = "per_space" | "per_area" | "fixed";
export type DesignPackageInput = {
  code: string; name: string; pricingMethod: PricingMethod; rate: string; currency: string; areaUnit?: "sqft" | "sqm" | null;
  includedRevisions?: number; includesSpacePlanning?: boolean; includesRenders?: boolean; requiredRoleCode?: string | null; inclusions?: string | null; position?: number;
  /** PLM-145: the role that reviews this package's concepts and renders before the client sees them and chooses its lead designer. */
  reviewRoleCode?: string | null;
  /** PLM-139: the rate is a starting price; a higher rate agreed with the client is approved (approval kind design_rate). */
  rateFrom?: boolean;
  /** PLM-139: what one pricing unit is, e.g. "1 space = 1 room with a door". */
  unitDefinition?: string | null;
};

/** Validates a price-list entry; money stays a decimal string (never a float). */
export function checkDesignPackage(input: DesignPackageInput): DesignPackageInput {
  const code = input.code?.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(code ?? "")) throw new UnprocessableEntityException("Use a short code of letters, numbers and underscores");
  const name = input.name?.replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new UnprocessableEntityException("Enter the package name");
  if (!["per_space", "per_area", "fixed"].includes(input.pricingMethod)) throw new UnprocessableEntityException("Choose how the package is priced");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(input.rate ?? ""))) throw new UnprocessableEntityException("Enter the rate as an amount, e.g. 40 or 10000.00");
  if (!/^[A-Z]{3}$/.test(input.currency ?? "")) throw new UnprocessableEntityException("Choose the currency");
  const areaUnit = input.pricingMethod === "per_area" ? input.areaUnit : null;
  if (input.pricingMethod === "per_area" && areaUnit !== "sqft" && areaUnit !== "sqm") throw new UnprocessableEntityException("Choose square feet or square metres");
  const revisions = input.includedRevisions ?? 2;
  if (!Number.isInteger(revisions) || revisions < 0 || revisions > 20) throw new UnprocessableEntityException("Included revisions must be between 0 and 20");
  const role = input.requiredRoleCode?.trim() || null;
  if (role && !/^[a-z][a-z0-9_]{1,59}$/.test(role)) throw new UnprocessableEntityException("Choose a valid role");
  const reviewRole = input.reviewRoleCode?.trim().toLowerCase() || null;
  if (reviewRole && !/^[a-z][a-z0-9_]{1,59}$/.test(reviewRole)) throw new UnprocessableEntityException("Choose a valid reviewer role");
  const inclusions = input.inclusions?.trim() || null;
  if (inclusions && inclusions.length > 2000) throw new UnprocessableEntityException("Keep the inclusions under 2000 characters");
  const unitDefinition = input.pricingMethod === "fixed" ? null : input.unitDefinition?.replace(/\s+/g, " ").trim() || null;
  if (unitDefinition && unitDefinition.length > 200) throw new UnprocessableEntityException("Keep what a unit is under 200 characters");
  return { code, name, pricingMethod: input.pricingMethod, rate: Dec.of(input.rate).toFixed(2), currency: input.currency, areaUnit, includedRevisions: revisions,
    includesSpacePlanning: Boolean(input.includesSpacePlanning), includesRenders: Boolean(input.includesRenders), requiredRoleCode: role, inclusions, position: input.position ?? 0,
    reviewRoleCode: reviewRole, rateFrom: input.pricingMethod !== "fixed" && Boolean(input.rateFrom), unitDefinition };
}

/**
 * PLM-139: the rate a job's fee uses. On a package priced "from" its rate, a rate agreed with the client above it needs
 * approval and counts only once approved; at or below it (or on any other package) the package's rate applies.
 */
export function agreedRate(pkg: { rate: string; rateFrom: boolean }, requested: string | null | undefined, approved: boolean) {
  if (!requested || !pkg.rateFrom || Dec.of(requested).cmp(pkg.rate) <= 0) return { rate: Dec.of(pkg.rate).toFixed(2), needsApproval: false };
  return { rate: approved ? Dec.of(requested).toFixed(2) : Dec.of(pkg.rate).toFixed(2), needsApproval: !approved };
}

/** PLM-041: the design fee from the package and the opportunity's spaces or area. */
export function designFee(pkg: { pricingMethod: PricingMethod; rate: string }, measure: { spaces?: number | null; area?: string | number | null }) {
  if (pkg.pricingMethod === "fixed") return Dec.of(pkg.rate).toFixed(2);
  if (pkg.pricingMethod === "per_space") {
    const spaces = measure.spaces;
    if (!spaces || !Number.isInteger(spaces) || spaces < 1) throw new UnprocessableEntityException("Enter how many spaces are in scope");
    return Dec.of(pkg.rate).mul(spaces).toFixed(2);
  }
  const area = measure.area === null || measure.area === undefined || measure.area === "" ? null : Dec.of(String(measure.area));
  if (!area || area.isNegative() || area.isZero()) throw new UnprocessableEntityException("Enter the area to price this package");
  return Dec.of(pkg.rate).mul(area).round(2).toFixed(2);
}

/**
 * The minimum design deposit a workspace has set, or null when it has none. An empty row, a missing
 * currency or a zero amount all mean "no minimum": nothing is shown or gated as "0".
 */
export function effectiveMinimumDeposit(row: { amount?: string | null; currency?: string | null } | null | undefined): { amount: string; currency: string } | null {
  if (!row?.amount || !row.currency) return null;
  const amount = Dec.of(String(row.amount));
  if (amount.isZero() || amount.isNegative()) return null;
  return { amount: amount.toFixed(2), currency: row.currency };
}

/** Is the received design deposit enough? Amounts compared as decimals in the quote's currency. */
export function depositMeetsMinimum(paid: string | number, minimum: { amount: string; currency: string } | null | undefined, currency: string) {
  if (!minimum) return true;
  if (minimum.currency !== currency) return false;
  return Dec.of(String(paid)).cmp(minimum.amount) >= 0;
}
