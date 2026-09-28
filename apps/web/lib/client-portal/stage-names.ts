import { tKey, translateKnown, type Translate } from "@/lib/i18n/keys";

/**
 * The product's default project stage names (services/business-core/src/project-core/project-checks.ts), catalogued
 * so a client reads them in their language. A stage a tenant named themselves shows as they wrote it.
 */
export const DEFAULT_STAGE_NAMES = [
  tKey("Kickoff"), tKey("Material sign-off"), tKey("Procurement"), tKey("Technical drawings"), tKey("Production"), tKey("Delivery and installation"),
  tKey("Snagging"), tKey("Handover"),
] as const;

export function stageName(t: Translate, name: string) {
  return translateKnown(t, name);
}
