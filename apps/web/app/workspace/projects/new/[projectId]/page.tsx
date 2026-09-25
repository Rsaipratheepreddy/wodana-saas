import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/projects/server";

// Keep bookmarks from the experiment working without exposing the new workspace.
export default async function NewProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const localPreview = process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true" && projectId === "demo";
  if (!/^[0-9a-f-]{36}$/i.test(projectId) && !localPreview) notFound();
  const { data: project } = await getProject(projectId);
  const query = await searchParams;
  if (query.tab === "planning" && project.caseId) {
    const section = query.planningTab === "design" ? "designs" : query.planningTab === "quotations" ? "quotations" : query.planningTab === "change-requests" ? "variations" : "requirements";
    redirect(`/workspace/pre-projects/cases/${project.caseId}/${section}`);
  }
  const section = query.tab === "finance" || query.tab === "finance-expenses" ? "commercial"
    : query.tab === "work" || query.tab === "execution" ? "plan-teams"
    : query.tab === "approved-scope" ? "boq"
    : query.tab === "materials-procurement" ? "procurement"
    : query.tab === "quality-handover" ? "handover"
    : query.tab === "issues-delays" ? "snagging" : "overview";
  redirect(`/workspace/projects/${projectId}/${section}`);
}
