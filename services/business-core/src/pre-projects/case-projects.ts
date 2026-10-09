import type { PoolClient } from "pg";
import { emptyProject } from "../projects/execution.domain";
import type { ProjectData } from "../projects/execution.types";
import { projectWorkflowSummary } from "../projects/project-workflow";

type Db = Pick<PoolClient, "query">;

/**
 * A planning case's project as Planning reads it: the same for everyone who sees the case, never from the viewer's
 * own project list (which holds only the projects they're on). A project on staged delivery (its stages copied from
 * a delivery template) has left Planning; an older project keeps its route's phase and current workflow stage.
 */
export type CaseProject = {
  id: string; caseId: string; name: string; reference: string; status: string; onHold: boolean; managerName: string | null; nextAction: string;
  /** On staged delivery, with its current stage (none once every stage is finished). */
  staged: boolean; stageName: string | null;
  phase: string; workflow: { templateCode: string; currentStageKey: string; currentStageName: string } | null;
};

/** The projects of these cases, by case. */
export async function readCaseProjects(db: Db, workspaceId: string, caseIds: string[]): Promise<Map<string, CaseProject>> {
  if (!caseIds.length) return new Map();
  const rows = (await db.query<Omit<CaseProject, "workflow"> & { content: ProjectData | null }>(
    `SELECT project.id, project.case_id AS "caseId", project.name, project.status,
            coalesce(nullif(execution.content->'controls'->>'reference', ''), project.reference, '') AS reference,
            project.status = 'on_hold' OR coalesce((execution.content->'controls'->>'onHold')::boolean, false) AS "onHold",
            coalesce(execution.content->'controls'->>'nextAction', '') AS "nextAction",
            (SELECT string_agg(person.display_name, ', ' ORDER BY person.display_name) FROM project_assignments assignment
               JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id
               JOIN users person ON person.id = membership.user_id
              WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND assignment.is_manager) AS "managerName",
            EXISTS (SELECT 1 FROM project_stages stage WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id) AS staged,
            (SELECT stage.name FROM project_stages stage WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id AND stage.status = 'current') AS "stageName",
            coalesce(execution.content->>'phase', 'planning') AS phase, execution.content
       FROM delivery_projects project
       LEFT JOIN project_execution_view execution ON execution.workspace_id = project.workspace_id AND execution.project_id = project.id
      WHERE project.workspace_id = $1 AND project.case_id = ANY($2::uuid[])`,
    [workspaceId, caseIds])).rows;
  return new Map(rows.map(({ content, ...row }) => {
    // An older project's route, read the way its project list reads it; a staged project has none.
    const summary = row.staged ? null : projectWorkflowSummary(content ?? emptyProject());
    return [row.caseId, { ...row, workflow: summary ? { templateCode: summary.templateCode, currentStageKey: summary.currentStageKey, currentStageName: summary.currentStageName } : null }];
  }));
}
