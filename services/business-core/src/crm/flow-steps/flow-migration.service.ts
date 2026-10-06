import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { WON_COLUMN } from "../flows/flow-definition";
import { migrationEffect } from "../flows/flow-migration";
import { flowVersionById } from "../flows/flow-store";
import { OpportunityDiscoveryService } from "../opportunities/discovery.service";
import { loadFlowFacts } from "../opportunities/flow-facts";
import { tellMembers } from "./flow-step-notices";

const PERMISSION = "crm.settings.manage";
const MAX_JOBS = 200;

type JobRow = { id: string; reference: string; title: string; status: string; version: number; ownerMembershipId: string | null; ownerName: string | null;
  stageCode: string | null; flowVersionId: string; fromVersion: number };

/**
 * E2-3 (plan §5a engine rule 3): running jobs keep the version of their enquiry type's steps they started on. An
 * admin moves them to the latest version explicitly, after a preview that shows, per job, where it stands on each
 * version, what its column now also needs (flagged, never undone, E2-2) and the steps it would drop (kept in the
 * audit with the reason, E2-1). The move is version-checked against the flow's latest version and idempotent.
 */
@Injectable()
export class FlowMigrationService {
  constructor(private readonly access: WorkspaceAccessService, private readonly discovery: OpportunityDiscoveryService) {}

  preview(actor: RequestActor, workspaceId: string, flowId: string) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const latest = await this.latest(client, workspaceId, flowId);
      const target = (await flowVersionById(client, workspaceId, latest.id))!;
      const jobs = await this.runningJobs(client, workspaceId, flowId, latest.version);
      const rows = [];
      for (const job of jobs) {
        const from = await flowVersionById(client, workspaceId, job.flowVersionId);
        if (!from) continue;
        const facts = await loadFlowFacts(client, workspaceId, job.id, this.discovery, { actorUserId: user.userId });
        rows.push({
          opportunityId: job.id, reference: job.reference, title: job.title, owner: job.ownerName, fromVersion: job.fromVersion,
          ...migrationEffect({ from: from.definition, to: target.definition, facts, column: this.columnOf(job) }),
        });
      }
      return { flowId, toVersion: latest.version, jobs: rows, truncated: jobs.length >= MAX_JOBS };
    });
  }

  /** Moves the named jobs (from the preview) to the latest version; jobs already on it are left as they are. */
  migrate(actor: RequestActor, workspaceId: string, flowId: string, input: { toVersion: number; opportunityIds: string[] }) {
    const ids = [...new Set(input.opportunityIds)];
    if (!ids.length) throw new UnprocessableEntityException("Choose the jobs to move");
    if (ids.length > MAX_JOBS) throw new UnprocessableEntityException(`Move at most ${MAX_JOBS} jobs at a time`);
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const latest = await this.latest(client, workspaceId, flowId);
      if (latest.version !== input.toVersion) throw new ConflictException("These steps changed in another window. Reload and try again.");
      const target = (await flowVersionById(client, workspaceId, latest.id))!;
      const flow = (await client.query<{ name: string }>(`SELECT name FROM crm_flows WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId])).rows[0];
      const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      const jobs = (await client.query<JobRow>(
        `${JOB_SELECT} WHERE job.workspace_id = $1 AND job.id = ANY($2::uuid[]) ORDER BY job.reference FOR UPDATE OF job`, [workspaceId, ids])).rows;
      const moved: string[] = [];
      const unchanged: string[] = [];
      const skipped: Array<{ opportunityId: string; reason: string }> = [];
      for (const id of ids) {
        const job = jobs.find((row) => row.id === id);
        if (!job) { skipped.push({ opportunityId: id, reason: "Not found" }); continue; }
        if (job.flowVersionId === latest.id) { unchanged.push(id); continue; }
        if (job.status !== "open") { skipped.push({ opportunityId: id, reason: "Not running" }); continue; }
        const from = await flowVersionById(client, workspaceId, job.flowVersionId);
        if (!from || from.flowId !== flowId) { skipped.push({ opportunityId: id, reason: "Runs other steps" }); continue; }
        const facts = await loadFlowFacts(client, workspaceId, id, this.discovery, { actorUserId: user.userId });
        const effect = migrationEffect({ from: from.definition, to: target.definition, facts, column: this.columnOf(job) });
        await client.query(`UPDATE crm_opportunities SET flow_version_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, latest.id]);
        await recordAudit(client, {
          workspaceId, actorUserId: user.userId, action: "crm.opportunity.flow_migrated.v1", entityType: "crm_opportunity", entityId: id,
          before: { flowVersionId: job.flowVersionId, version: job.fromVersion, now: effect.nowBefore },
          after: { flowVersionId: latest.id, version: latest.version, now: effect.nowAfter, newlyMissing: effect.newlyMissing, dropped: effect.dropped,
            reason: `Moved to version ${latest.version}` },
        });
        await tellMembers(client, {
          workspaceId, membershipIds: [job.ownerMembershipId], actorUserId: user.userId, code: "flow.job_moved", channel: "in_app",
          variables: { title: `${job.reference} · ${job.title}`, actor: actorName, version: String(latest.version), flow: flow?.name ?? "", now: effect.nowAfter?.name ?? "—" },
          deepLink: `/workspace/crm/opportunities?record=${id}`, key: `flow:moved:${id}:${latest.id}`,
        });
        moved.push(id);
      }
      if (moved.length) await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.flow.jobs_migrated.v1", entityType: "crm_flow", entityId: flowId,
        after: { toVersion: latest.version, versionId: latest.id, moved: moved.length, unchanged: unchanged.length, skipped: skipped.length },
      });
      return { toVersion: latest.version, moved, unchanged, skipped };
    });
  }

  private columnOf(job: JobRow) {
    return job.status === "won" ? WON_COLUMN : job.stageCode;
  }

  private async latest(client: PoolClient, workspaceId: string, flowId: string) {
    const row = (await client.query<{ id: string; version: number }>(
      `SELECT version.id, version.version FROM crm_flows flow JOIN crm_flow_versions version ON version.workspace_id = flow.workspace_id AND version.flow_id = flow.id
        WHERE flow.workspace_id = $1 AND flow.id = $2 ORDER BY version.version DESC LIMIT 1`, [workspaceId, flowId])).rows[0];
    if (!row) throw new NotFoundException("Flow not found");
    return row;
  }

  /** Open jobs pinned to an older version of this flow, oldest version first. */
  private async runningJobs(client: PoolClient, workspaceId: string, flowId: string, latestVersion: number) {
    return (await client.query<JobRow>(
      `${JOB_SELECT} WHERE job.workspace_id = $1 AND pinned.flow_id = $2 AND pinned.version < $3 AND job.status = 'open'
        ORDER BY pinned.version, job.reference LIMIT ${MAX_JOBS}`, [workspaceId, flowId, latestVersion])).rows;
  }
}

const JOB_SELECT = `SELECT job.id, job.reference, job.title, job.status::text AS status, job.version, job.owner_membership_id AS "ownerMembershipId",
         owner.display_name AS "ownerName", stage.code AS "stageCode", job.flow_version_id AS "flowVersionId", pinned.version AS "fromVersion"
    FROM crm_opportunities job
    JOIN crm_flow_versions pinned ON pinned.workspace_id = job.workspace_id AND pinned.id = job.flow_version_id
    LEFT JOIN crm_pipeline_stages stage ON stage.workspace_id = job.workspace_id AND stage.id = job.stage_id
    LEFT JOIN workspace_memberships member ON member.id = job.owner_membership_id
    LEFT JOIN users owner ON owner.id = member.user_id`;
