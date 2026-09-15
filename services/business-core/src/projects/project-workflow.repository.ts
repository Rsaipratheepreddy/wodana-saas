import type { PoolClient } from "pg";
import {
  builtInProjectWorkflow,
  parseProjectWorkflowTemplate,
  type ProjectWorkflowStage,
  type ProjectWorkflowTemplate,
} from "./project-workflow";

type DefaultWorkflowRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  version: number;
  stages: ProjectWorkflowStage[];
  updatedAt: Date | string;
};

export async function resolvedProjectWorkflowTemplate(
  client: PoolClient,
  workspaceId: string,
): Promise<ProjectWorkflowTemplate> {
  const result = await client.query<DefaultWorkflowRow>(
    `SELECT id,code,name,description,is_default AS "isDefault",version,stages,
            updated_at AS "updatedAt"
     FROM project_workflow_templates
     WHERE workspace_id=$1 AND status='active' AND is_default
     LIMIT 1`,
    [workspaceId],
  );
  if (!result.rowCount) return builtInProjectWorkflow();
  const row = result.rows[0];
  return {
    id: row.id,
    ...parseProjectWorkflowTemplate({
      version: row.version,
      code: row.code,
      name: row.name,
      description: row.description,
      isDefault: row.isDefault,
      stages: row.stages,
    }),
    status: "active",
    source: "workspace",
    updatedAt: row.updatedAt,
  };
}
