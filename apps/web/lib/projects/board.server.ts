import type { PortfolioRow } from "@/components/projects/project-portfolio";
import { getPreProjects } from "@/lib/pre-project/server";
import { projectRead } from "@/lib/projects/server";
import type { ProjectWorkflowTemplatesResponse } from "@/lib/projects/workflow-templates";
import { isNoAccessError } from "@/design-system/foundations/access";

/** Everything the Planning and Projects boards need, loaded once on the server. */
export async function loadProjectsBoard() {
  const [execution, planning, workflow] = await Promise.allSettled([projectRead<PortfolioRow[]>("portfolio"), getPreProjects(new URLSearchParams()), projectRead<ProjectWorkflowTemplatesResponse>("workflow-templates")]);
  if (planning.status === "rejected") throw planning.reason;
  const data = planning.value;
  const palmFlowEnabled = workflow.status === "fulfilled" && workflow.value.data.defaultTemplate.code === "design_build_deal_first";
  for (let page = 2; data.items.length < data.total && !data.error; page++) {
    const next = await getPreProjects(new URLSearchParams({ page: String(page) }));
    if (next.error) { data.error = next.error; break; }
    if (!next.items.length) break;
    const fresh = next.items.filter((item) => !data.items.some((existing) => existing.id === item.id));
    if (!fresh.length) break;
    data.items.push(...fresh);
  }
  return {
    projects: execution.status === "fulfilled" ? execution.value.data : [],
    planning: data,
    palmFlowEnabled,
    // Someone without Projects simply has no project rows here; only a failing service is worth a warning.
    projectError: execution.status === "rejected" && !isNoAccessError(execution.reason) ? "Projects could not be loaded. Refresh to try again." : workflow.status === "rejected" && !isNoAccessError(workflow.reason) ? "Project workflow could not be loaded. Refresh to confirm which records belong in Planning." : undefined,
  };
}
