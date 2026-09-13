import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmLeadsService } from "../leads/crm-leads.service";
import { CrmNotificationsService } from "../notifications/crm-notifications.service";
import { validateAutomationDefinition } from "./automation-definition.validator";
import { AdvanceAutomationRunDto, ApprovalDecisionDto, AutomationVersionDto, ClaimWorkspaceDto, CompleteAutomationWaitDto, CreateAutomationDto, ExecuteAutomationStepDto, StartAutomationRunDto, UpdateAutomationDto } from "./dto/automations.dto";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Row = Record<string, unknown>;
@Injectable()
export class CrmAutomationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly leads: CrmLeadsService,
    private readonly notifications: CrmNotificationsService,
  ) {}
  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.view", async (client) => (await client.query(`SELECT definition.id, definition.code, definition.name, definition.description, definition.status, definition.active_version_id AS "activeVersionId", definition.run_once_per_aggregate AS "runOncePerAggregate", definition.version, version.version_number AS "activeVersionNumber" FROM automation_definitions definition LEFT JOIN automation_versions version ON version.id = definition.active_version_id WHERE definition.workspace_id = $1 ORDER BY definition.name`, [workspaceId])).rows);
  }
  create(actor: RequestActor, workspaceId: string, input: CreateAutomationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.manage", async (client, actorUser) => {
      this.assertValid(input.definition);
      const created = await client.query(`INSERT INTO automation_definitions (workspace_id, code, name, description, run_once_per_aggregate, created_by) VALUES ($1,lower($2),$3,$4,$5,$6) RETURNING id, code, name, description, status, run_once_per_aggregate AS "runOncePerAggregate", version`, [workspaceId, input.code, input.name, input.description ?? null, input.runOncePerAggregate ?? false, actorUser.userId]);
      const record = created.rows[0] as Row;
      const version = await this.insertVersion(client, workspaceId, String(record.id), 1, input.definition);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "automation.definition.created.v1", entityType: "automation_definition", entityId: String(record.id), after: { ...record, draftVersion: version } });
      return { ...record, draftVersion: version };
    });
  }
  get(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.view", async (client) => {
      const result = await client.query(`SELECT d.id,d.code,d.name,d.description,d.status,d.version,d.run_once_per_aggregate AS "runOncePerAggregate",d.active_version_id AS "activeVersionId",published.version_number AS "activeVersionNumber",latest.version_number AS "draftVersionNumber",latest.definition FROM automation_definitions d LEFT JOIN automation_versions published ON published.id=d.active_version_id LEFT JOIN LATERAL (SELECT version_number,definition FROM automation_versions WHERE workspace_id=d.workspace_id AND definition_id=d.id ORDER BY version_number DESC LIMIT 1) latest ON true WHERE d.workspace_id=$1 AND d.id=$2`, [workspaceId,id]);
      if (!result.rowCount) throw new NotFoundException("Automation not found");
      const row = result.rows[0];
      return { ...row, validation: validateAutomationDefinition(row.definition ?? {}) };
    });
  }
  update(actor: RequestActor, workspaceId: string, id: string, input: UpdateAutomationDto) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.manage", async (client, actorUser) => {
      this.assertValid(input.definition);
      const current = await client.query<Row>(`SELECT * FROM automation_definitions WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
      if (!current.rowCount) throw new NotFoundException("Automation not found");
      if (Number(current.rows[0].version) !== input.version) throw new ConflictException("Automation changed; reload and try again");
      if (current.rows[0].status === "archived") throw new ConflictException("Archived automation cannot be edited");
      const nextNumber = await client.query<{ next: number }>(`SELECT COALESCE(max(version_number),0)::int + 1 AS next FROM automation_versions WHERE workspace_id = $1 AND definition_id = $2`, [workspaceId, id]);
      const version = await this.insertVersion(client, workspaceId, id, nextNumber.rows[0].next, input.definition);
      const result = await client.query(`UPDATE automation_definitions SET name=COALESCE($1,name), description=CASE WHEN $2::boolean THEN $3 ELSE description END, status='draft', version=version+1 WHERE workspace_id=$4 AND id=$5 AND version=$6 RETURNING id, code, name, description, status, active_version_id AS "activeVersionId", version`, [input.name ?? null, input.description !== undefined, input.description ?? null, workspaceId, id, input.version]);
      if (!result.rowCount) throw new ConflictException("Automation changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "automation.definition.updated.v1", entityType: "automation_definition", entityId: id, before: current.rows[0], after: result.rows[0] as Row });
      return { ...result.rows[0], draftVersion: version };
    });
  }
  validate(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.view", async (client) => {
      const version = await client.query<Row>(`SELECT version.id, version.version_number AS "versionNumber", version.definition FROM automation_versions version WHERE version.workspace_id=$1 AND version.definition_id=$2 ORDER BY version.version_number DESC LIMIT 1`, [workspaceId, id]);
      if (!version.rowCount) throw new NotFoundException("Automation not found");
      return { ...version.rows[0], ...validateAutomationDefinition(version.rows[0].definition as Record<string, unknown>) };
    });
  }
  dryRun(actor: RequestActor, workspaceId: string, id: string, context: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.view", async (client) => {
      const version = await client.query<Row>(`SELECT definition FROM automation_versions WHERE workspace_id=$1 AND definition_id=$2 ORDER BY version_number DESC LIMIT 1`, [workspaceId, id]);
      if (!version.rowCount) throw new NotFoundException("Automation not found");
      const validation = validateAutomationDefinition(version.rows[0].definition as Record<string, unknown>);
      return { ...validation, wouldMutate: false, context, plan: validation.valid ? this.executionPlan(version.rows[0].definition as Record<string, unknown>) : [] };
    });
  }
  publish(actor: RequestActor, workspaceId: string, id: string, input: AutomationVersionDto) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.publish", async (client, actorUser) => {
      const current = await client.query<Row>(`SELECT * FROM automation_definitions WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id]);
      if (!current.rowCount) throw new NotFoundException("Automation not found");
      if (Number(current.rows[0].version) !== input.version) throw new ConflictException("Automation changed; reload and try again");
      const version = await client.query<Row>(`SELECT * FROM automation_versions WHERE workspace_id=$1 AND definition_id=$2 ORDER BY version_number DESC LIMIT 1`, [workspaceId, id]);
      this.assertValid(version.rows[0]?.definition as Record<string, unknown>);
      await client.query(`UPDATE automation_versions SET published_at=now(), published_by=$1 WHERE id=$2`, [actorUser.userId, version.rows[0].id]);
      const result = await client.query(`UPDATE automation_definitions SET status='active',active_version_id=$1,version=version+1 WHERE workspace_id=$2 AND id=$3 AND version=$4 RETURNING id,code,name,status,active_version_id AS "activeVersionId",version`, [version.rows[0].id, workspaceId, id, input.version]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "automation.definition.published.v1", entityType: "automation_definition", entityId: id, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  pause(actor: RequestActor, workspaceId: string, id: string, input: AutomationVersionDto) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.publish", async (client, actorUser) => {
      const result = await client.query(`UPDATE automation_definitions SET status='paused',version=version+1 WHERE workspace_id=$1 AND id=$2 AND version=$3 RETURNING id,code,name,status,active_version_id AS "activeVersionId",version`, [workspaceId, id, input.version]);
      if (!result.rowCount) throw new ConflictException("Automation changed or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "automation.definition.paused.v1", entityType: "automation_definition", entityId: id, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  runs(actor: RequestActor, workspaceId: string, definitionId?: string) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.view", async (client) => (await client.query(`SELECT run.id,run.definition_id AS "definitionId",run.version_id AS "versionId",run.trigger_event_id AS "triggerEventId",run.aggregate_type AS "aggregateType",run.aggregate_id AS "aggregateId",run.status,run.context,run.current_step_key AS "currentStepKey",run.failure_code AS "failureCode",run.failure_message AS "failureMessage",run.created_at AS "createdAt",run.completed_at AS "completedAt",run.version FROM automation_runs run WHERE run.workspace_id=$1 AND ($2::uuid IS NULL OR run.definition_id=$2) ORDER BY run.created_at DESC LIMIT 200`, [workspaceId, definitionId ?? null])).rows);
  }
  approvals(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.publish", async (client) => (await client.query(`SELECT approval.id, approval.run_id AS "runId", approval.step_key AS "stepKey", approval.status, approval.proposed_action AS "proposedAction", approval.expires_at AS "expiresAt", approval.version, definition.name AS "workflowName" FROM automation_approvals approval JOIN automation_runs run ON run.id = approval.run_id AND run.workspace_id = approval.workspace_id JOIN automation_definitions definition ON definition.id = run.definition_id AND definition.workspace_id = run.workspace_id WHERE approval.workspace_id = $1 AND approval.status = 'pending' ORDER BY approval.id LIMIT 200`, [workspaceId])).rows);
  }
  decide(actor: RequestActor, workspaceId: string, approvalId: string, input: ApprovalDecisionDto) {
    return this.access.withPermission(actor, workspaceId, "crm.automations.publish", async (client, actorUser) => {
      const result = await client.query(`UPDATE automation_approvals SET status=$1,decision_reason=$2,decided_by=$3,decided_at=now(),version=version+1 WHERE workspace_id=$4 AND id=$5 AND status='pending' AND version=$6 AND (expires_at IS NULL OR expires_at > now()) RETURNING id,run_id AS "runId",step_key AS "stepKey",status,proposed_action AS "proposedAction",version`, [input.decision, input.reason ?? null, actorUser.userId, workspaceId, approvalId, input.version]);
      if (!result.rowCount) throw new ConflictException("Approval was already decided, expired, or changed");
      await client.query(`UPDATE automation_runs SET status='queued',version=version+1 WHERE workspace_id=$1 AND id=$2 AND status='approval_required'`, [workspaceId, result.rows[0].runId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "automation.approval.decided.v1", entityType: "automation_run", entityId: String(result.rows[0].runId), after: result.rows[0] as Row });
      return result.rows[0];
    });
  }
  startInternal(definitionId: string, input: StartAutomationRunDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const definition = await client.query<Row>(`SELECT id,active_version_id,run_once_per_aggregate FROM automation_definitions WHERE workspace_id=$1 AND id=$2 AND status='active'`, [input.workspaceId, definitionId]);
      if (!definition.rowCount || !definition.rows[0].active_version_id) throw new NotFoundException("Active automation not found");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.workspaceId}:automation:${definitionId}:${input.aggregateId}`]);
      if (definition.rows[0].run_once_per_aggregate) {
        const priorAggregateRun = await client.query(
          `SELECT id,status,version_id AS "versionId",version
           FROM automation_runs
           WHERE workspace_id=$1 AND definition_id=$2 AND aggregate_id=$3
           ORDER BY created_at LIMIT 1`,
          [input.workspaceId, definitionId, input.aggregateId],
        );
        if (priorAggregateRun.rowCount) return { ...priorAggregateRun.rows[0], idempotentReplay: true, replayReason: "run_once_per_aggregate" };
      }
      try {
        const result = await client.query(`INSERT INTO automation_runs (workspace_id,definition_id,version_id,trigger_event_id,aggregate_type,aggregate_id,context,correlation_id,causation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status,version_id AS "versionId",version`, [input.workspaceId, definitionId, definition.rows[0].active_version_id, input.triggerEventId, input.aggregateType, input.aggregateId, input.context ?? {}, input.correlationId, input.causationId ?? null]);
        return result.rows[0];
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          const prior = await client.query(`SELECT id,status,version_id AS "versionId",version FROM automation_runs WHERE workspace_id=$1 AND definition_id=$2 AND trigger_event_id=$3 AND aggregate_id=$4`, [input.workspaceId, definitionId, input.triggerEventId, input.aggregateId]);
          return { ...prior.rows[0], idempotentReplay: true };
        }
        throw error;
      }
    });
  }
  advanceInternal(runId: string, input: AdvanceAutomationRunDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const run = await client.query<Row>(`SELECT * FROM automation_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [input.workspaceId, runId]);
      if (!run.rowCount) throw new NotFoundException("Automation run not found");
      const existing = await client.query<Row>(`SELECT * FROM automation_step_runs WHERE workspace_id=$1 AND run_id=$2 AND step_key=$3 AND attempt=$4`, [input.workspaceId, runId, input.stepKey, input.attempt]);
      if (existing.rowCount && ["completed", "waiting", "approval_required"].includes(String(existing.rows[0].status))) return { ...existing.rows[0], idempotentReplay: true };
      const stepStatus = input.status === "step_completed" ? "completed" : input.status;
      const runStatus = input.status === "step_completed" ? "running" : input.status;
      await client.query(`INSERT INTO automation_step_runs (workspace_id,run_id,step_key,attempt,status,output,error,completed_at) VALUES ($1,$2,$3,$4,$5::varchar,$6,$7,CASE WHEN $5::text IN ('completed','failed','cancelled') THEN now() ELSE NULL END) ON CONFLICT (workspace_id,run_id,step_key,attempt) DO UPDATE SET status=EXCLUDED.status,output=EXCLUDED.output,error=EXCLUDED.error,completed_at=EXCLUDED.completed_at`, [input.workspaceId, runId, input.stepKey, input.attempt, stepStatus, input.output ?? null, input.failureMessage ? { code: input.failureCode, message: input.failureMessage } : null]);
      if (input.status === "waiting") {
        const due = input.dueAt ? new Date(input.dueAt) : null;
        if (!due || Number.isNaN(due.getTime())) throw new BadRequestException("waiting status requires a valid dueAt");
        await client.query(`INSERT INTO automation_waits (workspace_id,run_id,step_key,due_at) VALUES ($1,$2,$3,$4)`, [input.workspaceId, runId, input.stepKey, due]);
      }
      if (input.status === "approval_required") {
        if (!input.proposedAction) throw new UnprocessableEntityException("approval_required needs proposedAction");
        await client.query(`INSERT INTO automation_approvals (workspace_id,run_id,step_key,proposed_action,requested_from_membership_id) VALUES ($1,$2,$3,$4,$5)`, [input.workspaceId, runId, input.stepKey, input.proposedAction, input.requestedFromMembershipId ?? null]);
      }
      const result = await client.query(`UPDATE automation_runs SET status=$1::automation_run_status,current_step_key=$2,started_at=COALESCE(started_at,now()),completed_at=CASE WHEN $1 IN ('completed','failed','cancelled') THEN now() ELSE NULL END,failure_code=$3,failure_message=$4,version=version+1 WHERE workspace_id=$5 AND id=$6 RETURNING id,status,current_step_key AS "currentStepKey",version`, [runStatus, input.stepKey, input.failureCode ?? null, input.failureMessage ?? null, input.workspaceId, runId]);
      if (input.status === "failed") await this.events.record(client, { workspaceId: input.workspaceId, actorUserId: null, source: "automation", action: "automation.run_failed.v1", entityType: "automation_run", entityId: runId, after: { ...result.rows[0], failureCode: input.failureCode, failureMessage: input.failureMessage } });
      return result.rows[0];
    });
  }
  executeStepInternal(runId: string, input: ExecuteAutomationStepDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const runResult = await client.query<Row>(
        `SELECT run.*, version.definition
         FROM automation_runs run
         JOIN automation_versions version
           ON version.id = run.version_id AND version.workspace_id = run.workspace_id
         WHERE run.workspace_id = $1 AND run.id = $2
         FOR UPDATE OF run`,
        [input.workspaceId, runId],
      );
      if (!runResult.rowCount) throw new NotFoundException("Automation run not found");
      const run = runResult.rows[0];
      if (["completed", "failed", "cancelled"].includes(String(run.status))) {
        throw new ConflictException("A terminal automation run cannot execute another step");
      }
      const definition = run.definition as Record<string, unknown>;
      const nodes = Array.isArray(definition.nodes) ? definition.nodes as Row[] : [];
      const node = nodes.find((candidate) => candidate.key === input.stepKey);
      if (!node) throw new NotFoundException("Automation step does not exist in the published version");
      const allowed = new Set(["assign", "create_task", "update_record", "enroll_sequence", "stop_sequence", "send_template", "emit_webhook", "create_project_handoff"]);
      if (!allowed.has(String(node.type))) throw new UnprocessableEntityException("This step is orchestrated rather than executed as a Business Core command");
      const existing = await client.query<Row>(
        `SELECT id,status,output FROM automation_step_runs
         WHERE workspace_id=$1 AND run_id=$2 AND step_key=$3 AND attempt=$4`,
        [input.workspaceId, runId, input.stepKey, input.attempt],
      );
      if (existing.rows[0]?.status === "completed") return { ...existing.rows[0], idempotentReplay: true };
      await client.query(
        `INSERT INTO automation_step_runs (workspace_id,run_id,step_key,attempt,status,input)
         VALUES ($1,$2,$3,$4,'running',$5)
         ON CONFLICT (workspace_id,run_id,step_key,attempt)
         DO UPDATE SET status='running',error=NULL`,
        [input.workspaceId, runId, input.stepKey, input.attempt, { nodeType: node.type, configuration: node.configuration ?? {} }],
      );
      const configuration = this.resolveValue(node.configuration ?? {}, run) as Record<string, unknown>;
      const output = await this.executeAction(client, run, String(node.type), configuration, input.stepKey, input.attempt);
      const step = await client.query<Row>(
        `UPDATE automation_step_runs
         SET status='completed',output=$1,error=NULL,completed_at=now()
         WHERE workspace_id=$2 AND run_id=$3 AND step_key=$4 AND attempt=$5
         RETURNING id,status,output,completed_at AS "completedAt"`,
        [output, input.workspaceId, runId, input.stepKey, input.attempt],
      );
      await client.query(
        `UPDATE automation_runs
         SET status='running',current_step_key=$1,started_at=COALESCE(started_at,now()),version=version+1
         WHERE workspace_id=$2 AND id=$3`,
        [input.stepKey, input.workspaceId, runId],
      );
      return step.rows[0];
    });
  }
  claimWaitsInternal(input: ClaimWorkspaceDto) {
    const claimToken = randomUUID();
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query(`WITH due AS (SELECT id FROM automation_waits WHERE workspace_id=$1 AND due_at <= now() AND (status='waiting' OR (status='claimed' AND claimed_at < now() - interval '5 minutes')) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE automation_waits wait SET status='claimed',claimed_at=now(),claim_token=$3,version=version+1 FROM due WHERE wait.id=due.id RETURNING wait.id,wait.run_id AS "runId",wait.step_key AS "stepKey",wait.due_at AS "dueAt",wait.claim_token AS "claimToken",wait.version`, [input.workspaceId, Math.min(input.limit ?? 50, 100), claimToken]);
      return { claimToken, items: result.rows };
    });
  }
  completeWaitInternal(waitId: string, input: CompleteAutomationWaitDto) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<Row>(
        `UPDATE automation_waits
         SET status='completed',completed_at=now(),claim_token=NULL,version=version+1
         WHERE workspace_id=$1 AND id=$2 AND status='claimed' AND claim_token=$3
         RETURNING id,run_id AS "runId",step_key AS "stepKey",status,completed_at AS "completedAt",version`,
        [input.workspaceId, waitId, input.claimToken],
      );
      if (!result.rowCount) throw new ConflictException("Automation wait claim is stale or already completed");
      await client.query(`UPDATE automation_runs SET status='queued',version=version+1 WHERE workspace_id=$1 AND id=$2 AND status='waiting'`, [input.workspaceId, result.rows[0].runId]);
      return result.rows[0];
    });
  }
  matchingInternal(workspaceId: string, eventType: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<Row>(`SELECT automation.id,automation.run_once_per_aggregate AS "runOncePerAggregate",version.id AS "versionId",version.definition FROM automation_definitions automation JOIN automation_versions version ON version.id=automation.active_version_id AND version.workspace_id=automation.workspace_id WHERE automation.workspace_id=$1 AND automation.status='active'`, [workspaceId]);
      const items = result.rows.filter((row) => {
        const definition = row.definition as Record<string, unknown>;
        const nodes = Array.isArray(definition.nodes) ? definition.nodes as Row[] : [];
        const trigger = nodes.find((node) => node.type === "trigger");
        const configuration = trigger?.configuration && typeof trigger.configuration === "object" ? trigger.configuration as Row : {};
        const eventTypes = Array.isArray(configuration.eventTypes) ? configuration.eventTypes.map(String) : [];
        return eventTypes.includes(eventType) && eventType !== "automation.run_failed.v1";
      });
      return { items };
    });
  }
  runContextInternal(workspaceId: string, runId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const result = await client.query<Row>(`SELECT run.id,run.status,run.context,run.current_step_key AS "currentStepKey",run.version,version.definition FROM automation_runs run JOIN automation_versions version ON version.id=run.version_id AND version.workspace_id=run.workspace_id WHERE run.workspace_id=$1 AND run.id=$2`, [workspaceId, runId]);
      if (!result.rowCount) throw new NotFoundException("Automation run not found");
      return result.rows[0];
    });
  }
  async dueWorkspacesInternal() {
    const result = await this.database.query<{ workspace_id: string }>(`SELECT * FROM list_crm_workspaces_with_due_work()`);
    return { workspaceIds: result.rows.map((row) => row.workspace_id) };
  }
  private async executeAction(client: PoolClient, run: Row, nodeType: string, configuration: Record<string, unknown>, stepKey: string, attempt: number): Promise<Row> {
    const workspaceId = String(run.workspace_id);
    if (nodeType === "assign") {
      if (!["lead", "crm_lead"].includes(String(run.aggregate_type))) throw new UnprocessableEntityException("assign requires a lead aggregate");
      return this.leads.autoAssignForAutomation(client, workspaceId, String(run.aggregate_id));
    }
    if (nodeType === "create_task") return this.createTaskAction(client, run, configuration);
    if (nodeType === "update_record") return this.updateRecordAction(client, run, configuration);
    if (nodeType === "enroll_sequence") return this.enrollSequenceAction(client, run, configuration);
    if (nodeType === "stop_sequence") return this.stopSequenceAction(client, run, configuration);
    if (nodeType === "send_template" || nodeType === "emit_webhook") {
      return this.sendAction(client, run, configuration, stepKey, attempt, nodeType === "emit_webhook");
    }
    if (nodeType === "create_project_handoff") return this.projectHandoffAction(client, run, configuration);
    throw new UnprocessableEntityException(`Unsupported executable action: ${nodeType}`);
  }
  private async createTaskAction(client: PoolClient, run: Row, configuration: Record<string, unknown>): Promise<Row> {
    const title = String(configuration.title ?? "").trim();
    if (!title || title.length > 240) throw new UnprocessableEntityException("create_task requires a title of at most 240 characters");
    const type = String(configuration.type ?? "task");
    if (!["task", "call", "email", "meeting", "follow_up", "note"].includes(type)) throw new UnprocessableEntityException("create_task has an unsupported activity type");
    const target = this.aggregateTarget(run);
    let ownerId = configuration.ownerMembershipId ? String(configuration.ownerMembershipId) : null;
    if (!ownerId && target.entityType !== "activity") {
      const owner = await client.query<{ owner_membership_id: string | null }>(`SELECT owner_membership_id FROM ${target.table} WHERE workspace_id=$1 AND id=$2`, [run.workspace_id, run.aggregate_id]);
      ownerId = owner.rows[0]?.owner_membership_id ?? null;
    }
    if (ownerId) {
      const member = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id=$1 AND id=$2 AND status='active'`, [run.workspace_id, ownerId]);
      if (!member.rowCount) throw new UnprocessableEntityException("create_task owner is not an active workspace member");
    }
    const dueAt = this.actionDate(configuration.dueAt, configuration.delayMinutes, "create_task dueAt");
    if (target.entityType === "activity") throw new UnprocessableEntityException("create_task cannot use an activity as its parent aggregate");
    if (configuration.isNextAction === true) {
      await client.query(
        `UPDATE crm_activities SET is_next_action=false,version=version+1
         WHERE workspace_id=$1 AND ${target.column}=$2 AND status='pending' AND is_next_action`,
        [run.workspace_id, run.aggregate_id],
      );
    }
    const result = await client.query<Row>(
      `INSERT INTO crm_activities
        (workspace_id,${target.column},type,title,description,owner_membership_id,priority,due_at,is_next_action,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)
       RETURNING id,type,status,title,owner_membership_id AS "ownerMembershipId",due_at AS "dueAt",is_next_action AS "isNextAction",version`,
      [run.workspace_id, run.aggregate_id, type, title, configuration.description ?? null, ownerId, configuration.priority ?? "normal", dueAt, configuration.isNextAction === true],
    );
    await this.events.record(client, { workspaceId: String(run.workspace_id), actorUserId: null, source: "automation", action: "crm.activity.created.v1", entityType: "crm_activity", entityId: String(result.rows[0].id), correlationId: String(run.correlation_id), causationId: String(run.trigger_event_id), after: result.rows[0] });
    return result.rows[0];
  }
  private async updateRecordAction(client: PoolClient, run: Row, configuration: Record<string, unknown>): Promise<Row> {
    const entityType = String(configuration.entityType ?? "");
    const target = this.aggregateTarget(run);
    if (target.entityType !== entityType) throw new UnprocessableEntityException("update_record may only update its current aggregate");
    const fields = configuration.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new UnprocessableEntityException("update_record requires a fields object");
    const maps: Record<string, Record<string, string>> = {
      lead: { nextActionAt: "next_action_at" },
      opportunity: { nextActionAt: "next_action_at", expectedCloseAt: "expected_close_at", description: "description" },
      activity: { dueAt: "due_at", priority: "priority", title: "title", description: "description" },
    };
    const entries = Object.entries(fields as Record<string, unknown>);
    if (!entries.length || entries.some(([key]) => !maps[entityType]?.[key])) throw new UnprocessableEntityException("update_record contains no fields or an unsupported field");
    const values: unknown[] = [run.workspace_id, run.aggregate_id];
    const updates = entries.map(([key, value]) => {
      values.push(value);
      return `${maps[entityType][key]}=$${values.length}`;
    });
    const result = await client.query<Row>(
      `UPDATE ${target.table} SET ${updates.join(",")},version=version+1
       WHERE workspace_id=$1 AND id=$2 RETURNING id,version`,
      values,
    );
    if (!result.rowCount) throw new NotFoundException("Automation aggregate no longer exists");
    await this.events.record(client, { workspaceId: String(run.workspace_id), actorUserId: null, source: "automation", action: `crm.${entityType}.updated.v1`, entityType: `crm_${entityType}`, entityId: String(run.aggregate_id), correlationId: String(run.correlation_id), causationId: String(run.trigger_event_id), after: { ...result.rows[0], updatedFields: Object.keys(fields as object) } });
    return { ...result.rows[0], updatedFields: Object.keys(fields as object) };
  }
  private async enrollSequenceAction(client: PoolClient, run: Row, configuration: Record<string, unknown>): Promise<Row> {
    const sequenceId = this.uuid(configuration.sequenceId, "enroll_sequence sequenceId");
    const partyId = await this.aggregatePartyId(client, run);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${run.workspace_id}:sequence:${sequenceId}:${partyId}`]);
    const sequence = await client.query(`SELECT 1 FROM crm_sequences WHERE workspace_id=$1 AND id=$2 AND status='active'`, [run.workspace_id, sequenceId]);
    if (!sequence.rowCount) throw new UnprocessableEntityException("Sequence is not active");
    const prior = await client.query<Row>(`SELECT id,status,current_step AS "currentStep",next_run_at AS "nextRunAt",version FROM crm_sequence_enrollments WHERE workspace_id=$1 AND sequence_id=$2 AND party_id=$3 AND status='active' ORDER BY created_at DESC LIMIT 1`, [run.workspace_id, sequenceId, partyId]);
    if (prior.rowCount) return { ...prior.rows[0], alreadyEnrolled: true };
    const leadId = ["lead", "crm_lead"].includes(String(run.aggregate_type)) ? run.aggregate_id : null;
    const result = await client.query<Row>(`INSERT INTO crm_sequence_enrollments (workspace_id,sequence_id,party_id,lead_id,status,current_step,next_run_at) VALUES ($1,$2,$3,$4,'active',0,now()) RETURNING id,status,current_step AS "currentStep",next_run_at AS "nextRunAt",version`, [run.workspace_id, sequenceId, partyId, leadId]);
    return result.rows[0];
  }
  private async stopSequenceAction(client: PoolClient, run: Row, configuration: Record<string, unknown>): Promise<Row> {
    const partyId = await this.aggregatePartyId(client, run);
    const sequenceId = configuration.sequenceId ? this.uuid(configuration.sequenceId, "stop_sequence sequenceId") : null;
    const result = await client.query<Row>(`UPDATE crm_sequence_enrollments SET status='stopped',exit_reason=$1,exited_at=now(),version=version+1 WHERE workspace_id=$2 AND party_id=$3 AND status='active' AND ($4::uuid IS NULL OR sequence_id=$4) RETURNING id,sequence_id AS "sequenceId",status,version`, [configuration.reason ?? "automation", run.workspace_id, partyId, sequenceId]);
    return { stopped: result.rowCount ?? 0, enrollments: result.rows };
  }
  private async sendAction(client: PoolClient, run: Row, configuration: Record<string, unknown>, stepKey: string, attempt: number, webhook: boolean): Promise<Row> {
    const recipientType = String(configuration.recipientType ?? (webhook ? "integration" : "party"));
    if (!["party", "user", "integration"].includes(recipientType)) throw new UnprocessableEntityException("send action has an unsupported recipient type");
    const recipientId = configuration.recipientId
      ? this.uuid(configuration.recipientId, "send action recipientId")
      : webhook
        ? this.uuid(configuration.integrationId, "emit_webhook integrationId")
        : await this.aggregatePartyId(client, run);
    const channel = webhook ? "webhook" : String(configuration.channel ?? "");
    if (!["in_app", "email", "whatsapp", "push", "webhook"].includes(channel)) throw new UnprocessableEntityException("send action has an unsupported channel");
    let templateCode = configuration.templateCode ? String(configuration.templateCode) : "";
    if (!templateCode && configuration.templateId) {
      const template = await client.query<{ code: string }>(`SELECT code FROM notification_templates WHERE workspace_id=$1 AND id=$2 AND status='approved'`, [run.workspace_id, this.uuid(configuration.templateId, "send action templateId")]);
      templateCode = template.rows[0]?.code ?? "";
    }
    if (!templateCode) throw new UnprocessableEntityException("send action requires an approved template");
    const variables = configuration.variables && typeof configuration.variables === "object" && !Array.isArray(configuration.variables) ? configuration.variables as Record<string, unknown> : {};
    return this.notifications.enqueueWithClient(client, {
      workspaceId: String(run.workspace_id),
      recipientType,
      recipientId,
      channel,
      templateCode,
      locale: configuration.locale ? String(configuration.locale) : undefined,
      eventType: String(configuration.eventType ?? "service"),
      variables,
      scheduledFor: configuration.scheduledFor ? String(configuration.scheduledFor) : undefined,
      deepLink: configuration.deepLink ? String(configuration.deepLink) : undefined,
      idempotencyKey: `${run.id}:${stepKey}:${attempt}`,
      correlationId: String(run.correlation_id),
    });
  }
  private async projectHandoffAction(client: PoolClient, run: Row, configuration: Record<string, unknown>): Promise<Row> {
    if (!["opportunity", "crm_opportunity"].includes(String(run.aggregate_type))) throw new UnprocessableEntityException("create_project_handoff requires an opportunity aggregate");
    const opportunity = await client.query<Row>(`SELECT id,party_id,title,status FROM crm_opportunities WHERE workspace_id=$1 AND id=$2`, [run.workspace_id, run.aggregate_id]);
    if (!opportunity.rowCount || opportunity.rows[0].status !== "won") throw new UnprocessableEntityException("Only a won opportunity may request project handoff");
    const projectId = configuration.projectId ? this.uuid(configuration.projectId, "project handoff projectId") : null;
    const mode = String(configuration.mode ?? "delivery");
    if (!["pre_sales", "delivery"].includes(mode)) throw new UnprocessableEntityException("Project handoff mode is invalid");
    let link: Row | null = null;
    if (projectId) {
      const linked = await client.query<Row>(`INSERT INTO crm_project_links (workspace_id,opportunity_id,project_id,mode,promoted_at) VALUES ($1,$2,$3,$4::varchar,CASE WHEN $4::text='delivery' THEN now() ELSE NULL END) ON CONFLICT (workspace_id,opportunity_id) DO UPDATE SET project_id=EXCLUDED.project_id,mode=EXCLUDED.mode,promoted_at=CASE WHEN EXCLUDED.mode='delivery' THEN COALESCE(crm_project_links.promoted_at,now()) ELSE crm_project_links.promoted_at END,version=crm_project_links.version+1 RETURNING id,project_id AS "projectId",mode,version`, [run.workspace_id, run.aggregate_id, projectId, mode]);
      link = linked.rows[0];
    }
    const output = { requested: true, projectId, mode, linkId: link?.id ?? null };
    await this.events.record(client, { workspaceId: String(run.workspace_id), actorUserId: null, source: "automation", action: "crm.project_handoff_requested.v1", entityType: "crm_opportunity", entityId: String(run.aggregate_id), correlationId: String(run.correlation_id), causationId: String(run.trigger_event_id), after: { ...output, partyId: opportunity.rows[0].party_id, title: opportunity.rows[0].title } });
    return output;
  }
  private aggregateTarget(run: Row) {
    const type = String(run.aggregate_type).replace(/^crm_/, "");
    const targets: Record<string, { entityType: string; table: string; column: string }> = {
      party: { entityType: "party", table: "crm_parties", column: "party_id" },
      lead: { entityType: "lead", table: "crm_leads", column: "lead_id" },
      opportunity: { entityType: "opportunity", table: "crm_opportunities", column: "opportunity_id" },
      activity: { entityType: "activity", table: "crm_activities", column: "id" },
    };
    const target = targets[type];
    if (!target) throw new UnprocessableEntityException("Automation aggregate is unsupported for this action");
    return target;
  }
  private async aggregatePartyId(client: PoolClient, run: Row): Promise<string> {
    const type = String(run.aggregate_type).replace(/^crm_/, "");
    if (type === "party") return String(run.aggregate_id);
    const table = type === "lead" ? "crm_leads" : type === "opportunity" ? "crm_opportunities" : type === "activity" ? "crm_activities" : null;
    if (!table) throw new UnprocessableEntityException("Automation aggregate has no customer party");
    const result = await client.query<{ party_id: string }>(`SELECT party_id FROM ${table} WHERE workspace_id=$1 AND id=$2`, [run.workspace_id, run.aggregate_id]);
    if (!result.rowCount) throw new NotFoundException("Automation aggregate no longer exists");
    return result.rows[0].party_id;
  }
  private resolveValue(value: unknown, run: Row): unknown {
    if (Array.isArray(value)) return value.map((item) => this.resolveValue(item, run));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Row).map(([key, item]) => [key, this.resolveValue(item, run)]));
    if (typeof value !== "string" || !value.startsWith("$")) return value;
    if (value === "$aggregateId") return run.aggregate_id;
    if (value === "$workspaceId") return run.workspace_id;
    const path = value.replace(/^\$(?:context\.)?/, "").split(".");
    let current: unknown = run.context;
    for (const segment of path) current = current && typeof current === "object" ? (current as Row)[segment] : undefined;
    return current;
  }
  private actionDate(value: unknown, delayMinutes: unknown, label: string): Date | null {
    if (value == null && delayMinutes == null) return null;
    const date = value != null ? new Date(String(value)) : new Date(Date.now() + Number(delayMinutes) * 60_000);
    if (Number.isNaN(date.getTime()) || (delayMinutes != null && (!Number.isFinite(Number(delayMinutes)) || Number(delayMinutes) < 0))) throw new UnprocessableEntityException(`${label} is invalid`);
    return date;
  }
  private uuid(value: unknown, label: string): string {
    const text = String(value ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new UnprocessableEntityException(`${label} must be a UUID`);
    return text;
  }
  private assertValid(definition: Record<string, unknown>) { const validation = validateAutomationDefinition(definition); if (!validation.valid) throw new UnprocessableEntityException(validation); }
  private checksum(value: Record<string, unknown>) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
  private async insertVersion(client: import("pg").PoolClient, workspaceId: string, definitionId: string, versionNumber: number, definition: Record<string, unknown>) { const result = await client.query(`INSERT INTO automation_versions (workspace_id,definition_id,version_number,definition,checksum) VALUES ($1,$2,$3,$4,$5) RETURNING id,version_number AS "versionNumber",definition,checksum`, [workspaceId, definitionId, versionNumber, definition, this.checksum(definition)]); return result.rows[0]; }
  private executionPlan(definition: Record<string, unknown>) { return (Array.isArray(definition.nodes) ? definition.nodes : []).map((node) => { const value = node as Row; return { key: value.key, type: value.type }; }); }
}
