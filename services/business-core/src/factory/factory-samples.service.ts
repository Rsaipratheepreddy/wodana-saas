import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  appointmentDay, readSamples, sampleDesigners, sampleDueProblem, sampleMakers, suggestedDue, tellSample, workspaceDayText, type SampleRequest,
} from "./factory-samples";
import { workspaceDay } from "./workcenter-rates";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FACTORY = ["factory.view", "factory.manage", "factory.report", "factory.approve", "factory.recipe.verify", "factory.dispatch.signoff"];
const MAKERS = ["factory.manage", "factory.report"];

/**
 * PLM-061: sample requests. The design team (people who edit Planning cases) asks; the people who run the factory or
 * report its output mark a sample ready (or open it again); whoever asked, someone who manages cases or the factory
 * withdraws it. Requests are replayed safely by their id; every other change is version-checked and audited.
 */
@Injectable()
export class FactorySamplesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Every request (the Factory), or one case's (the case and its project), with what the viewer may do. */
  list(actor: RequestActor, workspaceId: string, caseId: string | null) {
    return this.access.withAnyPermission(actor, workspaceId, [...FACTORY, "pre_projects.view"], async (client, user) => this.view(client, workspaceId, user.userId, caseId));
  }

  /** Asks the factory for a sample, needed by a day (before the material selection appointment when one is booked). */
  request(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.edit", async (client, user) => {
      const id = uuid(body.id, "Request");
      const caseId = uuid(body.caseId, "Case");
      const existing = (await client.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM sample_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing) {
        if (existing.caseId !== caseId) throw new ConflictException("This request id belongs to another case.");
        return this.view(client, workspaceId, user.userId, caseId);
      }
      const found = (await client.query<{ status: string }>(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId])).rows[0];
      if (!found) throw new NotFoundException("Case not found.");
      if (found.status === "cancelled") throw new ConflictException("The case is cancelled.");
      if (found.status === "on_hold") throw new ConflictException("The case is on hold. Resume it first.");
      const title = text(body.title, 200);
      if (!title) throw new BadRequestException("Say which sample is needed.");
      const note = text(body.note, 1000);
      const dueOn = date(body.dueOn, "The day it's needed");
      if (!dueOn) throw new BadRequestException("Choose the day it's needed.");
      const today = (await workspaceDay(client, workspaceId)).today;
      const problem = sampleDueProblem(dueOn, today, await appointmentDay(client, workspaceId, caseId));
      if (problem) throw new BadRequestException(problem);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('sample-number:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM sample_requests WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(`INSERT INTO sample_requests (id, workspace_id, case_id, number, title, note, due_on, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, workspaceId, caseId, number, title, note, dueOn, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "sample_request.created", entityType: "sample_request", entityId: id, after: { caseId, number, title, note, dueOn } });
      const [sample] = await readSamples(client, workspaceId, { id });
      await tellSample(client, { workspaceId, code: "factory.sample_requested", sample, users: await sampleMakers(client, workspaceId, caseId), actorUserId: user.userId, key: id,
        note, email: true, deepLink: `/workspace/factory/samples?sample=${id}`, date: await workspaceDayText(client, workspaceId, dueOn) });
      return this.view(client, workspaceId, user.userId, caseId);
    });
  }

  /** Marks a sample ready (the people who hear: whoever asked and the designer), opens it again, or withdraws it. */
  command(actor: RequestActor, workspaceId: string, sampleId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, [...MAKERS, "pre_projects.edit", "pre_projects.manage_lifecycle"], async (client, user) => {
      const row = (await client.query<{ version: number }>(`SELECT version FROM sample_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(sampleId, "Request")])).rows[0];
      if (!row) throw new NotFoundException("Sample request not found.");
      const [sample] = await readSamples(client, workspaceId, { id: sampleId });
      if (body.version !== row.version) throw new ConflictException("Someone else changed this request. Reload to see the latest.");
      const action = String(body.action ?? "");
      const has = async (codes: string[]) => { for (const code of codes) if (await this.access.hasPermission(client, workspaceId, user.userId, code)) return true; return false; };
      const scope = body.caseId === undefined || body.caseId === null ? null : uuid(body.caseId, "Case");
      let audit: Record<string, unknown>;
      if (action === "ready") {
        if (!(await has(MAKERS))) throw new ForbiddenException("Only the factory marks a sample ready.");
        if (sample.status !== "requested") throw new ConflictException(sample.status === "ready" ? "This sample is already ready." : "This request was withdrawn.");
        const note = text(body.note, 500);
        await client.query(`UPDATE sample_requests SET status = 'ready', ready_note = $3, ready_by = $4, ready_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, sampleId, note, user.userId]);
        await tellSample(client, { workspaceId, code: "factory.sample_ready", sample, users: await sampleDesigners(client, workspaceId, sample.caseId, sample.requestedBy),
          actorUserId: user.userId, key: `${sampleId}:${row.version}`, note, email: true, deepLink: sample.projectId ? `/workspace/projects/${sample.projectId}/scope?view=materials` : `/workspace/pre-projects/cases/${sample.caseId}/overview`,
          date: await workspaceDayText(client, workspaceId, (await workspaceDay(client, workspaceId)).today) });
        audit = { note };
      } else if (action === "reopen") {
        if (!(await has(MAKERS))) throw new ForbiddenException("Only the factory opens a sample again.");
        if (sample.status !== "ready") throw new ConflictException("Only a ready sample can be opened again.");
        await client.query(`UPDATE sample_requests SET status = 'requested', ready_note = '', ready_by = NULL, ready_at = NULL, due_notified_on = NULL, version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, sampleId]);
        audit = {};
      } else if (action === "cancel") {
        if (sample.requestedBy !== user.userId && !(await has(["pre_projects.manage_lifecycle", "factory.manage"])))
          throw new ForbiddenException("Only whoever asked for it, or someone who manages cases or the factory, withdraws a request.");
        if (sample.status !== "requested") throw new ConflictException("Only an open request can be withdrawn.");
        const reason = text(body.reason, 500);
        if (!reason) throw new BadRequestException("Say why it's no longer needed.");
        await client.query(`UPDATE sample_requests SET status = 'cancelled', cancel_reason = $3, cancelled_by = $4, cancelled_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, sampleId, reason, user.userId]);
        audit = { reason };
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `sample_request.${action}`, entityType: "sample_request", entityId: sampleId,
        before: { status: sample.status }, after: audit });
      return this.view(client, workspaceId, user.userId, scope);
    });
  }

  private async view(client: Db, workspaceId: string, userId: string, caseId: string | null) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    let factory = false;
    for (const code of FACTORY) if (await has(code)) { factory = true; break; }
    if (!caseId && !factory) throw new ForbiddenException("You don't have access to the factory.");
    if (caseId && !factory && !(await has("pre_projects.view"))) throw new ForbiddenException("You don't have access to this case.");
    const today = (await workspaceDay(client, workspaceId)).today;
    const appointmentOn = caseId ? await appointmentDay(client, workspaceId, caseId) : null;
    const samples: SampleRequest[] = await readSamples(client, workspaceId, { caseId });
    return {
      samples, today, appointmentOn, suggestedDueOn: suggestedDue(today, appointmentOn), me: userId,
      canRequest: Boolean(caseId) && await has("pre_projects.edit"), canMake: await has("factory.manage") || await has("factory.report"),
      canWithdrawAny: await has("pre_projects.manage_lifecycle") || await has("factory.manage"),
    };
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function text(value: unknown, max: number) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  return trimmed;
}

function date(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
