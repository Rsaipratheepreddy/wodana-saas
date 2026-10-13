export type PricingMethod = "per_space" | "per_area" | "fixed";
export type DesignPackage = {
  id: string; code: string; name: string; pricingMethod: PricingMethod; rate: string; currency: string; areaUnit: "sqft" | "sqm" | null;
  includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null; inclusions: string | null;
  position: number; status: "active" | "archived"; version: number;
  /** PLM-145: the role that reviews concepts and renders before the client sees them and chooses the lead designer. */
  reviewRoleCode?: string | null;
  /** PLM-139: the rate is a starting price; a higher one agreed with the client is approved first. */
  rateFrom?: boolean;
  /** PLM-139: what one pricing unit is, e.g. "1 space = 1 room with a door". */
  unitDefinition?: string | null;
};
/** The design order of 13 Oct 2026 (PLM-140–144, PLM-151): the days of each step. */
export type DesignSteps = {
  allocationDays: number; kickoffDays: number; conceptDays: number; siteMeasureDays: number; developmentMinDays: number; developmentMaxDays: number; developmentDaysPerRoom: number;
  sampleCollectionDays: number; sampleMeetingDays: number; conceptOptionsMax: number | null;
};
/** PLM-151: the team role each part of the design team uses (null: not used), and who tags the Draftsman. */
export type DesignTeamRoles = {
  lead_designer: string; junior_designer: string | null; sales_admin: string | null; visualiser: string | null; draftsman: string | null; material_coordinator: string | null;
  technicalLeadRoleCode: string | null;
};
/** PLM-154: a site visit question, grouped by its scope (none for the general ones). */
export type SiteQuestion = { key: string; question: string; scope?: string | null };
export type DesignTimings = { inspirationDays: number; siteVisitHours: number };
/** Settings › Design: the design flow after Won (plan §6.7a): deadlines, the showroom booking type, the visualiser role and the site visit question list. */
export type DesignFlow = {
  designInternalDays: number; designClientDays: number; materialSelectionDays: number; estimateDays: number; visualiserRoleCode: string;
  showroomBookingTypeId: string | null; siteVisitQuestions: SiteQuestion[];
  /** The renders' own internal and client-facing days; null follows the design deadlines. */
  renderInternalDays?: number | null; renderClientDays?: number | null;
  steps?: DesignSteps; team?: DesignTeamRoles;
};
export type DesignSettings = { minimumDeposit: { amount: string; currency: string } | null; version: number; timings?: DesignTimings; packages: DesignPackage[];
  flow?: DesignFlow; bookingTypes?: Array<{ id: string; name: string }>;
  /** The workspace's team roles (Settings › Projects), to name each part of the design team. */
  roles?: Array<{ key: string; label: string }> };

async function call<T>(workspaceId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace/design/${path}?workspaceId=${workspaceId}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Design settings could not be saved.");
  return payload as T;
}

export const loadDesignSettings = (workspaceId: string) => call<DesignSettings>(workspaceId, "settings");
export const saveMinimumDeposit = (workspaceId: string, minimumDeposit: DesignSettings["minimumDeposit"], version: number) =>
  call<DesignSettings>(workspaceId, "settings", { method: "PUT", body: JSON.stringify({ minimumDeposit, version }) });
export const saveDesignTimings = (workspaceId: string, timings: DesignTimings, version: number) =>
  call<DesignSettings>(workspaceId, "settings", { method: "PUT", body: JSON.stringify({ timings, version }) });
export const saveDesignFlow = (workspaceId: string, flow: DesignFlow, version: number) =>
  call<DesignSettings>(workspaceId, "flow-settings", { method: "PUT", body: JSON.stringify({ ...flow, version }) });
/** A question's key from its text, unique in the list (kept when the question is edited later). */
export function questionKey(question: string, taken: string[]) {
  const base = question.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "question";
  let key = base;
  for (let index = 2; taken.includes(key); index += 1) key = `${base}_${index}`.slice(0, 60);
  return key;
}
export const saveDesignPackage = (workspaceId: string, value: Partial<DesignPackage>) =>
  call<DesignPackage>(workspaceId, "packages", { method: "POST", body: JSON.stringify(value) });
export const setDesignPackageStatus = (workspaceId: string, id: string, status: DesignPackage["status"], version: number) =>
  call<DesignPackage>(workspaceId, `packages/${id}/status`, { method: "POST", body: JSON.stringify({ status, version }) });
/** The fee for a measure; on a package priced from its rate, at the rate agreed with the client (PLM-139). */
export const quoteDesignFee = (workspaceId: string, id: string, measure: { spaces?: number; area?: string; areaUnit?: "sqft" | "sqm"; rate?: string }) =>
  call<{ fee: string; rate?: string; currency: string; pricingMethod: PricingMethod; areaUnit: string | null }>(workspaceId, `packages/${id}/quote`, { method: "POST", body: JSON.stringify(measure) });
