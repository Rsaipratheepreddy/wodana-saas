import { tKey } from "@/lib/i18n/keys";
import type { CasePlan } from "./types";

/**
 * User-facing planning areas: quiet tabs, each area's views as a segmented switch at the end of the same row. Existing record
 * URLs (section ids) stay the same, so links elsewhere keep working.
 */
export const planningAreas = [
  { id: "overview", label: tKey("Overview"), section: "overview", sections: [{ id: "overview", label: tKey("Overview") }, { id: "client-portal", label: tKey("Client access") }] },
  { id: "requirements", label: tKey("Requirements"), section: "requirements", sections: [{ id: "requirements", label: tKey("Requirements") }] },
  { id: "site", label: tKey("Site"), section: "site", sections: [{ id: "site", label: tKey("Site") }] },
  { id: "moodboard", label: tKey("Moodboard"), section: "inspiration", sections: [{ id: "inspiration", label: tKey("Moodboard") }] },
  { id: "design", label: tKey("Design"), section: "designs", sections: [{ id: "designs", label: tKey("Design") }] },
  { id: "quotes", label: tKey("Quotes"), section: "quotations", sections: [{ id: "quotations", label: tKey("Quotes") }, { id: "definition", label: tKey("Scope sign-off") }] },
  // Guide J: the deal, from the signed agreement to the release: Agreement, Payments, Deal File, Release, then Changes;
  // the client's sign-offs (scope, designs, quotes) under Approvals.
  { id: "agreement", label: tKey("Deal"), section: "contracts", sections: [{ id: "contracts", label: tKey("Agreement") }, { id: "payment-plan", label: tKey("Payments") }, { id: "deal-file", label: tKey("Deal File") }, { id: "execution-release", label: tKey("Release") }, { id: "variations", label: tKey("Changes") }, { id: "approvals", label: tKey("Approvals") }] },
] as const;
export type PlanningArea = (typeof planningAreas)[number];
export function planningArea(section: string): PlanningArea {
  return planningAreas.find(area => area.sections.some(item => item.id === section)) ?? planningAreas[0];
}

/**
 * The areas a case shows: every area, less the ones its path doesn't use (PLM-121/126) — Site without a site visit,
 * Moodboard and Design without design work. The open area always shows, so a link to it never strands the person.
 */
export function planningAreasFor(plan: CasePlan | null | undefined, open?: PlanningArea["id"]): PlanningArea[] {
  if (!plan) return [...planningAreas];
  const unused = new Set<string>([...(plan.siteVisit ? [] : ["site"]), ...(plan.design ? [] : ["moodboard", "design"])]);
  return planningAreas.filter((area) => area.id === open || !unused.has(area.id));
}
