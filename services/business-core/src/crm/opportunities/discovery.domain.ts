import { Dec } from "../../catalog-core/decimal";

export type DiscoveryFacts = {
  area: string | null; areaUnit: "sqft" | "sqm" | null; spaces: number | null; propertyLocation: string | null;
  clientEmail: string | null; floorPlanAssetId: string | null; designPackageId: string | null;
};
export type DiscoveryQuestion = { key: string; label: string; required: boolean; dataType?: string; options?: Array<{ id: string; label: string }> };
export type MissingItem = { key: string; label: string };

const SQM_PER_SQFT = "0.09290304";

/** Area expressed in the unit a package is priced in (exact conversion, 1 ft = 0.3048 m). */
export function areaIn(area: string, from: "sqft" | "sqm", to: "sqft" | "sqm") {
  if (from === to) return Dec.of(area).toFixed(2);
  return from === "sqm" ? Dec.of(area).div(SQM_PER_SQFT).round(2).toFixed(2) : Dec.of(area).mul(SQM_PER_SQFT).round(2).toFixed(2);
}

/**
 * PLM-040: what still blocks the Design Quote stage. Floor plan, area, client email, property location,
 * a resolved enquiry type, the client type and every required intro question; spaces only when the
 * chosen package is priced per space.
 */
export function discoveryMissing(input: {
  facts: DiscoveryFacts | null; enquiryType: string | null; clientType: string | null; packagePricing?: "per_space" | "per_area" | "fixed" | null;
  questions: DiscoveryQuestion[]; answers: Record<string, unknown>;
}): MissingItem[] {
  const facts = input.facts;
  const missing: MissingItem[] = [];
  if (!facts?.floorPlanAssetId) missing.push({ key: "floorPlan", label: "Floor plan" });
  if (!facts?.area) missing.push({ key: "area", label: "Area" });
  if (!facts?.clientEmail) missing.push({ key: "clientEmail", label: "Client email" });
  if (!facts?.propertyLocation) missing.push({ key: "propertyLocation", label: "Property location" });
  if (!input.enquiryType || input.enquiryType === "not_sure") missing.push({ key: "enquiryType", label: "Enquiry type" });
  if (!input.clientType) missing.push({ key: "clientType", label: "Client type" });
  if (input.packagePricing === "per_space" && !facts?.spaces) missing.push({ key: "spaces", label: "Number of spaces" });
  for (const question of input.questions) {
    const value = input.answers[question.key];
    const empty = value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
    if (question.required && empty) missing.push({ key: `question:${question.key}`, label: question.label });
  }
  return missing;
}
