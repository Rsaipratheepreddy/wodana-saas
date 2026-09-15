import { commercialExecutionReady } from "./project-readiness";
import { paymentIsVerified } from "../commercial/accounting-invoice";
import { freezeHash } from "../commercial/commercial.domain";
import { previewReschedule } from "./project-reschedule";
import { notifyProject } from "./project-notifications";
import {
  validateCalendar,
  bookingSlots,
  slotsClash,
  fullCalendar,
  type BookingSlot,
} from "./project-calendar";
import type { Quote } from "../commercial/commercial.types";
import { localDate } from "../hrms/hrms-domain";
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RequestActor } from "../auth/actor";
import { HrmsAccessService, HrmsContext } from "../hrms/hrms-access.service";
import {
  applyExecution,
  emptyProject,
  obj,
  str,
  ids,
  day,
  choice,
  get,
  publicProject,
} from "./execution.domain";
import type {
  ProjectData,
  ProjectState,
  ProjectResource,
} from "./execution.types";
import { projectPortfolioSummary } from "./project-portfolio";
import { portfolioCalendarEvents, type PortfolioBookingRow } from "./project-portfolio-calendar";
import type { PortfolioCalendarQueryDto } from "./projects.dto";
import { releasedScopeLine } from "./released-scope-line";
import { adoptProjectWorkflow, ensureProjectWorkflow } from "./project-workflow";
import { resolvedProjectWorkflowTemplate } from "./project-workflow.repository";
@Injectable()
export class ExecutionService {
  constructor(private readonly access: HrmsAccessService) {}
  async row(ctx: HrmsContext, id: string, lock = false) {
    const r = await ctx.client.query(
      `SELECT p.id,p.case_id AS "caseId",p.name,p.status,party.display_name AS customer,cc.content AS commercial,(SELECT default_timezone FROM workspaces WHERE id=p.workspace_id) AS timezone FROM delivery_projects p JOIN pre_project_cases c ON c.workspace_id=p.workspace_id AND c.id=p.case_id JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id LEFT JOIN commercial_cases cc ON cc.workspace_id=p.workspace_id AND cc.case_id=p.case_id WHERE p.workspace_id=$1 AND p.id=$2 ${lock ? "FOR UPDATE OF p" : ""}`,
      [ctx.workspaceId, id],
    );
    if (!r.rowCount) throw new NotFoundException("Project not found.");
    if (!ctx.permissions.has("projects.manage")) {
      const assigned = await ctx.client.query(
        "SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active",
        [ctx.workspaceId, id, ctx.membershipId],
      );
      if (!assigned.rowCount)
        throw new ForbiddenException("You are not assigned to this project.");
    }
    return r.rows[0];
  }
  async load(ctx: HrmsContext, id: string): Promise<ProjectData> {
    const r = await ctx.client.query(
      "SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2",
      [ctx.workspaceId, id],
    );
    const stored = r.rows[0]?.content as Partial<ProjectData> | undefined;
    if (!stored) return emptyProject();
    const blank = emptyProject();
    const data = {
      ...blank,
      ...stored,
      controls: { ...blank.controls!, ...(stored.controls ?? {}) },
      roleAssignments: stored.roleAssignments ?? [],
      approvedMaterials: stored.approvedMaterials ?? [],
    } as ProjectData;
    ensureProjectWorkflow(data);
    return data;
  }
  async store(ctx: HrmsContext, id: string, d: ProjectData) {
    d.revision++;
    await ctx.client.query(
      "INSERT INTO project_execution(project_id,workspace_id,revision,content) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET revision=$3,content=$4,updated_at=now() WHERE project_execution.workspace_id=$2",
      [id, ctx.workspaceId, d.revision, JSON.stringify(d)],
    );
  }
  list(actor: RequestActor, w: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const rows = (
        await ctx.client.query(
          `SELECT p.id,p.case_id AS "caseId",p.name,party.display_name AS customer,
                  coalesce(e.content->>'phase','planning') AS phase,
                  coalesce(e.content->'scope'->>'value','0') AS value,
                  (SELECT string_agg(u.display_name,', ') FROM project_assignments a JOIN workspace_memberships m ON m.id=a.membership_id JOIN users u ON u.id=m.user_id WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.active AND a.is_manager) AS manager,
                  coalesce(e.content->'controls'->>'reference','') AS reference,
                  coalesce(e.content->'controls'->>'priority','normal') AS priority,
                  coalesce(e.content->'controls'->>'risk','on_track') AS risk,
                  coalesce((e.content->'controls'->>'onHold')::boolean,false) AS "onHold",
                  coalesce(e.content->'controls'->>'handoverDate','') AS "handoverDate",
                  coalesce(e.content->'controls'->>'nextAction','') AS "nextAction",
                  coalesce(e.content->'controls'->>'nextActionDate','') AS "nextActionDate",
                  e.content, workspace.default_timezone AS timezone
           FROM delivery_projects p
           JOIN workspaces workspace ON workspace.id=p.workspace_id
           JOIN pre_project_cases c ON c.workspace_id=p.workspace_id AND c.id=p.case_id
           JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id
           JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id
           LEFT JOIN project_execution e ON e.workspace_id=p.workspace_id AND e.project_id=p.id
           WHERE p.workspace_id=$1 AND p.status<>'archived'
             AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.membership_id=$2 AND a.active))
           ORDER BY p.created_at DESC`,
          [w, ctx.membershipId, ctx.permissions.has("projects.manage")],
        )
      ).rows as Array<Record<string, unknown> & { content?: ProjectData | null; timezone?: string }>;
      return rows.map(({ content, timezone, ...row }) => ({
        ...row,
        ...projectPortfolioSummary(content ?? emptyProject(), localDate(new Date(), timezone ?? "UTC")),
      }));
    });
  }
  portfolioCalendar(actor: RequestActor, w: string, query: PortfolioCalendarQueryDto) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const from = day(query.from, true), to = day(query.to, true);
      const days = (Date.parse(to) - Date.parse(from)) / 86400000;
      if (days < 0) throw new BadRequestException("The calendar end date must be on or after the start date.");
      if (days > 93) throw new BadRequestException("Choose a calendar range of 93 days or less.");
      const workspace = await ctx.client.query<{ timezone: string }>(
        'SELECT default_timezone AS timezone FROM workspaces WHERE id=$1',
        [w],
      );
      const bookings = await ctx.client.query<PortfolioBookingRow>(
        `SELECT booking.id, booking.project_id AS "projectId", project.name AS "projectName",
                COALESCE(NULLIF(execution.content->'controls'->>'reference',''), opportunity.title, project.name) AS "dealReference",
                party.display_name AS "clientName", booking.task_id AS "taskId",
                COALESCE((SELECT task->>'title' FROM jsonb_array_elements(COALESCE(execution.content->'tasks','[]'::jsonb)) task WHERE task->>'id'=booking.task_id LIMIT 1), 'Booked work') AS "taskTitle",
                resource.id AS "resourceId", resource.name AS "resourceName", resource.kind AS "resourceKind",
                unit.id AS "businessUnitId", unit.code AS "businessUnitCode",
                unit.name AS "businessUnitName", unit.color AS "businessUnitColor",
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id',membership.id,'name',app_user.display_name) ORDER BY app_user.display_name)
                  FROM workspace_memberships membership JOIN users app_user ON app_user.id=membership.user_id
                  WHERE membership.workspace_id=booking.workspace_id
                    AND membership.id=ANY(CASE WHEN cardinality(booking.member_ids)>0 THEN booking.member_ids ELSE resource.members END)), '[]'::jsonb) AS members,
                booking.slots, booking.acknowledgement
         FROM project_bookings booking
         JOIN delivery_projects project ON project.workspace_id=booking.workspace_id AND project.id=booking.project_id
         JOIN pre_project_cases pre_project ON pre_project.workspace_id=project.workspace_id AND pre_project.id=project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id=pre_project.workspace_id AND opportunity.id=pre_project.opportunity_id
         JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
         JOIN project_resources resource ON resource.workspace_id=booking.workspace_id AND resource.id=booking.resource_id
         LEFT JOIN business_units unit ON unit.workspace_id=resource.workspace_id AND unit.id=resource.business_unit_id
         LEFT JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
         WHERE booking.workspace_id=$1 AND booking.status='confirmed' AND project.status<>'archived'
           AND booking.ends_on >= $2::date AND booking.starts_on <= $3::date
           AND ($4::uuid IS NULL OR resource.business_unit_id=$4)
           AND ($6 OR EXISTS(SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id AND assignment.membership_id=$5 AND assignment.active))
         ORDER BY booking.starts_on, booking.id`,
        [w, from, to, query.businessUnitId ?? null, ctx.membershipId, ctx.permissions.has("projects.manage")],
      );
      const events = portfolioCalendarEvents(bookings.rows, from, to);
      const departments = await ctx.client.query<{ id: string; code: string; name: string; visibleName: string; color: string }>(
        `SELECT id,code,name,name AS "visibleName",color FROM business_units
         WHERE workspace_id=$1 AND status='active' AND ($2::uuid IS NULL OR id=$2)
         ORDER BY name`,
        [w, query.businessUnitId ?? null],
      );
      const legend = [...departments.rows];
      if (events.some((event) => event.department.id === "unassigned"))
        legend.push({ id: "unassigned", code: "UNASSIGNED", name: "Unassigned", visibleName: "Unassigned", color: "#64748B" });
      return {
        range: { from, to, timezone: workspace.rows[0]?.timezone ?? "UTC" },
        departments: legend,
        events,
        overlapCount: events.filter((event) => event.overlapIds.length > 0).length,
      };
    });
  }
  legacy(actor: RequestActor, w: string, p: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.manage");
      await this.row(ctx, p);
      return {
        imports: (
          await ctx.client.query(
            "SELECT id,content,source_hash AS hash,created_at AS imported FROM project_legacy_imports WHERE workspace_id=$1 AND project_id=$2",
            [w, p],
          )
        ).rows,
      };
    });
  }
  candidates(actor: RequestActor, w: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.manage");
      return (
        await ctx.client.query(
          `SELECT c.id,o.title,party.display_name AS customer FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id WHERE c.workspace_id=$1 AND c.status='active' AND NOT EXISTS(SELECT 1 FROM delivery_projects p WHERE p.workspace_id=c.workspace_id AND p.case_id=c.id) ORDER BY o.title`,
          [w],
        )
      ).rows;
    });
  }
  state(actor: RequestActor, w: string, id: string) {
    return this.access.run(actor, w, (ctx) => this.stateIn(ctx, id));
  }
  async stateIn(ctx: HrmsContext, id: string): Promise<ProjectState> {
    this.access.require(ctx, "projects.view", "projects.manage");
    const r = await this.row(ctx, id),
      data = await this.load(ctx, id);
    const members = (
      await ctx.client.query(
        `SELECT m.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' ORDER BY u.display_name`,
        [ctx.workspaceId],
      )
    ).rows;
    const resources = (
      await ctx.client.query(
        'SELECT id,name,kind,members,active,calendar,business_unit_id AS "businessUnitId" FROM project_resources WHERE workspace_id=$1 ORDER BY name',
        [ctx.workspaceId],
      )
    ).rows;
    const bookings = (
      await ctx.client.query(
        `SELECT b.id,b.project_id AS "projectId",p.name AS "projectName",b.task_id AS "taskId",coalesce((SELECT t->>'title' FROM project_execution e, jsonb_array_elements(e.content->'tasks') t WHERE e.project_id=b.project_id AND t->>'id'=b.task_id),'Booked work') AS "taskTitle",b.resource_id AS "resourceId",b.starts_on::text AS start,b.ends_on::text AS end,b.status,b.acknowledgement,b.slots,b.slots->0->>'startTime' AS "startTime",b.slots->0->>'endTime' AS "endTime" FROM project_bookings b JOIN delivery_projects p ON p.id=b.project_id WHERE b.workspace_id=$1 AND b.status='confirmed' ORDER BY b.starts_on`,
        [ctx.workspaceId],
      )
    ).rows;
    return {
      legacyImports: ctx.permissions.has("projects.manage")
        ? (
            await ctx.client.query(
              `SELECT id,source_project AS "sourceProject",created_at AS "createdAt" FROM project_legacy_imports WHERE workspace_id=$1 AND project_id=$2`,
              [ctx.workspaceId, id],
            )
          ).rows
        : [],
      notifications: (
        await ctx.client.query(
          `SELECT id,subject,body,deep_link AS "deepLink",read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' AND deep_link LIKE $3 ORDER BY created_at DESC LIMIT 50`,
          [ctx.workspaceId, ctx.userId, `/workspace/projects/${id}/%`],
        )
      ).rows,
      workspaceId: ctx.workspaceId,
      id,
      caseId: r.caseId,
      name: r.name,
      customer: r.customer,
      data,
      members,
      resources,
      bookings: ctx.permissions.has("projects.manage")
        ? bookings
        : bookings.filter((b) => b.projectId === id),
      memberId: ctx.membershipId,
      canManage: ctx.permissions.has("projects.manage"),
      canReview: ctx.permissions.has("projects.review"),
      canReport:
        ctx.permissions.has("projects.report") ||
        ctx.permissions.has("projects.manage"),
      canBuy: ctx.permissions.has("projects.buy"),
      commercialReady: commercialExecutionReady(r.commercial),
      timezone: r.timezone ?? "UTC",
      today: localDate(new Date(), r.timezone ?? "UTC"),
    };
  }
  command(actor: RequestActor, w: string, id: string, input: unknown) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const b = obj(input),
        action = str(b.action, 60, true),
        retry = str(b.requestId, 80, true);
      if (!/^[\w-]{16,80}$/.test(retry))
        throw new BadRequestException("Use a stable request identifier.");
      const row = await this.row(ctx, id, true),
        d = await this.load(ctx, id);
      let changedRecordId = str(b.id, 80);
      if (d.processed.includes(retry)) return { data: d };
      if (b.revision !== d.revision)
        throw new ConflictException(
          "This project changed. Refresh and review before saving.",
        );
      if (
        d.phase === "completed" &&
        ![
          "comment",
          "comment_status",
          "edit_comment",
          "reopen_project",
          "warranty_snag",
          "snag_status",
          "notification_read",
          "follow",
          "retention_status",
          "publish_report",
          "unpublish_report",
          "publish_document",
        ].includes(action)
      )
        throw new ConflictException(
          "Reopen the completed project with a reason before changing it.",
        );
      // Workspace lock serializes allocations across all projects and membership overlaps.
      if (
        [
          "reschedule",
          "booking",
          "cancel_booking",
          "resource",
          "task",
          "task_status",
        ].includes(action)
      )
        await ctx.client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`project-capacity:${w}`],
        );
      const members = (
        await ctx.client.query(
          `SELECT m.id,u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active'`,
          [w],
        )
      ).rows;
      const resources = (
      await ctx.client.query(
          'SELECT id,name,kind,members,active,calendar,business_unit_id AS "businessUnitId" FROM project_resources WHERE workspace_id=$1',
          [w],
        )
      ).rows as ProjectResource[];
      const name =
        members.find((m) => m.id === ctx.membershipId)?.name ??
        "Project member";
      if (action === "notification_read") {
        const result = await ctx.client.query(
          "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE workspace_id=$1 AND id=$2 AND recipient_type='user' AND recipient_id=$3 AND deep_link LIKE $4 RETURNING id",
          [w, str(b.id, 80, true), ctx.userId, `/workspace/projects/${id}/%`],
        );
        if (!result.rowCount) throw new NotFoundException("Update not found.");
      } else if (action === "reschedule") {
        this.access.require(ctx, "projects.manage");
        let changes;
        try {
          changes = previewReschedule(
            d.tasks,
            resources,
            str(b.taskId, 80, true),
            day(b.start, true),
          );
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }
        if (JSON.stringify(changes) !== JSON.stringify(b.expectedChanges))
          throw new ConflictException(
            "The schedule preview changed. Review the latest impact before applying.",
          );
        if (!changes.length)
          throw new BadRequestException(
            "The forecast is already on these dates.",
          );
        const bookings = await ctx.client.query(
          "SELECT task_id FROM project_bookings WHERE workspace_id=$1 AND project_id=$2 AND task_id=ANY($3::text[]) AND status='confirmed'",
          [w, id, changes.map((c) => c.id)],
        );
        if (bookings.rowCount && b.releaseBookings !== true)
          throw new ConflictException(
            "Confirm release of the affected bookings before moving their dates. Rebook the work after reviewing availability.",
          );
        str(b.note, 3000, true);
        await ctx.client.query(
          "UPDATE project_bookings SET status='cancelled' WHERE workspace_id=$1 AND project_id=$2 AND task_id=ANY($3::text[]) AND status='confirmed'",
          [w, id, changes.map((c) => c.id)],
        );
        for (const change of changes) {
          const task = get(d.tasks, change.id);
          task.start = change.start;
          task.end = change.end;
          d.audit.push({
            id: randomUUID(),
            at: new Date().toISOString(),
            author: name,
            action: "reschedule",
            recordId: task.id,
            note: `${change.fromStart}–${change.fromEnd} → ${change.start}–${change.end}. ${str(b.note, 3000)}`,
          });
        }
      } else if (action === "sync_variations") {
        this.access.require(ctx, "projects.manage");
        if (!d.scope)
          throw new ConflictException("Release the original BOQ first.");
        d.variations ??= [];
        const changes = (row.commercial?.quotes ?? []).filter(
          (q: Quote) =>
            q.kind === "variation" &&
            q.status === "accepted" &&
            !d.variations!.some((v) => v.quoteId === q.id),
        ) as Quote[];
        for (const q of changes) {
          const variationHash = freezeHash(q);
          if (q.hash && q.hash !== variationHash)
            throw new ConflictException(
              `Accepted variation V${q.number} changed after client acceptance. Issue a new variation before release.`,
            );
          if (
            row.commercial.payments.some(
              (p: {
                sourceQuoteId?: string;
                requiredForRelease: boolean;
                status: string;
                invoice?: {
                  accountId?: string;
                  balance: number;
                  refreshedAt: string;
                  lastError?: string;
                };
              }) =>
                p.sourceQuoteId === q.id &&
                p.requiredForRelease &&
                !paymentIsVerified(p),
            )
          )
            throw new ConflictException(
              `Verify the required payment for variation V${q.number} before releasing its work.`,
            );
          if (q.currency !== d.scope.currency)
            throw new ConflictException(
              "Variation currency must match the original agreement.",
            );
          const used = new Set(
            [...d.scope.lines, ...d.variations.flatMap((v) => v.lines)].map(
              (l) => l.id,
            ),
          );
          if (q.lines.some((l) => used.has(l.id)))
            throw new ConflictException(
              "Variation items need distinct line identities. Review the scope before release.",
            );
          if (q.direction === "deduction") {
            const affected = d.tasks.filter((t) =>
              q.lines.some(
                (l) => l.deductsLineId && t.scopeIds.includes(l.deductsLineId),
              ),
            );
            if (
              affected.some(
                (t) =>
                  t.approved > 0 ||
                  d.reports.some(
                    (r) =>
                      r.status === "submitted" &&
                      r.entries.some((e) => e.taskId === t.id),
                  ),
              )
            )
              throw new ConflictException(
                "Review completed or submitted work before deducting its scope. Use the commercial credit record to reconcile already performed work.",
              );
            if (
              d.orders.some(
                (o) =>
                  affected.some((t) => t.id === o.taskId) &&
                  !["enquiry", "draft", "cancelled"].includes(o.status),
              )
            )
              throw new ConflictException(
                "Reconcile affected supplier commitments before releasing the scope deduction.",
              );
            for (const task of affected) {
              task.status = "blocked";
              task.readiness.scope = false;
              task.blocker = `Accepted deduction V${q.number}. Review remaining scope and quantities.`;
            }
          }
          d.variations.push({
            quoteId: q.id,
            quoteHash: variationHash,
            currency: q.currency,
            releasedAt: new Date().toISOString(),
            number: q.number,
            direction: q.direction,
            value: q.direction === "deduction" ? -q.total : q.total,
            lines: q.lines.map(releasedScopeLine),
          });
        }
        d.audit.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          author: name,
          action,
          recordId: "",
          note: `${changes.length} accepted variations released to planning`,
        });
      } else if (["booking", "cancel_booking", "resource"].includes(action)) {
        this.access.require(ctx, "projects.manage");
        if (action === "resource") {
          const v = obj(b.resource),
            rid = str(v.id, 80) || randomUUID();
          if (!/^[0-9a-f-]{36}$/i.test(rid))
            throw new BadRequestException("Invalid resource.");
          const memberIds = ids(v.members);
          if (memberIds.some((id) => !members.some((m) => m.id === id)))
            throw new BadRequestException("Choose active team members.");
          const current = resources.find((r) => r.id === rid);
          const businessUnitId = v.businessUnitId === undefined
            ? (current?.businessUnitId ?? null)
            : str(v.businessUnitId, 36) || null;
          if (businessUnitId && !/^[0-9a-f-]{36}$/i.test(businessUnitId))
            throw new BadRequestException("Choose a valid department.");
          if (businessUnitId && !(await ctx.client.query(
            "SELECT 1 FROM business_units WHERE workspace_id=$1 AND id=$2 AND status='active'",
            [w, businessUnitId],
          )).rowCount)
            throw new BadRequestException("Choose an active department.");
          if (
            current &&
            (
              await ctx.client.query(
                "SELECT 1 FROM project_bookings WHERE workspace_id=$1 AND resource_id=$2 AND status='confirmed' AND ends_on>=CURRENT_DATE",
                [w, rid],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Resolve future bookings before changing this resource or its members.",
            );
          const kind = choice(v.kind, ["crew", "person", "factory", "vendor"]);
          if (["crew", "person"].includes(kind) && !memberIds.length)
            throw new BadRequestException(
              "Choose the members so team clashes can be checked.",
            );
          await ctx.client.query(
            "INSERT INTO project_resources(id,workspace_id,name,kind,members,active,calendar,business_unit_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$3,kind=$4,members=$5,active=$6,calendar=$7,business_unit_id=$8 WHERE project_resources.workspace_id=$2",
            [
              rid,
              w,
              str(v.name, 160, true),
              kind,
              memberIds,
              v.active !== false,
              v.calendar
                ? JSON.stringify(validateCalendar(v.calendar))
                : (current?.calendar ?? null),
              businessUnitId,
            ],
          );
        } else {
          const task = get(d.tasks, b.taskId);
          if (action === "cancel_booking") {
            await ctx.client.query(
              "UPDATE project_bookings SET status='cancelled' WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND status='confirmed'",
              [w, id, task.id],
            );
          } else {
            if (task.status === "cancelled" || task.status === "completed")
              throw new ConflictException("Book only active planned work.");
            const resource = resources.find(
              (r) => r.id === task.resourceId && r.active,
            );
            if (!resource)
              throw new BadRequestException(
                "Assign an active team or factory first.",
              );
            const acknowledgement = str(b.note, 3000);
            if (resource.kind === "vendor" && !acknowledgement)
              throw new ConflictException(
                "Record the external factory or vendor acknowledgement before booking.",
              );
            const employeeCalendars = (
              await ctx.client.query(
                `SELECT e.membership_id,e.enabled,e.active_from::text,e.active_to::text,c.working_days,c.holidays::text[],c.day_start::text,c.day_end::text,c.timezone FROM hrms_employees e JOIN hrms_calendars c ON c.workspace_id=e.workspace_id AND c.id=e.calendar_id WHERE e.workspace_id=$1 AND e.membership_id=ANY($2::uuid[])`,
                [w, resource.members],
              )
            ).rows;
            let calendar = resource.calendar ?? fullCalendar;
            if (!resource.calendar && employeeCalendars.length) {
              calendar = {
                weekdays: fullCalendar.weekdays.filter((n) =>
                  employeeCalendars.every((c) => c.working_days.includes(n)),
                ),
                startTime: employeeCalendars
                  .map((c) => c.day_start.slice(0, 5))
                  .sort()
                  .at(-1)!,
                endTime: employeeCalendars
                  .map((c) => c.day_end.slice(0, 5))
                  .sort()[0],
                holidays: [
                  ...new Set(
                    employeeCalendars.flatMap((c) => c.holidays as string[]),
                  ),
                ].map((date) => ({
                  date,
                  reason: "Employee non-working date",
                })),
              };
            }
            const slots = bookingSlots(
              task.start,
              task.end,
              calendar,
              b.startTime ? str(b.startTime, 5) : undefined,
              b.endTime ? str(b.endTime, 5) : undefined,
            );
            for (const c of employeeCalendars) {
              if (
                !c.enabled ||
                slots.some(
                  (s) =>
                    s.date < c.active_from ||
                    (c.active_to && s.date > c.active_to),
                )
              )
                throw new ConflictException(
                  "A resource member is not active for these working dates.",
                );
              if (c.timezone !== (row.timezone ?? "UTC"))
                throw new ConflictException(
                  "Review the employee and project timezone mapping before booking this crew.",
                );
              if (
                slots.some(
                  (s) =>
                    !c.working_days.includes(new Date(s.date).getUTCDay()) ||
                    c.holidays.includes(s.date) ||
                    s.startTime < c.day_start.slice(0, 5) ||
                    s.endTime > c.day_end.slice(0, 5),
                )
              ) {
                if (b.calendarOverride !== true || !str(b.note, 3000))
                  throw new ConflictException(
                    "These hours conflict with an employee calendar. Review the exception and record the approved overtime instruction.",
                  );
              }
            }

            const clashes = await ctx.client.query(
              `SELECT p.name,b.starts_on::text AS start,b.ends_on::text AS end,b.slots FROM project_bookings b JOIN delivery_projects p ON p.id=b.project_id WHERE b.workspace_id=$1 AND b.status='confirmed' AND b.starts_on<=$4::date AND b.ends_on>=$3::date AND (b.resource_id=$2 OR b.member_ids && $5::uuid[]) AND NOT(b.project_id=$6 AND b.task_id=$7)`,
              [
                w,
                resource.id,
                task.start,
                task.end,
                resource.members,
                id,
                task.id,
              ],
            );
            const conflicts = clashes.rows.filter((c) =>
              slotsClash(
                slots,
                c.slots?.length ? c.slots : bookingSlots(c.start, c.end),
              ),
            );
            if (conflicts.length)
              throw new ConflictException(
                `Booking clash: ${conflicts.map((c) => `${c.name} (${c.start}–${c.end})`).join(", ")}. Choose another resource or dates.`,
              );
            if (resource.members.length) {
              const leave = await ctx.client.query(
                `SELECT start_date::text AS start,end_date::text AS end,units,calendar_snapshot FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=ANY($2::uuid[]) AND status IN ('approved','cancellation_pending') AND start_date<=$4::date AND end_date>=$3::date`,
                [w, resource.members, task.start, task.end],
              );
              if (
                leave.rows.some((l) =>
                  slots.some((s) =>
                    Array.isArray(l.units) && l.units.length
                      ? l.units.some(
                          (u: { date: string; part: string }) =>
                            u.date === s.date &&
                            (u.part === "first_half"
                              ? s.startTime <
                                (l.calendar_snapshot.halfDay ?? "24:00").slice(
                                  0,
                                  5,
                                )
                              : s.endTime >
                                (l.calendar_snapshot.halfDay ?? "00:00").slice(
                                  0,
                                  5,
                                )),
                        )
                      : s.date >= l.start && s.date <= l.end,
                  ),
                )
              )
                throw new ConflictException(
                  "A team member has approved leave during these dates.",
                );
            }
            await ctx.client.query(
              "UPDATE project_bookings SET status='cancelled' WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND status='confirmed'",
              [w, id, task.id],
            );
            await ctx.client.query(
              "INSERT INTO project_bookings(workspace_id,project_id,task_id,resource_id,starts_on,ends_on,status,acknowledgement,member_ids,slots) VALUES($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9)",
              [
                w,
                id,
                task.id,
                resource.id,
                task.start,
                task.end,
                acknowledgement,
                resource.members,
                JSON.stringify(slots),
              ],
            );
          }
        }
        d.audit.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          author: name,
          action,
          recordId: str(b.taskId, 80),
          note: str(b.note, 3000),
        });
      } else {
        if (
          action === "complete_project" &&
          (
            await ctx.client.query(
              `SELECT 1 FROM project_stock_transfers WHERE workspace_id=$1 AND (content->'source'->>'id'=$2::text OR content->'destination'->>'id'=$2::text) AND (content->>'status' NOT IN ('received','cancelled') OR (content->>'status'='received' AND content->>'rejectionResolved'='false'))`,
              [w, id],
            )
          ).rowCount
        )
          throw new ConflictException(
            "Receive or cancel open stock transfers and resolve rejected stock before completion.",
          );
        if (
          action === "commercial" &&
          b.financeClosed === true &&
          row.commercial?.credits?.some(
            (c: { status: string }) => c.status !== "verified",
          )
        )
          throw new ConflictException(
            "Reconcile accepted client credits before closing the final account.",
          );
        if (
          (action === "complete_project" ||
            (action === "commercial" && b.financeClosed === true)) &&
          row.commercial?.payments?.some(
            (payment: Parameters<typeof paymentIsVerified>[0]) =>
              !paymentIsVerified(payment),
          )
        )
          throw new ConflictException(
            "Reconcile outstanding customer payment milestones in Agreement & payments before financial closure. Physical handover can remain accepted.",
          );
        if (action === "comment" && ids(b.mentions).length) {
          const allowed = (
            await ctx.client.query(
              "SELECT membership_id FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND active AND membership_id=ANY($3::uuid[])",
              [w, id, ids(b.mentions)],
            )
          ).rows;
          if (allowed.length !== ids(b.mentions).length)
            throw new BadRequestException(
              "Mention only people assigned to this project. Assign their project work first.",
            );
        }
        if (action === "material") {
          const material = obj(b.material);
          if (material.catalogId) {
            const selected = (
              await ctx.client.query(
                `SELECT r.version,r.kind FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=$2 AND NOT r.archived AND NOT c.archived`,
                [w, str(material.catalogId, 80)],
              )
            ).rows[0];
            if (
              !selected ||
              selected.version !== material.catalogVersion ||
              !["material", "sku", "hardware", "consumable"].includes(
                selected.kind,
              )
            )
              throw new ConflictException(
                "The catalog material changed or is unavailable. Select its current version.",
              );
          }
        }
        if (action === "task") {
          const v = obj(b.task);
          const crew = resources.find((r) => r.id === v.resourceId);
          if (crew)
            v.assigneeIds = [
              ...new Set([...ids(v.assigneeIds), ...crew.members]),
            ];
          const old = d.tasks.find((t) => t.id === v.id);
          if (
            old &&
            (old.start !== v.start ||
              old.end !== v.end ||
              old.resourceId !== v.resourceId) &&
            (
              await ctx.client.query(
                "SELECT 1 FROM project_bookings WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND status='confirmed'",
                [w, id, old.id],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Release the existing booking before rescheduling or reassigning this task.",
            );
        }
        if (action === "task_status" && b.status === "in_progress") {
          this.access.require(ctx, "projects.manage");
          const t = get(d.tasks, b.id);
          if(t.location!=="office"&&!t.resourceId)throw new ConflictException("Assign a crew or factory and confirm its booking before starting work.");
          if (t.location === "factory") {
            const resource = resources.find((r) => r.id === t.resourceId),
              orders = d.orders.filter(
                (o) =>
                  o.taskId === t.id &&
                  o.kind === "factory" &&
                  o.status !== "cancelled",
              );
            if (!resource?.active)
              throw new ConflictException(
                "Assign an active workshop or outside factory before starting manufacturing.",
              );
            if (
              (resource.kind === "vendor" || orders.length > 0) &&
              (!orders.some((o) =>
                ["acknowledged", "closed"].includes(o.status),
              ) ||
                orders
                  .filter((o) => o.status !== "enquiry")
                  .some((o) => !["acknowledged", "closed"].includes(o.status)))
            )
              throw new ConflictException(
                "Confirm the linked factory order and delivery dates before starting manufacturing.",
              );
          }
          if (
            t.resourceId &&
            !(
              await ctx.client.query(
                "SELECT 1 FROM project_bookings WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND status='confirmed'",
                [w, id, t.id],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Confirm the assigned resource booking first.",
            );
        }
        changedRecordId = applyExecution(d, action, b, {
          id: ctx.membershipId,
          userId: ctx.userId,
          name,
          manage: ctx.permissions.has("projects.manage"),
          review: ctx.permissions.has("projects.review"),
          report: ctx.permissions.has("projects.report"),
          buy: ctx.permissions.has("projects.buy"),
          memberIds: members.map((m) => m.id),
          resourceIds: resources.filter((r) => r.active).map((r) => r.id),
          now: new Date().toISOString(),
          released: commercialExecutionReady(row.commercial),
          today: localDate(new Date(), row.timezone ?? "UTC"),
        });
        if (
          action === "handover_status" &&
          d.phase === "handover" &&
          row.commercial?.payments?.some(
            (payment: Parameters<typeof paymentIsVerified>[0]) =>
              !paymentIsVerified(payment),
          )
        )
          d.phase = "active";
      }
      if (action === "task") {
        const t = obj(b.task);
        for (const memberId of [
          ...new Set([str(t.ownerId, 80), ...ids(t.assigneeIds)]),
        ].filter(Boolean))
          await ctx.client.query(
            `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,false) ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active=true`,
            [w, id, memberId],
          );
      }
      if (
        [
          "technical_query",
          "commissioning",
          "snag",
          "warranty_snag",
          "milestone",
        ].includes(action)
      ) {
        const value = obj(b.record ?? b.snag ?? b.milestone);
        if (value.ownerId)
          await ctx.client.query(
            `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,false) ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active=true`,
            [w, id, str(value.ownerId, 80, true)],
          );
      }
      if (action === "task_status" && b.status === "cancelled")
        await ctx.client.query(
          "UPDATE project_bookings SET status='cancelled' WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3",
          [w, id, b.id],
        );
      if (action === "complete_project")
        await ctx.client.query(
          "UPDATE delivery_projects SET status='completed',version=version+1 WHERE workspace_id=$1 AND id=$2",
          [w, id],
        );
      if (action === "reopen_project")
        await ctx.client.query(
          "UPDATE delivery_projects SET status='active',version=version+1 WHERE workspace_id=$1 AND id=$2",
          [w, id],
        );
      await notifyProject(ctx, id, row.name, d, action, changedRecordId, retry);
      d.processed.push(retry);
      await this.store(ctx, id, d);
      await this.access.audit(ctx, `project_${action}`, id, {
        recordId: b.id ?? "",
        revision: d.revision,
      });
      return { data: d };
    });
  }
  planning(actor: RequestActor, w: string, input: unknown) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.manage");
      const caseId = str(obj(input).caseId, 80, true);
      const r = await ctx.client.query(
        `SELECT c.id,c.status,o.title,(SELECT display_name FROM users WHERE id=$3) AS planner FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id WHERE c.workspace_id=$1 AND c.id=$2 FOR UPDATE OF c`,
        [w, caseId, ctx.userId],
      );
      if (!r.rowCount) throw new NotFoundException("Pre-execution not found.");
      const existing = await ctx.client.query(
        "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2",
        [w, caseId],
      );
      if (existing.rowCount) return existing.rows[0];
      if (r.rows[0].status !== "active")
        throw new ConflictException("Choose an active pre-execution.");
      const p = (
        await ctx.client.query(
          "INSERT INTO delivery_projects(workspace_id,case_id,name,created_by) VALUES($1,$2,$3,$4) RETURNING id",
          [w, caseId, r.rows[0].title, ctx.userId],
        )
      ).rows[0];
      await ctx.client.query(
        "INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,true)",
        [w, p.id, ctx.membershipId],
      );
      const project = emptyProject();
      project.controls!.reference = `PRJ-PLAN-${new Date().getUTCFullYear()}-${p.id.slice(0, 8).toUpperCase()}`;
      project.workflow = adoptProjectWorkflow(
        await resolvedProjectWorkflowTemplate(ctx.client, w),
        new Date().toISOString(),
        ctx.userId,
        r.rows[0].planner ?? "Project planner",
      );
      await this.store(ctx, p.id, project);
      return p;
    });
  }
}
