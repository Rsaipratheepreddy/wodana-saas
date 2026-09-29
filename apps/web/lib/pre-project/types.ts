import { tKey } from "@/lib/i18n/keys";
export const PRE_PROJECT_ROOT = "/workspace/pre-projects";
export type PreProjectCase = {
  id: string; title: string; description: string | null; status: "draft" | "active" | "on_hold" | "released" | "cancelled";
  customerId: string; customerName: string; opportunityId: string; opportunityStatus: string;
  leadId: string | null; leadManagerName: string | null; amount: string | null; currencyCode: string | null;
  createdAt: string; updatedAt: string;
  phase: "discover" | "define" | "design" | "price" | "agree" | "release";
  version: number; ownerMembershipId: string | null; engagementOwnerName: string | null;
  targetDate: string | null; priority: "low" | "normal" | "high" | "urgent";
  riskLevel: "none" | "low" | "medium" | "high" | "critical";
  activatedAt: string | null; holdReason: string | null; cancellationReason: string | null;
  releasedAt: string | null; canManageLifecycle?: boolean;
  conversionOrigin?: string | null; convertedAt?: string | null;
  qualificationEvidence?: unknown; qualificationEvidenceHash?: string | null;
  /** Set only after a paid Deal File has opened the linked project. */
  projectId?: string | null;
  servicePathEnabled?: boolean;
};
export type PreProjectListItem = Pick<PreProjectCase, "id" | "title" | "description" | "customerId" | "customerName" | "opportunityStatus" | "leadId" | "leadManagerName" | "amount" | "currencyCode" | "createdAt" | "updatedAt"> & {
  status: PreProjectCase["status"] | "qualified"; opportunityId: string | null; qualifiedLead?: boolean; leadVersion?: number;
  ownerMembershipId?: string | null; phase?: PreProjectCase["phase"]; targetDate?: string | null; priority?: PreProjectCase["priority"]; riskLevel?: PreProjectCase["riskLevel"];
  projectId?: string | null;
  servicePathEnabled?: boolean;
};
export type PreProjectList = { items: PreProjectListItem[]; canStartLead?: boolean; total: number; canCreate: boolean; workspaceId: string; error?: string };
export type PreProjectCandidate = { id: string; title: string; customerName: string; status: string; caseId: string | null };
export const requirementViews = [
  { section: "requirements", view: "requirement", label: tKey("Requirements") },
  { section: "measurements", view: "measurements", label: tKey("Measurements") },
  { section: "inspiration", view: "inspiration", label: tKey("Client inspirations") },
  { section: "site-layouts", view: "file", label: tKey("Site layouts") },
] as const;
export const caseSections = ["overview", ...requirementViews.map(item => item.section), "site", "designs", "definition", "boq", "quotations", "contracts", "payment-plan", "variations", "approvals", "execution-release", "client-portal", "documents"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function caseRoute(path: string) {
  const match = path.match(/^\/workspace\/pre-projects\/cases\/([^/]+)(?:\/([^/]+))?$/);
  return match && uuid.test(match[1]) && caseSections.includes(match[2] ?? "overview") ? { id: match[1], section: match[2] ?? "overview" } : null;
}
/** Only known selector state is allowed in return links; never accept an arbitrary destination. */
export function listSearch(query: URLSearchParams) {
  const result = new URLSearchParams();
  const search = query.get("search")?.trim().slice(0, 200);
  if (search) result.set("search", search);
  const page = Number(query.get("page"));
  if (Number.isInteger(page) && page > 1 && page <= 10000) result.set("page", String(page));
  const section = query.get("section");
  if (section && caseSections.includes(section) && section !== "overview") result.set("section", section);
  return result;
}
export function caseHref(id: string, query = new URLSearchParams(), section = "requirements") {
  const state = listSearch(query).toString();
  return `${PRE_PROJECT_ROOT}/cases/${id}/${section}${state ? `?${state}` : ""}`;
}
