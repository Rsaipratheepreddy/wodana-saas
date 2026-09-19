import { ProjectWorkflowTemplatesPage } from "@/components/projects/project-workflow-templates";
import { projectRead } from "@/lib/projects/server";
import type { ProjectWorkflowTemplatesResponse } from "@/lib/projects/workflow-templates";

export default async function ProjectWorkflowTemplatesEntryPage() {
  const { workspaceId, data } = await projectRead<ProjectWorkflowTemplatesResponse>(
    "workflow-templates",
  );
  return <ProjectWorkflowTemplatesPage initialData={data} workspaceId={workspaceId} />;
}
