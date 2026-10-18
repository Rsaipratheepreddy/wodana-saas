import { floorPlanReady, type FloorPlan } from "../leads/enquiry-problems";
import { Dec } from "../../catalog-core/decimal";

export type DiscoveryFacts = {
  area: string | null; areaUnit: "sqft" | "sqm" | null; spaces: number | null; propertyLocation: string | null;
  clientEmail: string | null; floorPlanAssetId: string | null; designPackageId: string | null;
  /** The property's position (WGS 84 degrees): both or neither. */
  latitude: number | null; longitude: number | null;
  /** PLM-139: the rate agreed with the client when it differs from the package's (a package priced from its rate). */
  designRate?: string | null;
};
export type DiscoveryQuestion = { key: string; label: string; required: boolean; dataType?: string; options?: Array<{ id: string; label: string }> };
export type MissingItem = { key: string; label: string };

/** Why a property position can't be saved: both or neither, latitude within ±90 and longitude within ±180. */
export function coordinatesProblem(latitude: number | null, longitude: number | null): string | null {
  if ((latitude === null) !== (longitude === null)) return "Enter both latitude and longitude";
  if (latitude === null || longitude === null) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return "Enter a latitude between -90 and 90";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return "Enter a longitude between -180 and 180";
  return null;
}

/** Seven decimals: about a centimetre, as precise as a phone's GPS can be. */
export const roundCoordinate = (value: number) => Math.round(value * 1e7) / 1e7;

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
  /** The enquiry's own floor plan answer: an estimate given (the real plan follows before the site visit) or not required counts. */
  enquiryFloorPlan?: FloorPlan | null;
}): MissingItem[] {
  const facts = input.facts;
  const missing: MissingItem[] = [];
  if (!facts?.floorPlanAssetId && !floorPlanReady(input.enquiryFloorPlan)) missing.push({ key: "floorPlan", label: "Floor plan" });
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
