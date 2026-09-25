import { caseApi, type CaseContent, type CaseDesign, type DesignOptions } from "@/lib/pre-project/content";
import type { PreProjectCase } from "@/lib/pre-project/types";
import { commercialPath } from "@/lib/commercial/client";
import type { CommercialState } from "@/lib/commercial/types";

export type ProjectPlanningContext = { workspaceId: string; caseId: string | null; projectId?: string };
export type ProjectPlanningSection = "requirements" | "design" | "quotations" | "agreement" | "approvals" | "change-requests";
export type ProjectPlanningData =
  | { section: "requirements"; content: CaseContent }
  | { section: "design"; content: CaseContent; designs: CaseDesign[]; options: DesignOptions }
  | { section: "quotations" | "agreement" | "approvals" | "change-requests"; record: PreProjectCase; commercial: CommercialState };

export async function loadProjectPlanning(context: ProjectPlanningContext, section: ProjectPlanningSection, signal: AbortSignal): Promise<ProjectPlanningData> {
  const { workspaceId, caseId } = context;
  if (!caseId) throw new Error("This project has no linked planning record. Link its planning record before adding requirements, designs or quotations.");
  async function read<T>(url: string): Promise<T> {
    const response = await fetch(url, { signal, cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 401 ? "Your session has expired. Sign in again to continue." : response.status === 403 ? "You do not have permission to view this planning section." : typeof body?.message === "string" ? body.message : "Planning data could not be loaded. Please retry.");
    if (!body) throw new Error("The planning service returned an empty response. Please retry.");
    return body as T;
  }
  if (section === "quotations" || section === "agreement" || section === "approvals" || section === "change-requests") {
    const [record, commercial] = await Promise.all([
      read<PreProjectCase>(`/api/workspace/pre-projects/${caseId}?workspaceId=${encodeURIComponent(workspaceId)}`),
      read<CommercialState>(commercialPath(workspaceId, `cases/${caseId}`)),
    ]);
    return { section, record, commercial };
  }
  if (section === "design") {
    const [content, listing] = await Promise.all([
      read<CaseContent>(caseApi(workspaceId, caseId, "brief")),
      read<DesignOptions & { items: CaseDesign[] }>(caseApi(workspaceId, caseId, "designs")),
    ]);
    return { section, content, designs: listing.items, options: listing };
  }
  return { section: "requirements", content: await read<CaseContent>(caseApi(workspaceId, caseId, "brief")) };
}
