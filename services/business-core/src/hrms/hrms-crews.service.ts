import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestActor } from "../auth/actor";
import { readTradeRates, rateOn, tradeKey, tradeName } from "../project-core/labour-rates";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";
import { CrewDayDecisionDto, CrewDayDto, CrewDaySubmitDto, CrewDto, WorkerDto } from "./hrms.dto";
import { clearance } from "./hrms-documents.service";
import { dateOnly, formatDates, localDate, locationEvidence } from "./hrms-domain";

type CrewDayRow = {
  id: string; crewId: string; crewName: string; trade: string; projectId: string | null; projectName: string | null; workDate: string; status: string;
  markedBy: string; markedByName: string; markedMembershipId: string; captureId: string | null; evidence: Record<string, unknown>; note: string;
  exceptionReason: string; submittedAt: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string; version: number;
};
const PRESENCE_DAYS: Record<string, number> = { present: 1, half_day: 0.5, absent: 0 };

/**
 * Crews and workers without logins (plan §6.28, H2). HR keeps the crews (a trade, optionally a
 * subcontractor and a lead) and their workers (a trade and, optionally, their own day rate). The crew's
 * lead, or the project's managers and site supervisors, mark a crew's day at a project's site (or the
 * workshop) with one group photo and the phone's position; someone else approves it. Approving fixes each
 * worker's day rate (their own, else their trade's on that day) and the day's cost goes to the project.
 */
@Injectable()
export class HrmsCrewsService {
  constructor(private readonly access: HrmsAccessService) {}

  crews(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.assertCanSeeCrews(ctx);
      return this.crewState(ctx);
    });
  }

  private async crewState(ctx: HrmsContext) {
    const crews = await ctx.client.query(
      `SELECT crew.id, crew.name, crew.trade, crew.vendor_id AS "vendorId", vendor.display_name AS "vendorName", crew.lead_membership_id AS "leadMembershipId",
              lead.display_name AS "leadName", crew.active, crew.version,
              (SELECT count(*)::int FROM hrms_workers worker WHERE worker.workspace_id = crew.workspace_id AND worker.crew_id = crew.id AND worker.active) AS workers
         FROM hrms_crews crew
         LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = crew.workspace_id AND vendor.id = crew.vendor_id
         LEFT JOIN workspace_memberships member ON member.workspace_id = crew.workspace_id AND member.id = crew.lead_membership_id
         LEFT JOIN users lead ON lead.id = member.user_id
        WHERE crew.workspace_id = $1 ORDER BY crew.active DESC, lower(crew.name)`,
      [ctx.workspaceId],
    );
    const manage = ctx.permissions.has("hrms.manage");
    const workers = await ctx.client.query(
      `SELECT worker.id, worker.name, worker.trade, worker.crew_id AS "crewId", worker.worker_code AS "workerCode", worker.phone,
              CASE WHEN $2 THEN worker.day_rate::text END AS "dayRate", CASE WHEN $2 THEN worker.currency END AS currency, worker.active, worker.version
         FROM hrms_workers worker WHERE worker.workspace_id = $1 ORDER BY worker.active DESC, lower(worker.name)`,
      [ctx.workspaceId, manage],
    );
    return { crews: crews.rows, workers: workers.rows, canManage: manage };
  }

  saveCrew(actor: RequestActor, workspaceId: string, input: CrewDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const id = input.id ?? randomUUID();
      const name = input.name.trim();
      if (!name || !input.trade.trim()) throw new BadRequestException("Name the crew and its trade.");
      await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`hrms-crews:${workspaceId}`]);
      const before = (await ctx.client.query(`SELECT * FROM hrms_crews WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
      this.access.version(before?.version, input.version);
      const same = await ctx.client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND lower(name)=lower($2) AND id<>$3`, [workspaceId, name, id]);
      if (same.rowCount) throw new ConflictException("A crew with this name exists.");
      if (input.leadMembershipId) await this.access.memberExists(ctx, input.leadMembershipId);
      if (input.vendorId) {
        const vendor = await ctx.client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.vendorId]);
        if (!vendor.rowCount) throw new BadRequestException("Choose a supplier from this workspace.");
      }
      await ctx.client.query(
        `INSERT INTO hrms_crews(id,workspace_id,name,trade,vendor_id,lead_membership_id,active) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,trade=EXCLUDED.trade,vendor_id=EXCLUDED.vendor_id,lead_membership_id=EXCLUDED.lead_membership_id,
           active=EXCLUDED.active,version=hrms_crews.version+1 WHERE hrms_crews.workspace_id=EXCLUDED.workspace_id`,
        [id, workspaceId, name, tradeName(input.trade), input.vendorId ?? null, input.leadMembershipId ?? null, input.active],
      );
      await this.access.audit(ctx, before ? "crew_updated" : "crew_created", id, { ...input, id }, before);
      return this.crewState(ctx);
    });
  }

  saveWorker(actor: RequestActor, workspaceId: string, input: WorkerDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage");
      const id = input.id ?? randomUUID();
      const name = input.name.trim();
      if (!name || !input.trade.trim()) throw new BadRequestException("Name the worker and their trade.");
      if ((input.dayRate === null || input.dayRate === undefined) !== !input.currency)
        throw new BadRequestException("Give the day rate with its currency, or neither.");
      await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`hrms-workers:${workspaceId}`]);
      const before = (await ctx.client.query(`SELECT * FROM hrms_workers WHERE workspace_id=$1 AND id=$2`, [workspaceId, id])).rows[0];
      this.access.version(before?.version, input.version);
      const code = input.workerCode.trim();
      if (code) {
        const same = await ctx.client.query(`SELECT 1 FROM hrms_workers WHERE workspace_id=$1 AND lower(worker_code)=lower($2) AND id<>$3`, [workspaceId, code, id]);
        if (same.rowCount) throw new ConflictException("That worker code is already in use.");
      }
      if (input.crewId) {
        const crew = await ctx.client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.crewId]);
        if (!crew.rowCount) throw new BadRequestException("Choose a crew from this workspace.");
      }
      await ctx.client.query(
        `INSERT INTO hrms_workers(id,workspace_id,crew_id,name,trade,worker_code,phone,day_rate,currency,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET crew_id=EXCLUDED.crew_id,name=EXCLUDED.name,trade=EXCLUDED.trade,worker_code=EXCLUDED.worker_code,phone=EXCLUDED.phone,
           day_rate=EXCLUDED.day_rate,currency=EXCLUDED.currency,active=EXCLUDED.active,version=hrms_workers.version+1 WHERE hrms_workers.workspace_id=EXCLUDED.workspace_id`,
        [id, workspaceId, input.crewId ?? null, name, tradeName(input.trade), code, input.phone.trim(), input.dayRate ?? null, input.currency ?? null, input.active],
      );
      await this.access.audit(ctx, before ? "worker_updated" : "worker_created", id, { ...input, id }, before);
      return this.crewState(ctx);
    });
  }

  /** Crew days for one project (or all the ones the person can see), newest first, with their people. */
  crewDays(actor: RequestActor, workspaceId: string, query: { projectId?: string; from?: string; to?: string }) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.assertCanSeeCrews(ctx);
      if (query.from) dateOnly(query.from);
      if (query.to) dateOnly(query.to);
      const rows = await this.dayRows(ctx, { projectId: query.projectId ?? null, from: query.from ?? null, to: query.to ?? null });
      const result = [];
      for (const row of rows)
        result.push({ ...row, canMark: await this.canMark(ctx, row.crewId, row.projectId), canDecide: await this.canDecide(ctx, row) });
      return { days: result, canSeeCosts: this.canSeeCosts(ctx) };
    });
  }

  private async dayRows(ctx: HrmsContext, filter: { id?: string; projectId: string | null; from: string | null; to: string | null }) {
    const days = (await ctx.client.query<CrewDayRow>(
      `SELECT day.id, day.crew_id AS "crewId", crew.name AS "crewName", crew.trade, day.project_id AS "projectId",
              CASE WHEN project.id IS NULL THEN NULL ELSE coalesce(project.reference || ' · ', '') || project.name END AS "projectName",
              day.work_date::text AS "workDate", day.status, day.marked_by AS "markedBy", marker.display_name AS "markedByName",
              day.marked_membership_id AS "markedMembershipId", day.capture_id AS "captureId", day.evidence, day.note, day.exception_reason AS "exceptionReason",
              day.submitted_at AS "submittedAt", decider.display_name AS "decidedByName", day.decided_at AS "decidedAt", day.decision_note AS "decisionNote", day.version
         FROM hrms_crew_days day
         JOIN hrms_crews crew ON crew.workspace_id = day.workspace_id AND crew.id = day.crew_id
         LEFT JOIN delivery_projects project ON project.workspace_id = day.workspace_id AND project.id = day.project_id
         JOIN users marker ON marker.id = day.marked_by
         LEFT JOIN users decider ON decider.id = day.decided_by
        WHERE day.workspace_id = $1 AND ($2::uuid IS NULL OR day.id = $2) AND ($3::uuid IS NULL OR day.project_id = $3)
          AND ($4::date IS NULL OR day.work_date >= $4) AND ($5::date IS NULL OR day.work_date <= $5)
        ORDER BY day.work_date DESC, crew.name LIMIT 500`,
      [ctx.workspaceId, filter.id ?? null, filter.projectId, filter.from, filter.to],
    )).rows;
    const costs = this.canSeeCosts(ctx);
    const people = (await ctx.client.query<{ crewDayId: string; workerId: string; name: string; trade: string; presence: string; overtimeHours: string; dayRate: string | null; currency: string | null }>(
      `SELECT line.crew_day_id AS "crewDayId", line.worker_id AS "workerId", worker.name, worker.trade, line.presence, line.overtime_hours::text AS "overtimeHours",
              CASE WHEN $3 THEN line.day_rate::text END AS "dayRate", CASE WHEN $3 THEN line.currency END AS currency
         FROM hrms_crew_day_workers line JOIN hrms_workers worker ON worker.workspace_id = line.workspace_id AND worker.id = line.worker_id
        WHERE line.workspace_id = $1 AND line.crew_day_id = ANY($2::uuid[]) ORDER BY lower(worker.name)`,
      [ctx.workspaceId, days.map((day) => day.id), costs],
    )).rows;
    return days.map((day) => {
      const workers = people.filter((line) => line.crewDayId === day.id).map(({ crewDayId: _day, ...line }) => line);
      return { ...day, workers, present: workers.reduce((sum, line) => sum + PRESENCE_DAYS[line.presence], 0) };
    });
  }

  private canSeeCosts(ctx: HrmsContext) {
    // Day rates are pay: people who run HR or see project costs.
    return ctx.permissions.has("hrms.manage") || ctx.permissions.has("commercial.costs.view");
  }

  private async assertCanSeeCrews(ctx: HrmsContext) {
    if (["hrms.manage", "hrms.team", "projects.manage", "projects.view"].some((code) => ctx.permissions.has(code))) return;
    const lead = await ctx.client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND lead_membership_id=$2 LIMIT 1`, [ctx.workspaceId, ctx.membershipId]);
    if (!lead.rowCount) throw new ForbiddenException("You do not have access to crews.");
  }

  /** The crew's lead, the project's managers and site supervisors, or people who run HR or projects. */
  private async canMark(ctx: HrmsContext, crewId: string, projectId: string | null) {
    if (ctx.permissions.has("hrms.manage") || ctx.permissions.has("projects.manage")) return true;
    const lead = await ctx.client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id=$1 AND id=$2 AND lead_membership_id=$3`, [ctx.workspaceId, crewId, ctx.membershipId]);
    if (lead.rowCount) return true;
    if (!projectId) return false;
    const onSite = await ctx.client.query(
      `SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND (is_manager OR 'site_supervisor' = ANY(role_keys))`,
      [ctx.workspaceId, projectId, ctx.membershipId],
    );
    return Boolean(onSite.rowCount);
  }

  /** The project's managers (or, for the workshop, people who run HR), never the person who marked it. */
  private async canDecide(ctx: HrmsContext, day: { status: string; markedBy: string; projectId: string | null }) {
    if (day.status !== "submitted" || day.markedBy === ctx.userId) return false;
    if (ctx.permissions.has("hrms.manage") || ctx.permissions.has("projects.manage")) return true;
    if (!day.projectId) return false;
    const manager = await ctx.client.query(
      `SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND is_manager`,
      [ctx.workspaceId, day.projectId, ctx.membershipId],
    );
    return Boolean(manager.rowCount);
  }

  private async today(ctx: HrmsContext) {
    const row = (await ctx.client.query<{ zone: string | null }>(`SELECT default_timezone AS zone FROM workspaces WHERE id=$1`, [ctx.workspaceId])).rows[0];
    return localDate(new Date(), row?.zone || "UTC");
  }

  /** A crew's day as a draft: who was there (a whole day, half a day or absent) and any overtime. Saving again with the same id updates it. */
  saveDay(actor: RequestActor, workspaceId: string, id: string, input: CrewDayDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      dateOnly(input.workDate);
      if (input.workDate > (await this.today(ctx))) throw new BadRequestException("A crew day can't be in the future.");
      if (!(await this.canMark(ctx, input.crewId, input.projectId ?? null)))
        throw new ForbiddenException("Only the crew's lead, or the project's managers and site supervisors, mark its day.");
      await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`hrms-crew-day:${workspaceId}:${id}`]);
      const before = (await ctx.client.query(`SELECT * FROM hrms_crew_days WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id])).rows[0];
      this.access.version(before?.version, input.version);
      if (before && !["draft", "returned"].includes(before.status)) throw new ConflictException("This crew day was already submitted.");
      const crew = (await ctx.client.query(`SELECT active FROM hrms_crews WHERE workspace_id=$1 AND id=$2`, [workspaceId, input.crewId])).rows[0];
      if (!crew?.active) throw new BadRequestException("Choose an active crew.");
      if (input.projectId) {
        const project = await ctx.client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id=$1 AND id=$2 AND status='active'`, [workspaceId, input.projectId]);
        if (!project.rowCount) throw new BadRequestException("Choose a running project.");
      }
      const ids = input.workers.map((line) => line.workerId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException("Each worker appears once.");
      if (!input.workers.some((line) => line.presence !== "absent")) throw new BadRequestException("Mark who was there.");
      const active = await ctx.client.query(`SELECT id FROM hrms_workers WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND active`, [workspaceId, ids]);
      if (active.rowCount !== ids.length) throw new BadRequestException("Choose active workers.");
      const clash = await ctx.client.query(
        `SELECT 1 FROM hrms_crew_days WHERE workspace_id=$1 AND crew_id=$2 AND work_date=$3 AND coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AND id<>$5`,
        [workspaceId, input.crewId, input.workDate, input.projectId ?? null, id],
      );
      if (clash.rowCount) throw new ConflictException("This crew already has a sheet for that day and place.");
      if (before)
        await ctx.client.query(
          `UPDATE hrms_crew_days SET crew_id=$3,project_id=$4,work_date=$5,note=$6,status='draft',version=version+1 WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, id, input.crewId, input.projectId ?? null, input.workDate, input.note.trim()],
        );
      else
        await ctx.client.query(
          `INSERT INTO hrms_crew_days(id,workspace_id,crew_id,project_id,work_date,marked_by,marked_membership_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, workspaceId, input.crewId, input.projectId ?? null, input.workDate, ctx.userId, ctx.membershipId, input.note.trim()],
        );
      await ctx.client.query(`DELETE FROM hrms_crew_day_workers WHERE workspace_id=$1 AND crew_day_id=$2`, [workspaceId, id]);
      for (const line of input.workers)
        await ctx.client.query(
          `INSERT INTO hrms_crew_day_workers(workspace_id,crew_day_id,worker_id,presence,overtime_hours) VALUES($1,$2,$3,$4,$5)`,
          [workspaceId, id, line.workerId, line.presence, line.overtimeHours],
        );
      await this.access.audit(ctx, before ? "crew_day_updated" : "crew_day_marked", id, { ...input });
      return (await this.dayRows(ctx, { id, projectId: null, from: null, to: null }))[0];
    });
  }

  /**
   * Sends the day for approval with its group photo and position. Nobody can be present more than a day
   * in total across crews and places. A missing photo, a position away from the site, a site without a
   * boundary or a day marked afterwards needs a reason; the approvers are told.
   */
  submitDay(actor: RequestActor, workspaceId: string, id: string, input: CrewDaySubmitDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const day = await this.lockDay(ctx, id);
      this.access.version(day.version, input.version);
      if (!["draft", "returned"].includes(day.status)) throw new ConflictException("This crew day was already submitted.");
      if (day.marked_by !== ctx.userId) throw new ForbiddenException("The person who marked the day submits it.");
      await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`hrms-crew-date:${workspaceId}:${day.work_date}`]);
      const over = await ctx.client.query<{ name: string }>(
        `SELECT worker.name FROM hrms_crew_day_workers line
           JOIN hrms_workers worker ON worker.workspace_id = line.workspace_id AND worker.id = line.worker_id
          WHERE line.workspace_id = $1 AND line.crew_day_id = $2 AND line.presence <> 'absent'
            AND (CASE line.presence WHEN 'half_day' THEN 0.5 ELSE 1 END) + coalesce((
              SELECT sum(CASE other.presence WHEN 'half_day' THEN 0.5 ELSE 1 END) FROM hrms_crew_day_workers other
                JOIN hrms_crew_days sheet ON sheet.workspace_id = other.workspace_id AND sheet.id = other.crew_day_id
               WHERE other.workspace_id = line.workspace_id AND other.worker_id = line.worker_id AND other.presence <> 'absent'
                 AND sheet.id <> line.crew_day_id AND sheet.work_date = $3 AND sheet.status IN ('submitted', 'approved')), 0) > 1
          ORDER BY worker.name`,
        [workspaceId, id, day.work_date],
      );
      if (over.rowCount) throw new ConflictException(`Already marked for the whole day elsewhere: ${over.rows.map((row) => row.name).join(", ")}.`);
      const settings = await this.access.settings(ctx);
      const issues: string[] = [];
      let photo = false;
      if (input.captureId) {
        const capture = (await ctx.client.query(
          `SELECT object_key, expires_at FROM hrms_captures WHERE workspace_id=$1 AND membership_id=$2 AND id=$3`,
          [workspaceId, ctx.membershipId, input.captureId],
        )).rows[0];
        if (!capture) throw new NotFoundException("Start a photo capture first.");
        const used = await ctx.client.query(
          `SELECT 1 FROM hrms_crew_days WHERE capture_id=$1 AND id<>$2 UNION ALL SELECT 1 FROM hrms_attendance_events WHERE capture_id=$1`,
          [input.captureId, id],
        );
        if (used.rowCount) throw new ConflictException("This photo was already used.");
        photo = Boolean(capture.object_key);
      }
      if (!photo) issues.push("No group photo");
      const site = day.project_id
        ? (await ctx.client.query(
            `SELECT name, latitude, longitude, radius_m AS "radiusM" FROM work_locations WHERE workspace_id=$1 AND project_id=$2 AND kind='site' AND active ORDER BY name LIMIT 1`,
            [workspaceId, day.project_id],
          )).rows[0] ?? null
        : null;
      const now = new Date();
      const arrival = locationEvidence(input.position ?? null, site, now, settings.maxGpsAccuracyM, settings.maxCaptureAgeSeconds);
      if (["missing", "outside", "uncertain"].includes(arrival.status)) issues.push(`Location ${arrival.status}`);
      if (day.project_id && !site) issues.push("Site boundary is not set up");
      if (day.work_date !== (await this.today(ctx))) issues.push("Marked on a later day");
      if (day.project_id) {
        const present = (await ctx.client.query<{ id: string }>(
          `SELECT worker_id AS id FROM hrms_crew_day_workers WHERE workspace_id=$1 AND crew_day_id=$2 AND presence <> 'absent'`, [workspaceId, id])).rows;
        const blocked = (await clearance(ctx.client, workspaceId, present.map((row) => ({ kind: "worker" as const, id: row.id })), day.work_date))
          .filter((person) => !person.cleared).map((person) => person.name);
        if (blocked.length) issues.push(`Not cleared for site: ${blocked.join(", ")}`);
      }
      const reason = input.exceptionReason.trim();
      if (issues.length && reason.length < 3)
        throw new BadRequestException({ message: "Retake the photo or give a reason.", issues });
      await ctx.client.query(
        `UPDATE hrms_crew_days SET status='submitted',capture_id=$3,evidence=$4,exception_reason=$5,submitted_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, input.captureId ?? null, { position: input.position ?? null, site, arrival, photoCaptured: photo, issues }, issues.length ? reason : ""],
      );
      await this.access.audit(ctx, "crew_day_submitted", id, { issues });
      const [row] = await this.dayRows(ctx, { id, projectId: null, from: null, to: null });
      await this.access.notify(ctx, [{
        code: "hrms.crew_day_submitted",
        users: await this.approvers(ctx, day.project_id),
        variables: { person: row.crewName, days: `${row.present} ${row.present === 1 ? "person" : "people"}`, place: row.projectName ?? "the workshop",
          dates: formatDates(row.workDate, row.workDate, await this.access.locale(ctx)), note: issues.length ? `${issues.join("; ")} — ${reason}` : "" },
        deepLink: day.project_id ? `/workspace/projects/${day.project_id}/site?crewDay=${id}` : `/workspace/hrms/crews?crewDay=${id}`,
        key: `hrms.crew_day_submitted:${id}:${row.version}`,
      }]);
      return row;
    });
  }

  /** Approve (fixing each worker's day rate) or send back with what to change; never by the person who marked it. */
  decideDay(actor: RequestActor, workspaceId: string, id: string, input: CrewDayDecisionDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const day = await this.lockDay(ctx, id);
      this.access.version(day.version, input.version);
      if (day.status !== "submitted") throw new ConflictException("This crew day isn't waiting for approval.");
      if (!(await this.canDecide(ctx, { status: day.status, markedBy: day.marked_by, projectId: day.project_id })))
        throw new ForbiddenException(day.marked_by === ctx.userId ? "Someone else approves the day you marked." : "Only the project's managers approve its crew days.");
      const note = input.note.trim();
      if (input.decision === "return" && note.length < 3) throw new BadRequestException("Say what to change.");
      if (input.decision === "approve") {
        const rates = await readTradeRates(ctx.client, workspaceId);
        const lines = (await ctx.client.query<{ workerId: string; trade: string; rate: string | null; currency: string | null }>(
          `SELECT line.worker_id AS "workerId", worker.trade, worker.day_rate::text AS rate, worker.currency
             FROM hrms_crew_day_workers line JOIN hrms_workers worker ON worker.workspace_id = line.workspace_id AND worker.id = line.worker_id
            WHERE line.workspace_id=$1 AND line.crew_day_id=$2`, [workspaceId, id])).rows;
        for (const line of lines) {
          const trade = rateOn(rates, tradeKey(line.trade), day.work_date);
          const rate = line.rate && line.currency ? { rate: line.rate, currency: line.currency } : trade ? { rate: trade.rate, currency: trade.currency } : null;
          await ctx.client.query(
            `UPDATE hrms_crew_day_workers SET day_rate=$4,currency=$5 WHERE workspace_id=$1 AND crew_day_id=$2 AND worker_id=$3`,
            [workspaceId, id, line.workerId, rate?.rate ?? null, rate?.currency ?? null],
          );
        }
      }
      await ctx.client.query(
        `UPDATE hrms_crew_days SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,version=version+1 WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id, input.decision === "approve" ? "approved" : "returned", ctx.userId, note],
      );
      await this.access.audit(ctx, "crew_day_decided", id, { decision: input.decision, note });
      const [row] = await this.dayRows(ctx, { id, projectId: null, from: null, to: null });
      const code = input.decision === "approve" ? "hrms.crew_day_approved" : "hrms.crew_day_returned";
      await this.access.notify(ctx, [{
        code, users: [day.marked_by],
        variables: { person: row.crewName, place: row.projectName ?? "the workshop", dates: formatDates(row.workDate, row.workDate, await this.access.locale(ctx)), note },
        deepLink: day.project_id ? `/workspace/projects/${day.project_id}/site?crewDay=${id}` : `/workspace/hrms/crews?crewDay=${id}`,
        key: `${code}:${id}:${row.version}`,
      }]);
      return row;
    });
  }

  private async lockDay(ctx: HrmsContext, id: string) {
    await ctx.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`hrms-crew-day:${ctx.workspaceId}:${id}`]);
    const day = (await ctx.client.query<{ status: string; version: number; marked_by: string; project_id: string | null; work_date: string }>(
      `SELECT status, version, marked_by, project_id, work_date::text AS work_date FROM hrms_crew_days WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
      [ctx.workspaceId, id],
    )).rows[0];
    if (!day) throw new NotFoundException("Crew day not found.");
    return day;
  }

  /** The project's managers; for the workshop (or a project without one), the people who run HR. */
  private async approvers(ctx: HrmsContext, projectId: string | null) {
    if (projectId) {
      const managers = await ctx.client.query<{ userId: string }>(
        `SELECT DISTINCT member.user_id AS "userId" FROM project_assignments assignment
           JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
          WHERE assignment.workspace_id=$1 AND assignment.project_id=$2 AND assignment.active AND assignment.is_manager`,
        [ctx.workspaceId, projectId],
      );
      if (managers.rowCount) return managers.rows.map((row) => row.userId);
    }
    const hr = await ctx.client.query<{ userId: string }>(
      `SELECT DISTINCT member.user_id AS "userId" FROM workspace_memberships member
         JOIN effective_member_roles role ON role.workspace_id = member.workspace_id AND role.membership_id = member.id
         JOIN role_permissions granted ON granted.role_id = role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'hrms.manage'
        WHERE member.workspace_id=$1 AND member.status='active'`,
      [ctx.workspaceId],
    );
    return hr.rows.map((row) => row.userId);
  }
}
