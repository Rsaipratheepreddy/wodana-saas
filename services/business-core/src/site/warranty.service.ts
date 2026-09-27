import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { membershipOf, readProject } from "../project-core/project-core.store";
import { raiseSnag } from "../project-core/project-work";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { SUPPLIES, warrantyMonths, type Supply } from "./warranty";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = ["phone", "email", "visit", "message", "portal"] as const;

/**
 * A project's warranty and aftercare: what's covered and until when, and the client's claims — covered
 * (a warranty snag to fix, even once the project is complete), not covered, or chargeable, with why.
 */
@Injectable()
export class WarrantyService {
  constructor(private readonly access: WorkspaceAccessService) {}

  state(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.read(client, workspaceId, projectId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      if (!["active", "on_hold", "completed"].includes(who.status)) throw new ConflictException("The project was cancelled.");
      await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
      const action = String(body.action ?? "");
      let audit: Record<string, unknown> = {};
      if (action === "set_months") {
        if (!who.manager) throw new ForbiddenException("Only the project manager changes a warranty.");
        const lineId = uuid(body.lineId, "Item");
        const months = Number(body.months);
        if (!Number.isInteger(months) || months < 0 || months > 600) throw new BadRequestException("Months of warranty, from 0 to 600.");
        const reason = text(body.reason, 500);
        if (!reason) throw new BadRequestException("Say why the warranty changes.");
        const updated = await client.query(
          `UPDATE warranty_items SET months = $4, ends_on = (starts_on + make_interval(months => $4) - interval '1 day')::date, note = $5
            WHERE workspace_id = $1 AND project_id = $2 AND boq_line_id = $3 RETURNING id`, [workspaceId, projectId, lineId, months, reason]);
        if (!updated.rowCount) throw new ConflictException("This item's warranty hasn't started: it starts when the client accepts its handover.");
        audit = { lineId, months, reason };
      } else if (action === "record_claim") {
        if (!who.onTeam) throw new ForbiddenException("Only the project's team records claims.");
        const id = uuid(body.id, "Claim");
        if ((await client.query(`SELECT 1 FROM warranty_claims WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.read(client, workspaceId, projectId, user.userId);
        const raisedOn = date(body.raisedOn, "Date");
        const raisedByName = text(body.raisedByName, 200);
        const description = text(body.description, 2000);
        if (!raisedByName) throw new BadRequestException("Say who raised it.");
        if (!description) throw new BadRequestException("Say what's wrong.");
        const channel = oneOf(body.channel ?? "phone", CHANNELS, "How it came in");
        const lineId = body.boqLineId ? uuid(body.boqLineId, "Item") : null;
        if (lineId && !(await client.query(`SELECT 1 FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, lineId])).rowCount)
          throw new BadRequestException("Choose an item from the project's scope.");
        const areaId = body.areaId ? uuid(body.areaId, "Area") : null;
        const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM warranty_claims WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
        await client.query(
          `INSERT INTO warranty_claims (id, workspace_id, project_id, number, raised_on, raised_by_name, channel, description, area_id, boq_line_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, workspaceId, projectId, number, raisedOn, raisedByName, channel, description, areaId, lineId, user.userId]);
        await this.tell(client, workspaceId, projectId, user.userId, `${raisedByName}: ${description}`, `claim:${id}`);
        audit = { claimId: id, number };
      } else if (action === "decide_claim") {
        if (!who.manager) throw new ForbiddenException("Only the project manager decides claims.");
        const claim = (await client.query<{ id: string; number: number; status: string; version: number; raisedOn: string; description: string; areaId: string | null; lineId: string | null }>(
          `SELECT id, number, status, version, raised_on::text AS "raisedOn", description, area_id AS "areaId", boq_line_id AS "lineId" FROM warranty_claims
            WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, projectId, uuid(body.claimId, "Claim")])).rows[0];
        if (!claim) throw new NotFoundException("Claim not found.");
        if (body.version !== claim.version) throw new ConflictException("This claim changed elsewhere. Reload to see it.");
        if (claim.status !== "open") throw new ConflictException("This claim is already decided.");
        const decision = oneOf(body.decision, ["covered", "not_covered", "chargeable"] as const, "Decision");
        const note = text(body.note, 1000);
        let snagId: string | null = null;
        if (decision === "covered") {
          // Covered: within its item's warranty on the day it was raised — or goodwill, with why.
          const cover = claim.lineId ? (await client.query<{ inside: boolean }>(
            `SELECT $4::date BETWEEN starts_on AND ends_on AND months > 0 AS inside FROM warranty_items WHERE workspace_id = $1 AND project_id = $2 AND boq_line_id = $3`,
            [workspaceId, projectId, claim.lineId, claim.raisedOn])).rows[0]?.inside ?? false : false;
          if (!cover && !note) throw new BadRequestException(claim.lineId ? "Its warranty didn't cover that day: say why it's covered anyway." : "Choose the item it's about, or say why it's covered.");
          const severity = oneOf(body.severity ?? "major", ["minor", "major", "critical"] as const, "Severity");
          const package_ = claim.lineId ? (await client.query<{ packageId: string | null }>(`SELECT package_id AS "packageId" FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, claim.lineId])).rows[0]?.packageId ?? null : null;
          const snag = await raiseSnag(client, workspaceId, { projectId, title: `Warranty claim ${claim.number}: ${claim.description}`.slice(0, 300), description: note || "Covered by warranty.",
            severity, source: "warranty", packageId: package_, boqLineId: claim.lineId, actorId: user.userId });
          if (claim.areaId) await client.query(`UPDATE work_items SET area_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, snag.id, claim.areaId]);
          snagId = snag.id;
        } else if (!note) throw new BadRequestException(decision === "chargeable" ? "Say what the client will be charged for." : "Say why it isn't covered.");
        await client.query(`UPDATE warranty_claims SET status = $3, decision_note = $4, decided_by = $5, decided_at = now(), snag_id = $6, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, claim.id, decision, note, user.userId, snagId]);
        audit = { claimId: claim.id, decision, note, snagId };
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `warranty.${action}`, entityType: "project", entityId: projectId, after: audit });
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => ({
      months: await warrantyMonths(client, workspaceId), canManage: await this.access.hasPermission(client, workspaceId, user.userId, "workspace.settings.manage"),
    }));
  }

  /** The months of warranty for each way of delivering a package; applies to handovers from now on. */
  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const months = (body.months ?? {}) as Record<string, unknown>;
      for (const supply of SUPPLIES) {
        if (months[supply] === undefined) continue;
        const value = Number(months[supply]);
        if (!Number.isInteger(value) || value < 0 || value > 600) throw new BadRequestException("Months of warranty, from 0 to 600.");
        await client.query(`INSERT INTO warranty_defaults (workspace_id, supply, months, updated_by) VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, supply) DO UPDATE SET months = EXCLUDED.months, updated_by = EXCLUDED.updated_by, updated_at = now()`, [workspaceId, supply, value, user.userId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "warranty.settings_changed", entityType: "workspace", entityId: workspaceId, after: months });
      return { months: await warrantyMonths(client, workspaceId), canManage: true };
    });
  }

  // ---------- helpers ----------
  private async read(client: Db, workspaceId: string, projectId: string, userId: string) {
    const who = await this.who(client, workspaceId, projectId, userId);
    const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
      [workspaceId])).rows[0].today;
    const items = (await client.query<{ lineId: string; title: string; areaName: string | null; supply: Supply | null; months: number; startsOn: string; endsOn: string; note: string }>(
      `SELECT item.boq_line_id AS "lineId", line.title, room.name AS "areaName", package.supply, item.months, item.starts_on::text AS "startsOn", item.ends_on::text AS "endsOn", item.note
         FROM warranty_items item
         JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = item.boq_line_id
         JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
         LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
         LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
        WHERE item.workspace_id = $1 AND item.project_id = $2 ORDER BY line.position`, [workspaceId, projectId])).rows;
    const claims = (await client.query<{ id: string; number: number; raisedOn: string; raisedByName: string; channel: string; description: string; areaId: string | null; lineId: string | null;
      lineTitle: string | null; status: string; decisionNote: string; decidedByName: string | null; snagId: string | null; snagNumber: number | null; snagStatus: string | null; version: number }>(
      `SELECT claim.id, claim.number, claim.raised_on::text AS "raisedOn", claim.raised_by_name AS "raisedByName", claim.channel, claim.description, claim.area_id AS "areaId",
              claim.boq_line_id AS "lineId", line.title AS "lineTitle", claim.status, claim.decision_note AS "decisionNote", decider.display_name AS "decidedByName", claim.snag_id AS "snagId",
              snag.number AS "snagNumber", snag.status AS "snagStatus", claim.version
         FROM warranty_claims claim
         LEFT JOIN project_boq_lines line ON line.workspace_id = claim.workspace_id AND line.id = claim.boq_line_id
         LEFT JOIN users decider ON decider.id = claim.decided_by
         LEFT JOIN work_items snag ON snag.workspace_id = claim.workspace_id AND snag.id = claim.snag_id
        WHERE claim.workspace_id = $1 AND claim.project_id = $2 ORDER BY claim.number DESC`, [workspaceId, projectId])).rows;
    const lines = (await client.query<{ id: string; title: string }>(`SELECT id, title FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND status = 'active' ORDER BY position`,
      [workspaceId, projectId])).rows;
    const areas = (await client.query<{ id: string; name: string }>(
      `SELECT room.id, room.name FROM pre_project_rooms room JOIN delivery_projects project ON project.workspace_id = room.workspace_id AND project.case_id = room.case_id
        WHERE room.workspace_id = $1 AND project.id = $2 ORDER BY room.name`, [workspaceId, projectId])).rows;
    return {
      items: items.map((item) => ({ ...item, active: item.months > 0 && item.startsOn <= today && today <= item.endsOn })), claims, lines, areas, today,
      canRecord: who.onTeam && who.status !== "cancelled", canManage: who.manager && who.status !== "cancelled",
    };
  }

  private async who(client: Db, workspaceId: string, projectId: string, userId: string) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
    const membershipId = await membershipOf(client, workspaceId, userId);
    const assignment = (await client.query<{ lead: boolean }>(
      `SELECT is_manager AS lead FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rows[0];
    if (!all && !assignment) throw new NotFoundException("Project not found.");
    return { onTeam: all || Boolean(assignment), manager: all || Boolean(assignment?.lead), status: project.status };
  }

  /** A claim reaches the project manager and the account manager at once. */
  private async tell(client: Db, workspaceId: string, projectId: string, actorId: string, note: string, key: string) {
    const facts = (await client.query<{ title: string; clientName: string }>(
      `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
         FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
    const people = (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR 'account_manager' = ANY(assignment.role_keys))`,
      [workspaceId, projectId])).rows.map((row) => row.userId).filter((id) => id !== actorId);
    for (const userId of new Set(people)) {
      const message = { workspaceId, recipientUserId: userId, code: "warranty.claim", eventType: "warranty.claim", variables: { title: facts?.title ?? "", clientName: facts?.clientName ?? "", actor,
        note: note.slice(0, 480) }, deepLink: `/workspace/projects/${projectId}/warranty` };
      await notifyUserInApp(client, { ...message, idempotencyKey: `warranty.claim:${key}:${userId}` });
      await queueUserEmail(client, { ...message, idempotencyKey: `warranty.claim:${key}:${userId}:email` });
    }
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new BadRequestException(`Choose ${label.toLowerCase()}.`);
  return value as T;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
