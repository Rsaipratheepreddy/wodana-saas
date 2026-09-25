import { DEAL_FIRST_WORKFLOW_CODE } from "./deal-first-workflow";
import { projectRepository } from "./project-repository";
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { CommercialData } from "../commercial/commercial.types";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { emptyProject } from "./execution.domain";
import type { ProjectData } from "./execution.types";
import { adoptProjectWorkflow } from "./project-workflow";
import { resolvedProjectWorkflowTemplate } from "./project-workflow.repository";
import { palmProjectWorkflowTemplate } from "./palm-project-workflow";

/** Open one Project Ref at the first paid, Owner-approved agreement, before delivery release. */
export async function openPalmProjectAtDealFile(
  client: PoolClient,
  workspaceId: string,
  caseId: string,
  userId: string,
  userName: string,
  data: CommercialData,
): Promise<string> {
  const flow = data.palmFlow;
  const deal = data.dealFile;
  if (!flow || !deal || data.ownerReview?.status !== "approved" || data.ownerReview.quoteId !== deal.quoteId)
    throw new ConflictException("Approve the paid Deal File before opening its project.");
  const project = (await client.query<{ id: string }>(
    `INSERT INTO delivery_projects(workspace_id,case_id,name,created_by)
     SELECT c.workspace_id,c.id,o.title,$3 FROM pre_project_cases c
     JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id
     WHERE c.workspace_id=$1 AND c.id=$2
     ON CONFLICT(workspace_id,case_id) DO UPDATE SET name=delivery_projects.name RETURNING id`,
    [workspaceId, caseId, userId],
  )).rows[0];
  if (!project) throw new ConflictException("The enquiry could not be linked to a project.");
  const existing = (await projectRepository.load(client, workspaceId, project.id, { forUpdate: true }))
    ?.content as ProjectData | undefined;
  if (existing?.scope || (existing?.workflow && existing.workflow.template.code !== DEAL_FIRST_WORKFLOW_CODE))
    throw new ConflictException("This enquiry already has a different project flow. Reconcile it before approving the Deal File.");
  if (!existing?.workflow) {
    const execution = existing ?? emptyProject();
    const template = palmProjectWorkflowTemplate(
      await resolvedProjectWorkflowTemplate(client, workspaceId), flow.scope,
    );
    execution.workflow = adoptProjectWorkflow(template, deal.approvedAt, userId, userName);
    execution.controls ??= emptyProject().controls;
    execution.controls!.reference = deal.reference.replace(/^DF-/, "PRJ-");
    execution.phase = "active";
    execution.revision++;
    await projectRepository.save(client, workspaceId, project.id, execution);
  }
  await ensureJobForSource(client, workspaceId, { type: "project", id: project.id }, userId);
  await client.query(
    `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active)
     SELECT workspace_id,$3,membership_id,is_manager,active FROM project_assignments
     WHERE workspace_id=$1 AND case_id=$2
     ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL
     DO UPDATE SET active=EXCLUDED.active,is_manager=EXCLUDED.is_manager`,
    [workspaceId, caseId, project.id],
  );
  await client.query(
    `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager)
     SELECT $1,$2,id,true FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$3 AND status='active'
     ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL
     DO UPDATE SET active=true,is_manager=true`,
    [workspaceId, project.id, userId],
  );
  const link = await client.query(
    `INSERT INTO crm_project_links(workspace_id,opportunity_id,project_id,mode,promoted_at)
     SELECT $1,opportunity_id,$3,'delivery',now() FROM pre_project_cases WHERE workspace_id=$1 AND id=$2
     ON CONFLICT(workspace_id,opportunity_id) DO UPDATE
     SET mode='delivery',promoted_at=COALESCE(crm_project_links.promoted_at,now())
     WHERE crm_project_links.project_id=EXCLUDED.project_id RETURNING id`,
    [workspaceId, caseId, project.id],
  );
  if (!link.rowCount) throw new ConflictException("CRM already links this enquiry to another project.");
  return project.id;
}
