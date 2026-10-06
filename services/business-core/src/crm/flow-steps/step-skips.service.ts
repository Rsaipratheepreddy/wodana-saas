import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { DesignJourneyService } from "../../design/design-journey.service";
import { canSkipStep, isMaterialSelectionStep } from "../flows/flow-definition";
import { resolveLine, stepMissing } from "../flows/flow-interpreter";
import { OpportunityDiscoveryService } from "../opportunities/discovery.service";
import { loadFlowFacts } from "../opportunities/flow-facts";
import { tellMembers } from "./flow-step-notices";

export type SkipStepInput = { version: number; reason: string; commandId?: string | null };
export type UnskipStepInput = { version: number; reason?: string | null };

type Job = { id: string; status: string; version: number; title: string; reference: string; ownerMembershipId: string | null; flowVersionId: string | null };

/**
 * E2-5 / PLM-081: a job marks one of its steps as not needed, always with a reason, who and when. Allowed only for a
 * step its enquiry type marks "used if needed", and for material selection ("Not required for this order"), which
 * otherwise is never left blank. The payment proof is never skipped. Version-checked against the job, idempotent on
 * replay (the same command id, or the same skip sent again), audited; the owner is told when someone else does it.
 */
@Injectable()
export class StepSkipsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly discovery: OpportunityDiscoveryService, private readonly journey: DesignJourneyService) {}

  async skip(actor: RequestActor, workspaceId: string, opportunityId: string, stepKey: string, input: SkipStepInput) {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) throw new UnprocessableEntityException("Say why this step isn't needed");
    if (reason.length > 1000) throw new UnprocessableEntityException("Keep the reason under 1000 characters");
    const result = await this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const job = await this.lock(client, workspaceId, opportunityId);
      const live = await this.liveSkip(client, workspaceId, opportunityId, stepKey);
      // The same skip sent again (the same command, or the same step and reason by the same person): nothing changes.
      if (live && ((input.commandId && live.commandId === input.commandId) || (live.reason === reason && live.skippedBy === user.userId && job.version === input.version + 1)))
        return { version: job.version, stepKey, skip: this.present(live), replay: true, material: false };
      if (input.commandId) {
        const used = await client.query(`SELECT 1 FROM crm_opportunity_step_skips WHERE workspace_id = $1 AND command_id = $2`, [workspaceId, input.commandId]);
        if (used.rowCount) throw new ConflictException("This change was already made. Reload the opportunity.");
      }
      if (job.version !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      if (job.status !== "open") throw new UnprocessableEntityException("Reopen the opportunity before changing its steps");
      if (live) throw new ConflictException("This step is already marked not needed");
      const facts = await loadFlowFacts(client, workspaceId, opportunityId, this.discovery, { actorUserId: user.userId });
      const line = resolveLine(facts.flowDefinition.definition, facts);
      const index = line.findIndex((step) => step.key === stepKey);
      if (index < 0) throw new NotFoundException("This step isn't on this job's steps");
      const step = line[index];
      if (!canSkipStep(step)) throw new UnprocessableEntityException("Only a step marked Used if needed, or material selection, can be marked not needed");
      if (!stepMissing(step, facts, line.slice(0, index)).length) throw new ConflictException("This step is already done");
      const row = (await client.query<{ id: string; skippedAt: Date }>(
        `INSERT INTO crm_opportunity_step_skips (workspace_id, opportunity_id, step_key, flow_version_id, reason, command_id, skipped_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, skipped_at AS "skippedAt"`,
        [workspaceId, opportunityId, stepKey, facts.flowDefinition.versionId, reason, input.commandId ?? null, user.userId])).rows[0];
      const version = await this.bump(client, workspaceId, opportunityId);
      const material = isMaterialSelectionStep(step);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.opportunity.step_skipped.v1", entityType: "crm_opportunity", entityId: opportunityId,
        after: { skipId: row.id, stepKey, step: step.name, reason, flowVersionId: facts.flowDefinition.versionId, notRequiredForOrder: material },
      });
      const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      await tellMembers(client, {
        workspaceId, membershipIds: [job.ownerMembershipId], actorUserId: user.userId, code: "flow.step_not_needed", channel: "in_app",
        variables: { step: step.name, title: `${job.reference} · ${job.title}`, actor: actorName, reason },
        deepLink: `/workspace/crm/opportunities?record=${opportunityId}`, key: `flow:skip:${row.id}`,
      });
      return { version, stepKey, skip: { reason, by: actorName, at: row.skippedAt.toISOString() }, replay: false, material, caseId: facts.caseId };
    });
    // PLM-081: a case already running its material selection (the design stages) is closed the same way, so the
    // job and the case agree. Best effort: the job's skip stands either way; the case keeps its own button.
    const caseSynced = !result.replay && result.material && "caseId" in result && result.caseId ? await this.closeCaseMaterials(actor, workspaceId, result.caseId) : false;
    const { caseId: _caseId, material: _material, ...rest } = result as typeof result & { caseId?: string | null };
    return { ...rest, caseSynced };
  }

  /** Undoes a skip: the step is needed again. The skip row stays, with who undid it, when and why. */
  unskip(actor: RequestActor, workspaceId: string, opportunityId: string, stepKey: string, input: UnskipStepInput) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const job = await this.lock(client, workspaceId, opportunityId);
      const live = await this.liveSkip(client, workspaceId, opportunityId, stepKey);
      // Undone already (the same undo sent twice): nothing changes.
      if (!live && job.version === input.version + 1) return { version: job.version, stepKey, skip: null };
      if (job.version !== input.version) throw new ConflictException("Opportunity changed; reload and try again");
      if (job.status !== "open") throw new UnprocessableEntityException("Reopen the opportunity before changing its steps");
      if (!live) throw new NotFoundException("This step isn't marked not needed");
      await client.query(`UPDATE crm_opportunity_step_skips SET revoked_at = now(), revoked_by = $3, revoke_reason = $4 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, live.id, user.userId, input.reason?.trim() || null]);
      const version = await this.bump(client, workspaceId, opportunityId);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.opportunity.step_skip_undone.v1", entityType: "crm_opportunity", entityId: opportunityId,
        before: { skipId: live.id, stepKey, reason: live.reason }, after: { reason: input.reason?.trim() || null },
      });
      return { version, stepKey, skip: null };
    });
  }

  private async closeCaseMaterials(actor: RequestActor, workspaceId: string, caseId: string) {
    try {
      const view = await this.journey.get(actor, workspaceId, caseId) as unknown as { stages?: Array<{ stage: string; status: string; version: number }> };
      const stage = view.stages?.find((item) => item.stage === "material_selection");
      if (!stage || stage.status !== "active") return false;
      await this.journey.materialsNotRequired(actor, workspaceId, caseId, { version: stage.version });
      return true;
    } catch {
      return false;
    }
  }

  private present(row: { reason: string; byName: string | null; skippedAt: Date }) {
    return { reason: row.reason, by: row.byName, at: row.skippedAt.toISOString() };
  }

  private async liveSkip(client: PoolClient, workspaceId: string, opportunityId: string, stepKey: string) {
    return (await client.query<{ id: string; reason: string; commandId: string | null; skippedBy: string; byName: string | null; skippedAt: Date }>(
      `SELECT skip.id, skip.reason, skip.command_id AS "commandId", skip.skipped_by AS "skippedBy", account.display_name AS "byName", skip.skipped_at AS "skippedAt"
         FROM crm_opportunity_step_skips skip LEFT JOIN users account ON account.id = skip.skipped_by
        WHERE skip.workspace_id = $1 AND skip.opportunity_id = $2 AND skip.step_key = $3 AND skip.revoked_at IS NULL`,
      [workspaceId, opportunityId, stepKey])).rows[0] ?? null;
  }

  private async lock(client: PoolClient, workspaceId: string, opportunityId: string): Promise<Job> {
    const row = (await client.query<Job>(
      `SELECT id, status::text AS status, version, title, reference, owner_membership_id AS "ownerMembershipId", flow_version_id AS "flowVersionId"
         FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return { ...row, version: Number(row.version) };
  }

  /** A skip changes what the job still needs, so open editors of the job reload. */
  private async bump(client: PoolClient, workspaceId: string, opportunityId: string) {
    return Number((await client.query<{ version: number }>(
      `UPDATE crm_opportunities SET version = version + 1 WHERE workspace_id = $1 AND id = $2 RETURNING version`, [workspaceId, opportunityId])).rows[0].version);
  }
}
