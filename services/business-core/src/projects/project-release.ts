import { projectRepository } from "./project-repository";
import { acceptedQuoteLines, acceptedQuoteValue, freezeHash } from "../commercial/commercial.domain";
import {
  approvedMaterialEvidence,
  commercialReleaseReady,
  sameMaterialEvidence,
} from "../commercial/release-integrity";
import type { PoolClient } from "pg";
import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ensureJobForSource } from "../jobs/job-identity.store";
import type { CommercialData } from "../commercial/commercial.types";
import { activeAcceptedBaseQuote } from "../commercial/palm-commercial-rounds";
import { emptyProject } from "./execution.domain";
import type { ProjectData, ProjectInitiation } from "./execution.types";
import { releasedScopeLine } from "./released-scope-line";
import { adoptProjectWorkflow, enterCommercialReleaseStage } from "./project-workflow";
import { resolvedProjectWorkflowTemplate } from "./project-workflow.repository";
import { syncScopeWorkPackages } from "./project-work-packages";
import {
  captureApprovedDesignBaseline,
  sameDesignEvidence,
  synchroniseApprovedDesignDocuments,
} from "./project-design-control";

function releasedInitiation(
  data: CommercialData,
  quote: NonNullable<CommercialData["quotes"]>[number],
  quoteHash: string,
  frozenScope?: NonNullable<ProjectData["scope"]>,
): ProjectInitiation {
  const dealFile = data.dealFile!;
  return {
    status: "not_started",
    commercial: {
      quoteId: frozenScope?.quoteId ?? quote.id,
      quoteHash: frozenScope?.quoteHash ?? quoteHash,
      quoteNumber: frozenScope?.quoteNumber ?? quote.number,
      dealFileId: frozenScope?.dealFileId ?? dealFile.id,
      dealFileReference: frozenScope?.dealFileReference ?? dealFile.reference,
      agreementReference: data.agreement?.reference ?? dealFile.agreementReference,
      currency: frozenScope?.currency ?? quote.currency,
      value: frozenScope?.value ?? acceptedQuoteValue(quote),
      paymentMilestones: data.payments
        .filter(
          (payment) =>
            payment.sourceQuoteId === (frozenScope?.quoteId ?? quote.id),
        )
        .map((payment) => ({
          id: payment.id,
          title: payment.title,
          amount: payment.amount,
          dueDate: payment.dueDate,
          trigger: payment.trigger ?? "",
          requiredForRelease: payment.requiredForRelease,
          requiredForProduction: payment.requiredForProduction === true,
        })),
    },
    baseline: null,
    confirmedAt: "",
    confirmedById: "",
    confirmedByName: "",
    revisions: [],
  };
}
// Called inside the same transaction and pre-execution row lock as commercial approval.
export async function releaseDeliveryProject(
  client: PoolClient,
  workspaceId: string,
  caseId: string,
  userId: string,
  data: CommercialData,
) {
  const quote = activeAcceptedBaseQuote(data), dealFile = data.dealFile;
  if (!quote || !dealFile || !commercialReleaseReady(data))
    throw new ConflictException(
      "Complete the commercial release checklist before starting execution.",
    );
  const acceptedHash = freezeHash(quote);
  if (
    dealFile.quoteHash !== acceptedHash ||
    data.ownerReview?.quoteHash !== acceptedHash
  )
    throw new ConflictException(
      "The accepted quotation no longer matches the approved Deal File. Complete a new owner review before release.",
    );
  const designBaseline = await captureApprovedDesignBaseline(
    client,
    workspaceId,
    caseId,
    acceptedQuoteLines(quote).map((line) => ({
      scopeLineId: line.id,
      sourceScopeId: line.scopeId,
      sourceScopeVersion: line.scopeVersion,
      sourceSpecificationVersion: line.specificationVersion,
      title: line.title,
    })),
    data.release!.at,
    quote.definitionBaseline,
    { includePackageDesigns: Boolean(data.palmFlow?.scope.design && quote.round === "main") },
  );
  if (
    !sameDesignEvidence(quote.designEvidence, designBaseline) ||
    !sameDesignEvidence(dealFile.designEvidence, designBaseline)
  )
    throw new ConflictException(
      "The approved design evidence no longer matches this quotation. Create and approve a revised quotation or controlled Change Case before release.",
    );
  const materialEvidence = approvedMaterialEvidence(
    quote,
    data.materialApprovals,
  );
  if (!sameMaterialEvidence(dealFile.materialEvidence, materialEvidence))
    throw new ConflictException(
      "The approved material evidence no longer matches the Deal File. Complete a controlled review before release.",
    );
  const p = (
    await client.query(
      `INSERT INTO delivery_projects(workspace_id,case_id,name,created_by) SELECT c.workspace_id,c.id,o.title,$3 FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id WHERE c.workspace_id=$1 AND c.id=$2 ON CONFLICT(workspace_id,case_id) DO UPDATE SET name=delivery_projects.name RETURNING id,name,status,case_id AS "caseId"`,
      [workspaceId, caseId, userId],
    )
  ).rows[0];
  await ensureJobForSource(client, workspaceId, { type: "project", id: String(p.id) }, userId);
  const existing = (await projectRepository.load(client, workspaceId, String(p.id), { forUpdate: true }))
    ?.content as ProjectData | undefined;
  const execution = existing ?? emptyProject();
  let executionChanged = false;
  if (!execution.scope) {
    execution.workflow ??= adoptProjectWorkflow(
      await resolvedProjectWorkflowTemplate(client, workspaceId),
      data.release!.at,
      userId,
      data.release!.by,
      { commercialRelease: true },
    );
    enterCommercialReleaseStage(execution.workflow, data.release!.at, userId, data.release!.by);
    execution.controls = {
      ...(execution.controls ?? emptyProject().controls!),
      reference: dealFile.reference.replace(/^DF-/, "PRJ-"),
    };
    execution.roleAssignments ??= [];
    execution.approvedMaterials = materialEvidence
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
    execution.designBaseline = designBaseline;
    synchroniseApprovedDesignDocuments(
      execution,
      designBaseline,
      data.release!.at,
      randomUUID,
    );
    execution.initiation = releasedInitiation(
      data,
      quote,
      acceptedHash,
    );
    execution.scope = {
      quoteId: quote.id,
      quoteHash: acceptedHash,
      quoteNumber: quote.number,
      definitionBaseline: quote.definitionBaseline,
      dealFileId: dealFile.id,
      dealFileReference: dealFile.reference,
      releaseId: data.release!.id,
      releasedAt: data.release!.at,
      currency: quote.currency,
      value: acceptedQuoteValue(quote),
      lines: acceptedQuoteLines(quote).map(releasedScopeLine),
    };
    syncScopeWorkPackages(execution, data.release!.at);
    execution.phase = "active";
    executionChanged = true;
  } else {
    // A safe retry upgrades historical releases independently for every
    // additive projection, while preserving the original scope snapshot.
    const neededInitiation = !execution.initiation;
    if (neededInitiation)
      execution.initiation = releasedInitiation(
        data,
        quote,
        acceptedHash,
        execution.scope,
      );
    const neededDesignBaseline = !execution.designBaseline;
    if (neededDesignBaseline) {
      execution.designBaseline = designBaseline;
      synchroniseApprovedDesignDocuments(
        execution,
        designBaseline,
        data.release!.at,
        randomUUID,
      );
    }
    const createdPackages = syncScopeWorkPackages(execution, data.release!.at);
    executionChanged =
      neededInitiation || neededDesignBaseline || createdPackages.length > 0;
  }
  if (executionChanged) {
    execution.revision++;
    await projectRepository.save(client, workspaceId, String(p.id), execution);
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
    "UPDATE pre_project_cases SET status='released',phase='release',released_at=COALESCE(released_at,now()),released_by=COALESCE(released_by,$3),version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
    [workspaceId, caseId, userId],
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
