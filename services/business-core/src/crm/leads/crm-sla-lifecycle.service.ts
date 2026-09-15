import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import {
  addSlaMinutes,
  calculateSlaDeadlines,
  normalizeSlaSchedule,
  remainingSlaMinutes,
  SlaSchedule,
  SlaScheduleValidationError,
} from "./sla-schedule";

type SlaRow = {
  id: string;
  started_at: Date;
  status: "active" | "warning" | "breached" | "paused" | "stopped";
  warning_at: Date;
  due_at: Date;
  paused_at: Date | null;
  paused_from_status: "active" | "warning" | null;
  remaining_warning_minutes: number | null;
  remaining_breach_minutes: number | null;
  total_paused_minutes: number;
  calculation_mode: "elapsed" | "business";
  policy_snapshot: Record<string, unknown>;
  cycle: number;
};

type StartedSla = {
  id: string;
  status: string;
  cycle: number;
  startedAt: Date;
  warningAt: Date;
  dueAt: Date;
};

@Injectable()
export class CrmSlaLifecycleService {
  async startFirstResponse(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    input: {
      actorUserId: string | null;
      ownerMembershipId: string | null;
      reason: string;
      startedAt?: Date;
      newCycle?: boolean;
      includeHistoricalImport?: boolean;
    },
  ): Promise<StartedSla | null> {
    await this.lock(client, workspaceId, leadId, "first_response");
    const latest = await client.query<SlaRow>(
      `SELECT * FROM crm_sla_instances
       WHERE workspace_id=$1 AND target_type='lead' AND target_id=$2
         AND event_type='first_response'
       ORDER BY cycle DESC LIMIT 1 FOR UPDATE`,
      [workspaceId, leadId],
    );
    if (latest.rowCount && latest.rows[0].status !== "stopped") return this.mapStarted(latest.rows[0]);
    if (latest.rowCount && !input.newCycle) return null;

    const context = await client.query<{ received_at: Date; intake_method: string }>(
      `SELECT enquiry.received_at,intake.intake_method
       FROM crm_leads lead
       JOIN crm_enquiries enquiry ON enquiry.workspace_id=lead.workspace_id AND enquiry.id=lead.enquiry_id
       JOIN crm_intake_events intake ON intake.workspace_id=lead.workspace_id AND intake.id=enquiry.intake_event_id
       WHERE lead.workspace_id=$1 AND lead.id=$2`,
      [workspaceId, leadId],
    );
    if (!context.rowCount) throw new UnprocessableEntityException("Cannot start an SLA for a missing lead");
    if (context.rows[0].intake_method === "import" && !input.includeHistoricalImport && !input.newCycle) return null;

    const policyResult = await client.query<{
      id: string;
      name: string;
      event_type: string;
      warning_after_minutes: number;
      breach_after_minutes: number;
      calculation_mode: "elapsed" | "business";
      schedule_version: number;
      schedule: Record<string, unknown>;
      version: number;
    }>(
      `SELECT id,name,event_type,warning_after_minutes,breach_after_minutes,
              calculation_mode,schedule_version,schedule,version
       FROM crm_sla_policies
       WHERE workspace_id=$1 AND status='active' AND event_type='first_response'
       ORDER BY created_at,id LIMIT 1`,
      [workspaceId],
    );
    if (!policyResult.rowCount) return null;
    const policy = policyResult.rows[0];
    const schedule = this.schedule(policy.schedule, policy.calculation_mode);
    const startedAt = input.startedAt ?? (input.newCycle ? new Date() : new Date(context.rows[0].received_at));
    const { warningAt, dueAt } = calculateSlaDeadlines(
      startedAt,
      Number(policy.warning_after_minutes),
      Number(policy.breach_after_minutes),
      schedule,
    );
    const cycle = latest.rowCount ? Number(latest.rows[0].cycle) + 1 : 1;
    const snapshot = {
      policyId: policy.id,
      policyVersion: Number(policy.version),
      name: policy.name,
      eventType: policy.event_type,
      warningAfterMinutes: Number(policy.warning_after_minutes),
      breachAfterMinutes: Number(policy.breach_after_minutes),
      calculationMode: schedule.mode,
      scheduleVersion: Number(policy.schedule_version),
      schedule,
      ownerMembershipId: input.ownerMembershipId,
      capturedAt: new Date().toISOString(),
    };
    const inserted = await client.query<SlaRow>(
      `INSERT INTO crm_sla_instances(
         workspace_id,policy_id,lead_id,target_type,target_id,event_type,cycle,
         calculation_mode,policy_snapshot,status,started_at,warning_at,due_at
       ) VALUES($1,$2,$3,'lead',$3,'first_response',$4,$5,$6,'active',$7,$8,$9)
       RETURNING *`,
      [workspaceId, policy.id, leadId, cycle, schedule.mode, snapshot, startedAt, warningAt, dueAt],
    );
    await this.recordTransition(client, workspaceId, inserted.rows[0].id, "started", null, "active", input.reason, {
      cycle,
      startedAt,
      warningAt,
      dueAt,
      ownerMembershipId: input.ownerMembershipId,
    }, input.actorUserId);
    return this.mapStarted(inserted.rows[0]);
  }

  async pauseFirstResponse(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    actorUserId: string | null,
    reason: string,
    now = new Date(),
  ): Promise<SlaRow | null> {
    await this.lock(client, workspaceId, leadId, "first_response");
    const result = await client.query<SlaRow>(
      `SELECT * FROM crm_sla_instances
       WHERE workspace_id=$1 AND lead_id=$2 AND event_type='first_response'
         AND status IN ('active','warning')
       ORDER BY cycle DESC LIMIT 1 FOR UPDATE`,
      [workspaceId, leadId],
    );
    if (!result.rowCount) return null;
    let current = result.rows[0];
    if (now >= new Date(current.due_at)) {
      const breached = await client.query<SlaRow>(
        `UPDATE crm_sla_instances SET status='breached',breached_at=COALESCE(breached_at,$3),
           version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 RETURNING *`,
        [workspaceId, current.id, now],
      );
      await this.recordTransition(client, workspaceId, current.id, "breached", current.status, "breached", "Deadline elapsed before pause", { dueAt: current.due_at }, actorUserId, now);
      return breached.rows[0];
    }
    if (current.status === "active" && now >= new Date(current.warning_at)) {
      const warned = await client.query<SlaRow>(
        `UPDATE crm_sla_instances SET status='warning',warned_at=COALESCE(warned_at,$3),
           version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 RETURNING *`,
        [workspaceId, current.id, now],
      );
      await this.recordTransition(client, workspaceId, current.id, "warning", "active", "warning", "Warning elapsed before pause", { warningAt: current.warning_at }, actorUserId, now);
      current = warned.rows[0];
    }
    const schedule = this.snapshotSchedule(current);
    const remainingWarning = remainingSlaMinutes(now, new Date(current.warning_at), schedule);
    const remainingBreach = remainingSlaMinutes(now, new Date(current.due_at), schedule);
    const paused = await client.query<SlaRow>(
      `UPDATE crm_sla_instances SET status='paused',paused_at=$3,paused_from_status=$4,
         remaining_warning_minutes=$5,remaining_breach_minutes=$6,
         version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, current.id, now, current.status, remainingWarning, remainingBreach],
    );
    await this.recordTransition(client, workspaceId, current.id, "paused", current.status, "paused", reason, {
      remainingWarningMinutes: remainingWarning,
      remainingBreachMinutes: remainingBreach,
    }, actorUserId, now);
    return paused.rows[0];
  }

  async resumeFirstResponse(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    actorUserId: string | null,
    reason: string,
    now = new Date(),
  ): Promise<SlaRow | null> {
    await this.lock(client, workspaceId, leadId, "first_response");
    const result = await client.query<SlaRow>(
      `SELECT * FROM crm_sla_instances
       WHERE workspace_id=$1 AND lead_id=$2 AND event_type='first_response' AND status='paused'
       ORDER BY cycle DESC LIMIT 1 FOR UPDATE`,
      [workspaceId, leadId],
    );
    if (!result.rowCount) return null;
    const current = result.rows[0];
    const schedule = this.snapshotSchedule(current);
    const warningAt = addSlaMinutes(now, Number(current.remaining_warning_minutes), schedule);
    const dueAt = addSlaMinutes(now, Number(current.remaining_breach_minutes), schedule);
    const restoredStatus = current.paused_from_status ?? "active";
    const pausedMinutes = Math.max(0, Math.ceil((now.getTime() - new Date(current.paused_at as Date).getTime()) / 60_000));
    const resumed = await client.query<SlaRow>(
      `UPDATE crm_sla_instances SET status=$3,warning_at=$4,due_at=$5,
         total_paused_minutes=total_paused_minutes+$6,paused_at=NULL,paused_from_status=NULL,
         remaining_warning_minutes=NULL,remaining_breach_minutes=NULL,
         version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, current.id, restoredStatus, warningAt, dueAt, pausedMinutes],
    );
    await this.recordTransition(client, workspaceId, current.id, "resumed", "paused", restoredStatus, reason, {
      warningAt,
      dueAt,
      pausedMinutes,
    }, actorUserId, now);
    return resumed.rows[0];
  }

  async stopFirstResponse(
    client: PoolClient,
    workspaceId: string,
    leadId: string,
    actorUserId: string | null,
    reason: string,
    evidence: Record<string, unknown>,
    now = new Date(),
  ): Promise<SlaRow | null> {
    await this.lock(client, workspaceId, leadId, "first_response");
    const current = await client.query<SlaRow>(
      `SELECT * FROM crm_sla_instances
       WHERE workspace_id=$1 AND lead_id=$2 AND event_type='first_response'
         AND status IN ('active','warning','breached','paused')
       ORDER BY cycle DESC LIMIT 1 FOR UPDATE`,
      [workspaceId, leadId],
    );
    if (!current.rowCount) return null;
    const before = current.rows[0];
    const stopped = await client.query<SlaRow>(
      `UPDATE crm_sla_instances SET status='stopped',stopped_at=$3,stop_reason=$4,
         response_evidence=$5,paused_at=NULL,paused_from_status=NULL,
         remaining_warning_minutes=NULL,remaining_breach_minutes=NULL,
         version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND id=$2 RETURNING *`,
      [workspaceId, before.id, now, reason, evidence],
    );
    await this.recordTransition(client, workspaceId, before.id, "stopped", before.status, "stopped", reason, evidence, actorUserId, now);
    return stopped.rows[0];
  }

  private snapshotSchedule(row: SlaRow): SlaSchedule {
    const snapshot = row.policy_snapshot ?? {};
    return this.schedule(snapshot.schedule, snapshot.calculationMode ?? row.calculation_mode);
  }

  private schedule(value: unknown, mode: unknown): SlaSchedule {
    try {
      return normalizeSlaSchedule(value, mode);
    } catch (error) {
      if (error instanceof SlaScheduleValidationError) {
        throw new UnprocessableEntityException(`SLA policy schedule is invalid: ${error.message}`);
      }
      throw error;
    }
  }

  private lock(client: PoolClient, workspaceId: string, targetId: string, eventType: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:${targetId}:${eventType}`]);
  }

  recordTransition(
    client: PoolClient,
    workspaceId: string,
    instanceId: string,
    transition: string,
    fromStatus: string | null,
    toStatus: string,
    reason: string,
    evidence: Record<string, unknown>,
    actorUserId: string | null,
    occurredAt = new Date(),
  ) {
    return client.query(
      `INSERT INTO crm_sla_history(
         workspace_id,instance_id,transition,from_status,to_status,reason,evidence,actor_user_id,occurred_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [workspaceId, instanceId, transition, fromStatus, toStatus, reason, evidence, actorUserId, occurredAt],
    );
  }

  private mapStarted(row: SlaRow): StartedSla {
    return {
      id: row.id,
      status: row.status,
      cycle: Number(row.cycle),
      startedAt: new Date(row.started_at),
      warningAt: new Date(row.warning_at),
      dueAt: new Date(row.due_at),
    };
  }
}
