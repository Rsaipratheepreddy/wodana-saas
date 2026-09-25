/** User-facing planning areas; existing record URLs remain compatible. */
export const planningAreas = [
  { label: "Requirements", section: "requirements", sections: [{ id: "requirements", label: "Requirements" }, { id: "measurements", label: "Measurements" }, { id: "site-layouts", label: "Site plans" }, { id: "inspiration", label: "Inspiration" }, { id: "definition", label: "Scope confirmation" }] },
  { label: "Design Quote", section: "boq", sections: [{ id: "boq", label: "Design Quote" }] },
  { label: "Design & Specifications", section: "designs", sections: [{ id: "designs", label: "Design & Specifications" }] },
  { label: "Approvals", section: "approvals", sections: [{ id: "approvals", label: "Approvals" }] },
  { label: "Fitout / Furniture Quotations", section: "quotations", sections: [{ id: "quotations", label: "Fitout / Furniture Quotations" }] },
  { label: "Agreements & Payments", section: "contracts", sections: [{ id: "contracts", label: "Agreement" }, { id: "payment-plan", label: "Payments" }] },
  { label: "Overview", section: "overview", sections: [{ id: "overview", label: "Overview" }, { id: "client-portal", label: "Client access" }, { id: "execution-release", label: "Release readiness" }] },
  { label: "Change Requests", section: "variations", sections: [{ id: "variations", label: "Change Requests" }] },
];
export function planningArea(section: string) {
  return planningAreas.find(area => area.sections.some(item => item.id === section)) ?? planningAreas[0];
}
