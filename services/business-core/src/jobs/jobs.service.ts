import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { repairJobSourceLink } from "./job-identity.store";
import type { RepairJobLinkDto } from "./dto/repair-job-link.dto";
import type { SetJobStageDto } from "./dto/set-job-stage.dto";
import { queryClientTimeline, type ClientTimelineEvent } from "../crm/shared/client-timeline";
import {
  deriveJobOperatingState,
  type JobManualStage,
  type JobOperatingSource,
  type JobOperatingState,
  type JobSourcePointer,
} from "./job-operating-state";
// Mirrors the exported wire contract in packages/contracts/src/jobs.ts; the
// current CommonJS compiler configuration cannot resolve that ESM package.
type JobSourceType = "enquiry" | "lead" | "opportunity" | "case" | "quote" | "project";
type JobSourceLink = {
  type: JobSourceType; id: string; caseId: string | null;
  status: "active" | "detached"; version: number;
  sourceState: "available" | "missing" | "detached";
};
type JobIdentityProjection = JobOperatingState & {
  jobId: string; reference: string; createdAt: string; title: string | null;
  customer: { id: string; name: string } | null; links: JobSourceLink[];
  missingSourceCount: number; repairableLinkCount: number;
};
type JobTimelineEvent = {
  id: string;
  kind: "source_link" | "source_event" | "stage";
  title: string;
  detail: string | null;
  occurredAt: string;
  recordedAt: string;
  actor: { id: string; name: string | null } | null;
  source: JobSourcePointer | null;
};
type JobDetailProjection = JobIdentityProjection & {
  timeline: JobTimelineEvent[];
  clientTimeline: ClientTimelineEvent[];
  clientTimelineAccess: { communications: boolean; activities: boolean };
};
type JobIdentityList = { items: JobIdentityProjection[]; total: number; limit: number; offset: number };
type OneTreeKind = "site" | "room" | "zone" | "item";
type OneTreeRow = {
  id: string; kind: OneTreeKind; parentId: string | null; caseId: string;
  sourceType: "case" | "room" | "brief_entry" | "manual"; sourceId: string;
  sourceVersion: number; status: "active" | "archived"; identityVersion: number;
  revision: number; label: string; snapshot: Record<string, unknown>;
  replacesNodeId: string | null; createdAt: Date; archivedAt: Date | null;
};

type PermissionScope = {
  leads: boolean;
  opportunities: boolean;
  cases: boolean;
  projects: boolean;
  manageProjects: boolean;
  canRepair: boolean;
  canStage: boolean;
  membershipId: string;
};
type IdentityRow = { id: string; reference: string; createdAt: Date };
type FactRow = {
  jobId: string;
  type: JobSourceType;
  id: string;
  caseId: string | null;
  title: string | null;
  partyId: string | null;
  customerName: string | null;
  status: "active" | "detached";
  version: number;
};
type OperatingRow = {
  jobId: string;
  type: JobSourceType;
  id: string;
  caseId: string | null;
  sourceVersion: number;
  sourceStatus: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  ownerMembershipId: string | null;
  ownerName: string | null;
  nextActionTitle: string | null;
  nextActionDueAt: Date | null;
  nextActionReason: string | null;
  details: Record<string, unknown> | null;
};
type ManualStageRow = {
  jobId: string;
  phase: JobManualStage["phase"];
  stage: string;
  reason: string;
  setBy: string;
  setByName: string | null;
  setAt: Date;
  version: number;
};

const readablePermissions = [
  "crm.leads.view", "crm.opportunities.view", "pre_projects.view", "projects.view", "projects.manage",
];

// The same predicate is used for page membership and the returned link rows.
// In particular, projects.view alone never reveals an unassigned project.
const visibleLink = `(
  ($2::boolean AND link.record_type IN ('enquiry','lead')) OR
  ($3::boolean AND link.record_type='opportunity') OR
  ($4::boolean AND link.record_type IN ('case','quote')) OR
  ($5::boolean AND link.record_type='project' AND (
    $6::boolean OR EXISTS (
      SELECT 1 FROM project_assignments assignment
       WHERE assignment.workspace_id=link.workspace_id
         AND assignment.project_id::text=link.record_id
         AND assignment.membership_id=$7 AND assignment.active
    )
  ))
)`;
const visibleStatus = `(link.status='active' OR ($8::boolean AND link.status='detached'))`;

function queryWindow(limitInput?: string, offsetInput?: string): { limit: number; offset: number } {
  const limit = limitInput === undefined ? 50 : Number(limitInput);
  const offset = offsetInput === undefined ? 0 : Number(offsetInput);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
    throw new BadRequestException("Use limit 1–100 and offset 0–100000.");
  return { limit, offset };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function operatingSource(row: OperatingRow): JobOperatingSource & { jobId: string } {
  const raw = record(row.details);
  const controls = record(raw.controls);
  const workPackages = list(raw.workPackages);
  const tasks = list(raw.tasks);
  const projectOwner = stringValue(controls.nextActionOwnerId)
    ?? stringValue(record(record(raw.initiation).baseline).projectOwnerId);
  const projectAction = stringValue(controls.nextAction);
  const projectDate = stringValue(controls.nextActionDate);
  const details = row.type === "project" ? {
    phase: stringValue(raw.phase),
    risk: stringValue(controls.risk),
    onHold: controls.onHold === true,
    holdReason: stringValue(controls.holdReason),
    targetDate: stringValue(controls.targetCompletion) ?? stringValue(controls.handoverDate),
    awaitingClient: tasks.some((item) => item.status === "awaiting_client"),
    awaitingClientReason: "Delivery is waiting for a client decision.",
    hasBlockedWork: workPackages.some((item) => ["blocked", "on_hold"].includes(String(item.status)))
      || tasks.some((item) => ["blocked", "on_hold"].includes(String(item.status))),
  } : raw;
  const ownerId = row.ownerMembershipId ?? (row.type === "project" ? projectOwner : null);
  const nextAction = row.nextActionTitle ? {
    title: row.nextActionTitle,
    dueAt: row.nextActionDueAt?.toISOString() ?? null,
    reason: row.nextActionReason ?? "Source next action",
  } : projectAction ? {
    title: projectAction,
    dueAt: projectDate,
    reason: "Project control next action",
  } : null;
  return {
    jobId: row.jobId,
    type: row.type,
    id: row.id,
    caseId: row.caseId,
    version: Number(row.sourceVersion),
    status: row.sourceStatus,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    owner: ownerId ? { membershipId: ownerId, name: row.ownerName } : null,
    nextAction,
    details,
  };
}

function manualStage(row: ManualStageRow | undefined): JobManualStage | null {
  return row ? {
    phase: row.phase,
    stage: row.stage,
    reason: row.reason,
    setBy: row.setBy,
    setByName: row.setByName,
    setAt: row.setAt.toISOString(),
    version: Number(row.version),
  } : null;
}

@Injectable()
export class JobsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  private async scope(client: PoolClient, workspaceId: string, userId: string): Promise<PermissionScope> {
    const membership = await client.query<{ id: string }>(
      `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
      [workspaceId, userId],
    );
    if (!membership.rows[0]) throw new NotFoundException("Workspace not found.");
    const leads = await this.access.hasPermission(client, workspaceId, userId, "crm.leads.view");
    const opportunities = await this.access.hasPermission(client, workspaceId, userId, "crm.opportunities.view");
    const cases = await this.access.hasPermission(client, workspaceId, userId, "pre_projects.view");
    const manageProjects = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    const projects = manageProjects || await this.access.hasPermission(client, workspaceId, userId, "projects.view");
    const canRepair = await this.access.hasPermission(client, workspaceId, userId, "jobs.repair");
    const canStage = await this.access.hasPermission(client, workspaceId, userId, "jobs.stage.manage");
    return { leads, opportunities, cases, projects, manageProjects, canRepair, canStage, membershipId: membership.rows[0].id };
  }

  private params(workspaceId: string, scope: PermissionScope): unknown[] {
    return [workspaceId, scope.leads, scope.opportunities, scope.cases, scope.projects,
      scope.manageProjects, scope.membershipId, scope.canRepair];
  }

  private async facts(client: PoolClient, workspaceId: string, scope: PermissionScope, jobIds: string[]): Promise<FactRow[]> {
    if (!jobIds.length) return [];
    const result = await client.query<FactRow>(
      `SELECT link.job_id::text AS "jobId",link.record_type AS type,link.record_id AS id,
              link.case_id::text AS "caseId",
              link.status,link.version,
              CASE link.record_type
                WHEN 'enquiry' THEN enquiry.title
                WHEN 'lead' THEN lead_enquiry.title
                WHEN 'opportunity' THEN opportunity.title
                WHEN 'case' THEN case_opportunity.title
                WHEN 'quote' THEN CASE WHEN (
                  SELECT count(*) FROM commercial_cases commercial
                  CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(commercial.content->'quotes')='array'
                      THEN commercial.content->'quotes' ELSE '[]'::jsonb END
                  ) quote
                  WHERE commercial.workspace_id=link.workspace_id AND commercial.case_id=link.case_id
                    AND quote->>'id'=link.record_id
                )=1 THEN case_opportunity.title END
                WHEN 'project' THEN project.name
              END AS title,
              party.id::text AS "partyId",party.display_name AS "customerName"
         FROM job_identity_links link
         LEFT JOIN crm_enquiries enquiry ON link.record_type='enquiry'
           AND enquiry.workspace_id=link.workspace_id AND enquiry.id::text=link.record_id
         LEFT JOIN crm_leads lead ON link.record_type='lead'
           AND lead.workspace_id=link.workspace_id AND lead.id::text=link.record_id
         LEFT JOIN crm_enquiries lead_enquiry ON lead_enquiry.workspace_id=lead.workspace_id
           AND lead_enquiry.id=lead.enquiry_id
         LEFT JOIN crm_opportunities opportunity ON link.record_type='opportunity'
           AND opportunity.workspace_id=link.workspace_id AND opportunity.id::text=link.record_id
         LEFT JOIN pre_project_cases case_record ON link.record_type IN ('case','quote')
           AND case_record.workspace_id=link.workspace_id
           AND ((link.record_type='case' AND case_record.id::text=link.record_id)
             OR (link.record_type='quote' AND case_record.id=link.case_id))
         LEFT JOIN crm_opportunities case_opportunity ON case_opportunity.workspace_id=case_record.workspace_id
           AND case_opportunity.id=case_record.opportunity_id
         LEFT JOIN delivery_projects project ON link.record_type='project'
           AND project.workspace_id=link.workspace_id AND project.id::text=link.record_id
         LEFT JOIN pre_project_cases project_case ON project_case.workspace_id=project.workspace_id
           AND project_case.id=project.case_id
         LEFT JOIN crm_opportunities project_opportunity ON project_opportunity.workspace_id=project_case.workspace_id
           AND project_opportunity.id=project_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id=link.workspace_id AND party.id=COALESCE(
           enquiry.party_id,lead.party_id,opportunity.party_id,case_opportunity.party_id,project_opportunity.party_id)
        WHERE link.workspace_id=$1 AND ${visibleStatus} AND ${visibleLink}
          AND link.job_id=ANY($9::uuid[])
        ORDER BY link.attached_at,link.id`,
      [...this.params(workspaceId, scope), jobIds],
    );
    return result.rows;
  }

  private async operatingSources(
    client: PoolClient,
    workspaceId: string,
    scope: PermissionScope,
    jobIds: string[],
  ): Promise<Array<JobOperatingSource & { jobId: string }>> {
    if (!jobIds.length) return [];
    const result = await client.query<OperatingRow>(
      `SELECT link.job_id::text AS "jobId",link.record_type AS type,link.record_id AS id,
              link.case_id::text AS "caseId",
              CASE link.record_type
                WHEN 'enquiry' THEN enquiry.version
                WHEN 'lead' THEN lead.version
                WHEN 'opportunity' THEN opportunity.version
                WHEN 'case' THEN case_record.version
                WHEN 'quote' THEN COALESCE(commercial.revision,link.version)
                WHEN 'project' THEN COALESCE(execution.revision,project.version)
              END::int AS "sourceVersion",
              CASE link.record_type
                WHEN 'enquiry' THEN enquiry.status::text
                WHEN 'lead' THEN lead.status::text
                WHEN 'opportunity' THEN opportunity.status::text
                WHEN 'case' THEN case_record.status
                WHEN 'quote' THEN quote_data.data->>'status'
                WHEN 'project' THEN project.status
              END AS "sourceStatus",
              CASE link.record_type
                WHEN 'enquiry' THEN enquiry.created_at
                WHEN 'lead' THEN lead.created_at
                WHEN 'opportunity' THEN opportunity.created_at
                WHEN 'case' THEN case_record.created_at
                WHEN 'quote' THEN commercial.updated_at
                WHEN 'project' THEN project.created_at
              END AS "createdAt",
              CASE link.record_type
                WHEN 'enquiry' THEN enquiry.updated_at
                WHEN 'lead' THEN lead.updated_at
                WHEN 'opportunity' THEN opportunity.updated_at
                WHEN 'case' THEN case_record.updated_at
                WHEN 'quote' THEN commercial.updated_at
                WHEN 'project' THEN execution.updated_at
              END AS "updatedAt",
              source_owner.id::text AS "ownerMembershipId",owner_account.display_name AS "ownerName",
              activity.title AS "nextActionTitle",activity.due_at AS "nextActionDueAt",
              COALESCE(activity.description,'CRM next action') AS "nextActionReason",
              CASE link.record_type
                WHEN 'enquiry' THEN jsonb_build_object('targetDate',NULL)
                WHEN 'lead' THEN jsonb_build_object(
                  'pausedReason',lead.paused_reason,'priority',lead.priority,'targetDate',lead.next_action_at)
                WHEN 'opportunity' THEN jsonb_build_object(
                  'pausedReason',opportunity.paused_reason,'targetDate',opportunity.expected_close_at)
                WHEN 'case' THEN jsonb_build_object(
                  'phase',case_record.phase,'risk',case_record.risk_level,
                  'holdReason',case_record.hold_reason,'targetDate',case_record.target_date)
                WHEN 'quote' THEN COALESCE(quote_data.data,'{}'::jsonb)
                WHEN 'project' THEN jsonb_build_object(
                  'phase',execution.content->>'phase','controls',COALESCE(execution.content->'controls','{}'::jsonb),
                  'workPackages',COALESCE(execution.content->'workPackages','[]'::jsonb),
                  'tasks',COALESCE(execution.content->'tasks','[]'::jsonb),
                  'initiation',COALESCE(execution.content->'initiation','{}'::jsonb))
              END AS details
         FROM job_identity_links link
         LEFT JOIN crm_enquiries enquiry ON link.record_type='enquiry'
           AND enquiry.workspace_id=link.workspace_id AND enquiry.id::text=link.record_id
         LEFT JOIN crm_leads lead ON link.record_type='lead'
           AND lead.workspace_id=link.workspace_id AND lead.id::text=link.record_id
         LEFT JOIN crm_opportunities opportunity ON link.record_type='opportunity'
           AND opportunity.workspace_id=link.workspace_id AND opportunity.id::text=link.record_id
         LEFT JOIN pre_project_cases case_record ON link.record_type IN ('case','quote')
           AND case_record.workspace_id=link.workspace_id
           AND ((link.record_type='case' AND case_record.id::text=link.record_id)
             OR (link.record_type='quote' AND case_record.id=link.case_id))
         LEFT JOIN commercial_cases commercial ON commercial.workspace_id=link.workspace_id
           AND commercial.case_id=case_record.id
         LEFT JOIN LATERAL (
           SELECT quote.value AS data
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(commercial.content->'quotes')='array'
               THEN commercial.content->'quotes' ELSE '[]'::jsonb END) quote(value)
            WHERE quote.value->>'id'=link.record_id LIMIT 1
         ) quote_data ON link.record_type='quote'
         LEFT JOIN delivery_projects project ON link.record_type='project'
           AND project.workspace_id=link.workspace_id AND project.id::text=link.record_id
         LEFT JOIN project_execution execution ON execution.workspace_id=project.workspace_id
           AND execution.project_id=project.id
         LEFT JOIN LATERAL (
           SELECT candidate.id,candidate.title,candidate.description,candidate.due_at,candidate.owner_membership_id
             FROM crm_activities candidate
            WHERE candidate.workspace_id=link.workspace_id AND candidate.status='pending'
              AND candidate.is_next_action
              AND ((link.record_type='lead' AND candidate.lead_id=lead.id)
                OR (link.record_type='opportunity' AND candidate.opportunity_id=opportunity.id))
            ORDER BY candidate.due_at NULLS LAST,candidate.created_at,candidate.id LIMIT 1
         ) activity ON link.record_type IN ('lead','opportunity')
         LEFT JOIN workspace_memberships source_owner ON source_owner.workspace_id=link.workspace_id
           AND source_owner.id::text=COALESCE(
             activity.owner_membership_id::text,lead.owner_membership_id::text,
             opportunity.owner_membership_id::text,case_record.owner_membership_id::text,
             execution.content#>>'{controls,nextActionOwnerId}',
             execution.content#>>'{initiation,baseline,projectOwnerId}')
         LEFT JOIN users owner_account ON owner_account.id=source_owner.user_id
        WHERE link.workspace_id=$1 AND link.status='active' AND $8::boolean IS NOT NULL AND ${visibleLink}
          AND link.job_id=ANY($9::uuid[])
        ORDER BY link.attached_at,link.id`,
      [...this.params(workspaceId, scope), jobIds],
    );
    return result.rows.map(operatingSource);
  }

  private async hiddenSourceCounts(
    client: PoolClient,
    workspaceId: string,
    scope: PermissionScope,
    jobIds: string[],
  ): Promise<Map<string, number>> {
    if (!jobIds.length) return new Map();
    const result = await client.query<{ jobId: string; total: number }>(
      `SELECT link.job_id::text AS "jobId",count(*)::int AS total
         FROM job_identity_links link
        WHERE link.workspace_id=$1 AND link.status='active' AND $8::boolean IS NOT NULL AND NOT ${visibleLink}
          AND link.job_id=ANY($9::uuid[])
        GROUP BY link.job_id`,
      [...this.params(workspaceId, scope), jobIds],
    );
    return new Map(result.rows.map((row) => [row.jobId, Number(row.total)]));
  }

  private async manualStages(
    client: PoolClient,
    workspaceId: string,
    jobIds: string[],
  ): Promise<Map<string, JobManualStage>> {
    if (!jobIds.length) return new Map();
    const result = await client.query<ManualStageRow>(
      `SELECT stage.job_id::text AS "jobId",stage.phase,stage.stage,stage.reason,
              stage.set_by::text AS "setBy",account.display_name AS "setByName",
              stage.set_at AS "setAt",stage.version
         FROM job_manual_stages stage
         LEFT JOIN users account ON account.id=stage.set_by
        WHERE stage.workspace_id=$1 AND stage.job_id=ANY($2::uuid[])`,
      [workspaceId, jobIds],
    );
    return new Map(result.rows.map((row) => [row.jobId, manualStage(row)!]));
  }

  private async timeline(
    client: PoolClient,
    workspaceId: string,
    scope: PermissionScope,
    jobId: string,
  ): Promise<JobTimelineEvent[]> {
    type TimelineRow = {
      id: string; kind: JobTimelineEvent["kind"]; title: string; detail: string | null;
      occurredAt: Date; recordedAt: Date; actorId: string | null; actorName: string | null;
      sourceType: string | null; sourceId: string | null; sourceVersion: number | null;
    };
    const params = [...this.params(workspaceId, scope), jobId];
    const links = await client.query<TimelineRow>(
        `SELECT event.id::text,'source_link'::text AS kind,
                CASE event.event_type WHEN 'attached' THEN 'Source connected'
                  WHEN 'reattached' THEN 'Source reconnected' ELSE 'Source detached' END AS title,
                event.reason AS detail,event.occurred_at AS "occurredAt",
                event.occurred_at AS "recordedAt",event.actor_user_id::text AS "actorId",
                account.display_name AS "actorName",link.record_type AS "sourceType",
                link.record_id AS "sourceId",event.link_version::int AS "sourceVersion"
           FROM job_identity_link_events event
           JOIN job_identity_links link ON link.workspace_id=event.workspace_id AND link.id=event.link_id
           LEFT JOIN users account ON account.id=event.actor_user_id
          WHERE event.workspace_id=$1 AND event.job_id=$9 AND $8::boolean IS NOT NULL AND ${visibleLink}`,
        params,
      );
    const audits = await client.query<TimelineRow>(
        `SELECT DISTINCT ON (audit.id) audit.id::text,'source_event'::text AS kind,
                replace(initcap(replace(audit.action,'_',' ')),'Crm ','') AS title,
                NULL::text AS detail,audit.occurred_at AS "occurredAt",
                audit.occurred_at AS "recordedAt",audit.actor_user_id::text AS "actorId",
                account.display_name AS "actorName",link.record_type AS "sourceType",
                link.record_id AS "sourceId",
                CASE WHEN COALESCE(audit.after->>'version','') ~ '^[0-9]+$'
                  THEN (audit.after->>'version')::int ELSE link.version END AS "sourceVersion"
           FROM audit_events audit
           JOIN job_identity_links link ON link.workspace_id=audit.workspace_id
             AND link.job_id=$9 AND link.record_id=audit.entity_id::text
           LEFT JOIN users account ON account.id=audit.actor_user_id
          WHERE audit.workspace_id=$1 AND link.status='active' AND $8::boolean IS NOT NULL AND ${visibleLink}
          ORDER BY audit.id,link.attached_at DESC`,
        params,
      );
    const stages = await client.query<TimelineRow>(
        `SELECT event.id::text,'stage'::text AS kind,'Stage set to ' || event.stage AS title,
                event.reason AS detail,event.occurred_at AS "occurredAt",
                event.occurred_at AS "recordedAt",event.actor_user_id::text AS "actorId",
                account.display_name AS "actorName",NULL::text AS "sourceType",
                NULL::text AS "sourceId",NULL::int AS "sourceVersion"
           FROM job_manual_stage_events event
           LEFT JOIN users account ON account.id=event.actor_user_id
          WHERE event.workspace_id=$1 AND event.job_id=$2`,
        [workspaceId, jobId],
      );
    return [...links.rows, ...audits.rows, ...stages.rows]
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 200)
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        detail: row.detail,
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.recordedAt.toISOString(),
        actor: row.actorId ? { id: row.actorId, name: row.actorName } : null,
        source: row.sourceType && row.sourceId && row.sourceVersion
          ? { type: row.sourceType, id: row.sourceId, version: Number(row.sourceVersion) }
          : null,
      }));
  }

  private project(
    identity: IdentityRow,
    facts: FactRow[],
    sources: JobOperatingSource[],
    hiddenSourceCount: number,
    stage: JobManualStage | null,
  ): JobIdentityProjection {
    const priority: Record<JobSourceType, number> = {
      enquiry: 1, lead: 2, opportunity: 3, quote: 4, case: 5, project: 6,
    };
    const best = [...facts].filter((fact) => fact.title).sort((a, b) => priority[b.type] - priority[a.type])[0];
    const customerFact = best?.partyId && best.customerName
      ? best : facts.find((fact) => fact.partyId && fact.customerName);
    const links: JobSourceLink[] = facts.map((fact) => ({
      type: fact.type,
      id: fact.id,
      caseId: fact.caseId,
      status: fact.status,
      version: fact.version,
      sourceState: fact.status === "detached" ? "detached" : fact.title ? "available" : "missing",
    }));
    return {
      jobId: identity.id,
      reference: identity.reference,
      createdAt: identity.createdAt.toISOString(),
      title: best?.title ?? null,
      customer: customerFact?.partyId && customerFact.customerName
        ? { id: customerFact.partyId, name: customerFact.customerName } : null,
      links,
      missingSourceCount: links.filter((link) => link.sourceState === "missing").length,
      repairableLinkCount: links.filter((link) => link.status === "detached").length,
      ...deriveJobOperatingState({ sources, hiddenSourceCount, manualStage: stage }),
    };
  }

  list(actor: RequestActor, workspaceId: string, limitInput?: string, offsetInput?: string): Promise<JobIdentityList> {
    const { limit, offset } = queryWindow(limitInput, offsetInput);
    return this.access.withAnyPermission(actor, workspaceId, readablePermissions, async (client, user) => {
      const scope = await this.scope(client, workspaceId, user.userId);
      const params = this.params(workspaceId, scope);
      const matching = `identity.workspace_id=$1 AND EXISTS (
        SELECT 1 FROM job_identity_links link WHERE link.workspace_id=identity.workspace_id
          AND link.job_id=identity.id AND ${visibleStatus} AND ${visibleLink}
      )`;
      const total = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM job_identities identity WHERE ${matching}`, params,
      );
      const identities = await client.query<IdentityRow>(
        `SELECT identity.id::text,identity.reference,identity.created_at AS "createdAt"
         FROM job_identities identity WHERE ${matching}
         ORDER BY identity.created_at DESC,identity.id DESC LIMIT $9 OFFSET $10`,
        [...params, limit, offset],
      );
      const ids = identities.rows.map((item) => item.id);
      const facts = await this.facts(client, workspaceId, scope, ids);
      const sources = await this.operatingSources(client, workspaceId, scope, ids);
      const hidden = await this.hiddenSourceCounts(client, workspaceId, scope, ids);
      const stages = await this.manualStages(client, workspaceId, ids);
      return {
        items: identities.rows.map((item) => this.project(
          item,
          facts.filter((fact) => fact.jobId === item.id),
          sources.filter((source) => source.jobId === item.id),
          hidden.get(item.id) ?? 0,
          stages.get(item.id) ?? null,
        )),
        total: total.rows[0]?.total ?? 0,
        limit, offset,
      };
    });
  }

  get(actor: RequestActor, workspaceId: string, jobId: string): Promise<JobDetailProjection> {
    return this.access.withAnyPermission(actor, workspaceId, readablePermissions, async (client, user) => {
      const scope = await this.scope(client, workspaceId, user.userId);
      const result = await client.query<IdentityRow>(
        `SELECT identity.id::text,identity.reference,identity.created_at AS "createdAt"
         FROM job_identities identity WHERE identity.workspace_id=$1 AND identity.id=$9
         AND EXISTS (SELECT 1 FROM job_identity_links link WHERE link.workspace_id=identity.workspace_id
           AND link.job_id=identity.id AND ${visibleStatus} AND ${visibleLink})`,
        [...this.params(workspaceId, scope), jobId],
      );
      if (!result.rows[0]) throw new NotFoundException("Job not found.");
      const facts = await this.facts(client, workspaceId, scope, [jobId]);
      const sources = await this.operatingSources(client, workspaceId, scope, [jobId]);
      const hidden = await this.hiddenSourceCounts(client, workspaceId, scope, [jobId]);
      const stages = await this.manualStages(client, workspaceId, [jobId]);
      const timeline = await this.timeline(client, workspaceId, scope, jobId);
      const projection = this.project(result.rows[0], facts, sources, hidden.get(jobId) ?? 0, stages.get(jobId) ?? null);
      const communications = await this.access.hasPermission(client, workspaceId, user.userId, "crm.communications.view");
      const activities = await this.access.hasPermission(client, workspaceId, user.userId, "crm.activities.view");
      const caseIds = projection.links
        .filter((link) => link.type === "case" && link.status === "active" && link.sourceState === "available")
        .map((link) => link.id);
      const clientTimeline = projection.customer && (communications || activities)
        ? await queryClientTimeline(client, {
          workspaceId,
          partyId: projection.customer.id,
          caseIds,
          includeMessages: communications,
          includeActivities: activities,
        })
        : [];
      return {
        ...projection,
        timeline,
        clientTimeline,
        clientTimelineAccess: { communications, activities },
      };
    });
  }

  setStage(actor: RequestActor, workspaceId: string, jobId: string, input: SetJobStageDto) {
    return this.access.withPermission(actor, workspaceId, "jobs.stage.manage", async (client, user) => {
      const scope = await this.scope(client, workspaceId, user.userId);
      const visible = await client.query(
        `SELECT 1 FROM job_identities identity WHERE identity.workspace_id=$1 AND identity.id=$9
          AND EXISTS (SELECT 1 FROM job_identity_links link
            WHERE link.workspace_id=identity.workspace_id AND link.job_id=identity.id
              AND link.status='active' AND $8::boolean IS NOT NULL AND ${visibleLink})`,
        [...this.params(workspaceId, scope), jobId],
      );
      if (!visible.rowCount) throw new NotFoundException("Job not found.");

      const stage = input.stage.trim();
      const reason = input.reason.trim();
      if (!stage) throw new BadRequestException("Enter a stage name.");
      if (reason.length < 8) throw new BadRequestException("Explain why the stage is being set.");
      const requestHash = createHash("sha256").update(JSON.stringify({
        jobId, stage, reason, expectedVersion: input.expectedVersion,
      })).digest("hex");
      const replay = await client.query<{
        requestHash: string; phase: JobManualStage["phase"]; stage: string;
        reason: string; version: number; occurredAt: Date;
      }>(
        `SELECT request_hash AS "requestHash",phase,stage,reason,
                stage_version AS version,occurred_at AS "occurredAt"
           FROM job_manual_stage_events WHERE workspace_id=$1 AND request_id=$2`,
        [workspaceId, input.requestId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].requestHash !== requestHash)
          throw new ConflictException("This stage request identifier was already used for another change.");
        return { jobId, ...replay.rows[0], occurredAt: replay.rows[0].occurredAt.toISOString(), replayed: true };
      }

      const sources = await this.operatingSources(client, workspaceId, scope, [jobId]);
      const hidden = await this.hiddenSourceCounts(client, workspaceId, scope, [jobId]);
      const operating = deriveJobOperatingState({ sources, hiddenSourceCount: hidden.get(jobId) ?? 0 });
      if (operating.phase === "unknown")
        throw new ConflictException("The current Job phase is not visible; request source access before setting its stage.");

      const current = await client.query<{ version: number }>(
        `SELECT version FROM job_manual_stages WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE`,
        [workspaceId, jobId],
      );
      const currentVersion = Number(current.rows[0]?.version ?? 0);
      if (currentVersion !== input.expectedVersion)
        throw new ConflictException("The Job stage changed; refresh before saving.");
      const nextVersion = currentVersion + 1;
      await client.query(
        `INSERT INTO job_manual_stages
           (workspace_id,job_id,phase,stage,reason,set_by,set_at,version)
         VALUES($1,$2,$3,$4,$5,$6,now(),$7)
         ON CONFLICT(workspace_id,job_id) DO UPDATE SET
           phase=EXCLUDED.phase,stage=EXCLUDED.stage,reason=EXCLUDED.reason,
           set_by=EXCLUDED.set_by,set_at=EXCLUDED.set_at,version=EXCLUDED.version
         WHERE job_manual_stages.version=$8`,
        [workspaceId, jobId, operating.phase, stage, reason, user.userId, nextVersion, currentVersion],
      );
      await client.query(
        `INSERT INTO job_manual_stage_events
           (workspace_id,job_id,request_id,request_hash,stage_version,phase,stage,reason,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [workspaceId, jobId, input.requestId, requestHash, nextVersion, operating.phase, stage, reason, user.userId],
      );
      return {
        jobId,
        phase: operating.phase,
        stage,
        reason,
        version: nextVersion,
        replayed: false,
      };
    });
  }

  tree(actor: RequestActor, workspaceId: string, jobId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      const visible = await client.query(
        `SELECT 1 FROM job_identity_links
          WHERE workspace_id=$1 AND job_id=$2 AND record_type='case' AND status='active' LIMIT 1`,
        [workspaceId, jobId],
      );
      if (!visible.rowCount) throw new NotFoundException("Job tree not found.");
      const result = await client.query<OneTreeRow>(
        `SELECT node.id::text,node.kind,node.parent_id::text AS "parentId",node.case_id::text AS "caseId",
                node.source_type AS "sourceType",node.source_id::text AS "sourceId",
                revision.source_version AS "sourceVersion",node.status,node.version AS "identityVersion",
                revision.revision,revision.label,revision.snapshot,
                node.replaces_node_id::text AS "replacesNodeId",node.created_at AS "createdAt",
                node.archived_at AS "archivedAt"
           FROM one_tree_nodes node
           JOIN LATERAL (
             SELECT source_version,revision,label,snapshot
               FROM one_tree_node_revisions candidate
              WHERE candidate.workspace_id=node.workspace_id AND candidate.node_id=node.id
              ORDER BY revision DESC LIMIT 1
           ) revision ON true
          WHERE node.workspace_id=$1 AND node.job_id=$2
          ORDER BY CASE node.kind WHEN 'site' THEN 1 WHEN 'room' THEN 2 WHEN 'zone' THEN 3 ELSE 4 END,
                   revision.label,node.id`,
        [workspaceId, jobId],
      );
      const nodes = result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        parentId: row.parentId,
        caseId: row.caseId,
        source: { type: row.sourceType, id: row.sourceId, version: row.sourceVersion },
        status: row.status,
        identityVersion: row.identityVersion,
        revision: row.revision,
        label: row.label,
        snapshot: row.snapshot,
        replacesNodeId: row.replacesNodeId,
        createdAt: row.createdAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
      }));
      const counts: Record<OneTreeKind, number> = { site: 0, room: 0, zone: 0, item: 0 };
      for (const node of nodes) if (node.status === "active") counts[node.kind] += 1;
      return { schemaVersion: 1 as const, jobId, generatedAt: new Date().toISOString(), nodes, counts };
    });
  }

  repair(actor: RequestActor, workspaceId: string, jobId: string, input: RepairJobLinkDto) {
    return this.access.withPermission(actor, workspaceId, "jobs.repair", async (client, user) => {
      if (input.recordType === "quote" && !input.caseId)
        throw new BadRequestException("A quote link needs its case ID.");
      if (input.recordType !== "quote" && input.caseId)
        throw new BadRequestException("Only a quote link may have a case ID.");
      if (input.recordType !== "quote" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.recordId))
        throw new BadRequestException("The source record ID must be a UUID.");
      const reason = input.reason.trim();
      if (reason.length < 8) throw new BadRequestException("Give a specific repair reason.");
      const viewPermission = input.recordType === "enquiry" || input.recordType === "lead"
        ? "crm.leads.view"
        : input.recordType === "opportunity" ? "crm.opportunities.view"
          : input.recordType === "case" || input.recordType === "quote" ? "pre_projects.view" : "projects.view";
      const canView = await this.access.hasPermission(client, workspaceId, user.userId, viewPermission);
      if (input.recordType === "project") {
        const canManage = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
        if (!canManage) {
          if (!canView) throw new ForbiddenException("Project access is required to repair this link.");
          const assigned = await client.query(
            `SELECT 1 FROM project_assignments assignment
              JOIN workspace_memberships membership ON membership.workspace_id=assignment.workspace_id
                AND membership.id=assignment.membership_id
             WHERE assignment.workspace_id=$1 AND assignment.project_id=$2
               AND membership.user_id=$3 AND membership.status='active' AND assignment.active LIMIT 1`,
            [workspaceId, input.recordId, user.userId],
          );
          if (!assigned.rowCount) throw new ForbiddenException("Project access is required to repair this link.");
        }
      } else if (!canView) throw new ForbiddenException("Source access is required to repair this link.");
      return repairJobSourceLink(
        client, workspaceId, jobId,
        { type: input.recordType, id: input.recordId, caseId: input.caseId },
        user.userId, input.expectedVersion, input.requestId, reason,
      );
    });
  }
}
