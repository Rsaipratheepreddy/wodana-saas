import { tKey } from "@/lib/i18n/keys";

/**
 * User-facing planning areas: five quiet tabs, each area's views as a second row. Existing record
 * URLs (section ids) stay the same, so links elsewhere keep working.
 */
export const planningAreas = [
  { id: "overview", label: tKey("Overview"), section: "overview", sections: [{ id: "overview", label: tKey("Overview") }, { id: "client-portal", label: tKey("Client access") }, { id: "execution-release", label: tKey("Release readiness") }] },
  { id: "requirements", label: tKey("Requirements"), section: "requirements", sections: [{ id: "requirements", label: tKey("Requirements") }] },
  { id: "site", label: tKey("Site"), section: "site", sections: [{ id: "site", label: tKey("Site") }] },
  { id: "moodboard", label: tKey("Moodboard"), section: "inspiration", sections: [{ id: "inspiration", label: tKey("Moodboard") }] },
  { id: "design", label: tKey("Design"), section: "designs", sections: [{ id: "designs", label: tKey("Design") }] },
  { id: "quotes", label: tKey("Quotes"), section: "quotations", sections: [{ id: "quotations", label: tKey("Quotes") }, { id: "definition", label: tKey("Scope sign-off") }] },
  { id: "agreement", label: tKey("Agreement"), section: "contracts", sections: [{ id: "contracts", label: tKey("Agreement") }, { id: "payment-plan", label: tKey("Payments") }, { id: "approvals", label: tKey("Approvals") }, { id: "variations", label: tKey("Change requests") }] },
] as const;
export type PlanningArea = (typeof planningAreas)[number];
export function planningArea(section: string): PlanningArea {
  return planningAreas.find(area => area.sections.some(item => item.id === section)) ?? planningAreas[0];
}
