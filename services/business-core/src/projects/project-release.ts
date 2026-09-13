import { quotationMaterialText } from "../commercial/quotation-material-text";
import { commercialReleaseReady } from "../commercial/release-integrity";
import type { PoolClient } from "pg";
import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CommercialData } from "../commercial/commercial.types";
import { emptyProject } from "./execution.domain";
import type { ProjectData } from "./execution.types";
// Called inside the same transaction and pre-execution row lock as commercial approval.
export async function releaseDeliveryProject(
  client: PoolClient,
  workspaceId: string,
  caseId: string,
  userId: string,
  data: CommercialData,
) {
  const quote = data.quotes.find(
    (q) => q.kind === "quotation" && q.status === "accepted",
  ), dealFile = data.dealFile;
  if (!quote || !dealFile || !commercialReleaseReady(data))
    throw new ConflictException(
      "Complete the commercial release checklist before starting execution.",
    );
  const linked = quote.lines.filter((l) => l.scopeId);
  for (const line of linked) {
    const scope = (
      await client.query(
        `SELECT e.version,e.scope_status,e.archived_at,(SELECT max(s.version) FROM pre_project_item_specifications s WHERE s.workspace_id=e.workspace_id AND s.case_id=e.case_id AND s.entry_id=e.id) AS specification_version FROM pre_project_brief_entries e WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.id=$3`,
        [workspaceId, caseId, line.scopeId],
      )
    ).rows[0];
    if (
      !scope ||
      scope.archived_at ||
      scope.scope_status !== "included" ||
      scope.version !== line.scopeVersion ||
      (line.specificationVersion &&
        scope.specification_version !== line.specificationVersion)
    )
      throw new ConflictException(
        `Preparation changed for ${line.title}. Review its quotation revision before release.`,
      );
    const designs = (
      await client.query(
        `SELECT count(*)::int AS total,count(*) FILTER (WHERE v.status='approved' AND NOT EXISTS(SELECT 1 FROM pre_project_design_threads t WHERE t.workspace_id=v.workspace_id AND t.version_id=v.id AND t.blocking AND t.status='open'))::int AS approved FROM pre_project_item_design_refs r JOIN pre_project_design_versions v ON v.workspace_id=r.workspace_id AND v.id=r.design_version_id WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.entry_id=$3 AND r.version=$4`,
        [workspaceId, caseId, line.scopeId, line.specificationVersion ?? 0],
      )
    ).rows[0] as { total: number; approved: number };
    if (!designs.total || designs.approved !== designs.total)
      throw new ConflictException(
        `Complete the linked design approvals for ${line.title} before release.`,
      );
  }
  const p = (
    await client.query(
      `INSERT INTO delivery_projects(workspace_id,case_id,name,created_by) SELECT c.workspace_id,c.id,o.title,$3 FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id WHERE c.workspace_id=$1 AND c.id=$2 ON CONFLICT(workspace_id,case_id) DO UPDATE SET name=delivery_projects.name RETURNING id,name,status,case_id AS "caseId"`,
      [workspaceId, caseId, userId],
    )
  ).rows[0];
  const existing = (
    await client.query(
      "SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
      [workspaceId, p.id],
    )
  ).rows[0]?.content as ProjectData | undefined;
  const execution = existing ?? emptyProject();
  if (!execution.scope) {
    execution.controls = {
      ...(execution.controls ?? emptyProject().controls!),
      reference: dealFile.reference.replace(/^DF-/, "PRJ-"),
    };
    execution.roleAssignments ??= [];
    execution.approvedMaterials = (data.materialApprovals ?? [])
      .filter((approval) => approval.quoteId === quote.id && approval.status === "approved")
      .map((approval) => ({
        id: randomUUID(),
        sourceApprovalId: approval.id,
        quoteId: approval.quoteId,
        lineId: approval.lineId,
        room: approval.room,
        item: approval.item,
        name: approval.name,
        code: approval.code,
        brand: approval.brand,
        specification: approval.specification,
        revision: approval.revision,
        approvedAt: approval.decidedAt!,
        approvedBy: approval.decidedBy!,
      }));
    execution.scope = {
      quoteId: quote.id,
      quoteNumber: quote.number,
      currency: quote.currency,
      value: quote.total,
      lines: quote.lines.map((l) => ({
        id: l.id,
        title: l.title,
        room: l.room,
        material: quotationMaterialText(l),
        quantity: l.quantity,
        unit: l.unit,
      })),
    };
    execution.phase = "active";
    execution.revision++;
    await client.query(
      "INSERT INTO project_execution(project_id,workspace_id,revision,content) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET revision=$3,content=$4,updated_at=now() WHERE project_execution.workspace_id=$2",
      [p.id, workspaceId, execution.revision, JSON.stringify(execution)],
    );
  }
  await client.query(
    `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active) SELECT workspace_id,$3,membership_id,is_manager,active FROM project_assignments WHERE workspace_id=$1 AND case_id=$2 ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active=EXCLUDED.active,is_manager=EXCLUDED.is_manager`,
    [workspaceId, caseId, p.id],
  );
  await client.query(
    `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) SELECT $1,$2,id,true FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$3 AND status='active' ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active=true,is_manager=true`,
    [workspaceId, p.id, userId],
  );
  await client.query(
    "UPDATE work_locations SET project_id=$3,case_id=NULL,version=version+1 WHERE workspace_id=$1 AND case_id=$2",
    [workspaceId, caseId, p.id],
  );
  await client.query(
    "UPDATE pre_project_cases SET status='released',updated_at=now() WHERE workspace_id=$1 AND id=$2",
    [workspaceId, caseId],
  );
  const crmLink = await client.query(
    `INSERT INTO crm_project_links(workspace_id,opportunity_id,project_id,mode,promoted_at) SELECT $1,opportunity_id,$3,'delivery',now() FROM pre_project_cases WHERE workspace_id=$1 AND id=$2 ON CONFLICT(workspace_id,opportunity_id) DO UPDATE SET mode='delivery',promoted_at=COALESCE(crm_project_links.promoted_at,now()) WHERE crm_project_links.project_id=EXCLUDED.project_id RETURNING id`,
    [workspaceId, caseId, p.id],
  );
  if (!crmLink.rowCount)
    throw new ConflictException(
      "CRM already references another delivery project. Reconcile that link before releasing this project.",
    );
  return p;
}
