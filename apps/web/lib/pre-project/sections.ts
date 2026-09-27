/**
 * User-facing planning areas: five quiet tabs, each area's views as a second row. Existing record
 * URLs (section ids) stay the same, so links elsewhere keep working.
 */
export const planningAreas = [
  { id: "overview", label: "Overview", section: "overview", sections: [{ id: "overview", label: "Overview" }, { id: "client-portal", label: "Client access" }, { id: "execution-release", label: "Release readiness" }] },
  { id: "requirements", label: "Requirements", section: "requirements", sections: [{ id: "requirements", label: "Requirements" }] },
  { id: "site", label: "Site", section: "site", sections: [{ id: "site", label: "Site" }] },
  { id: "moodboard", label: "Moodboard", section: "inspiration", sections: [{ id: "inspiration", label: "Moodboard" }] },
  { id: "design", label: "Design", section: "designs", sections: [{ id: "designs", label: "Design" }] },
  { id: "quotes", label: "Quotes", section: "quotations", sections: [{ id: "quotations", label: "Quotes" }, { id: "definition", label: "Scope sign-off" }] },
  { id: "agreement", label: "Agreement", section: "contracts", sections: [{ id: "contracts", label: "Agreement" }, { id: "payment-plan", label: "Payments" }, { id: "approvals", label: "Approvals" }, { id: "variations", label: "Change requests" }] },
] as const;
export type PlanningArea = (typeof planningAreas)[number];
export function planningArea(section: string): PlanningArea {
  return planningAreas.find(area => area.sections.some(item => item.id === section)) ?? planningAreas[0];
}
