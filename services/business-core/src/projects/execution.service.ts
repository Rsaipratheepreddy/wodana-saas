import { commercialExecutionReady } from "./project-readiness";
import { paymentIsVerified } from "../commercial/accounting-invoice";
import {
  financeGatePaymentsReady,
  variationReleasePaymentsReady,
} from "../commercial/release-integrity";
import {
  acceptedVariationsToRelease,
  acceptedVariationSnapshotIsCurrent,
  controlledChangeCanRelease,
} from "../commercial/change-control";
import { freezeHash } from "../commercial/commercial.domain";
import { previewReschedule } from "./project-reschedule";
import { ProjectNotificationsService } from "./project-notifications";
import {
  validateCalendar,
  calendarContainsSlot,
  bookingSlots,
  slotsClash,
  fullCalendar,
  type BookingSlot,
} from "./project-calendar";
import type { CommercialData, Quote } from "../commercial/commercial.types";
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
import { capacityConfiguration, exceedsPooledCapacity } from "./project-schedule-capacity";
import { projectScheduleItems } from "./project-schedule-items";
import type { PortfolioCalendarQueryDto } from "./projects.dto";
import { releasedScopeLine } from "./released-scope-line";
import { adoptProjectWorkflow, ensureProjectWorkflow } from "./project-workflow";
import { resolvedProjectWorkflowTemplate } from "./project-workflow.repository";
import { blockWorkPackagesForDeduction, syncScopeWorkPackages } from "./project-work-packages";
import { projectExecutionPulse } from "./project-execution-pulse";
import { projectConnectedPlan } from "./project-connected-plan";
import {
  projectFieldCommand,
  projectFieldProject,
  type ProjectFieldPermissions,
} from "./project-field-work";
import {
  captureApprovedDesignBaseline,
  mergeDesignBaseline,
  synchroniseApprovedDesignDocuments,
} from "./project-design-control";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { projectExecutionEvents } from "./project-execution-events";
@Injectable()
export class ExecutionService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly projectNotifications: ProjectNotificationsService,
    private readonly events: CrmEventsService,
  ) {}
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
      workPackages: stored.workPackages ?? [],
    } as ProjectData;
    data.workPackages = (data.workPackages ?? []).map((workPackage) => ({
      ...workPackage,
      predecessorPackageIds: workPackage.predecessorPackageIds ?? [],
      priority: workPackage.priority ?? "normal",
      risk: workPackage.risk ?? "on_track",
      nextAction: workPackage.nextAction ?? "",
      nextActionOwnerId: workPackage.nextActionOwnerId ?? "",
      nextActionDate: workPackage.nextActionDate ?? "",
      recoveryPlan: workPackage.recoveryPlan ?? "",
    }));
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
      const canSeeAll = ctx.permissions.has("projects.manage")
        || ctx.permissions.has("projects.schedule.view")
        || ctx.permissions.has("projects.schedule.manage");
      const bookings = await ctx.client.query<PortfolioBookingRow>(
        `SELECT booking.id, booking.project_id AS "projectId", project.name AS "projectName",
                COALESCE(NULLIF(execution.content->'controls'->>'reference',''), opportunity.title, project.name) AS "dealReference",
                party.display_name AS "clientName", booking.task_id AS "taskId",
                COALESCE((SELECT task->>'title' FROM jsonb_array_elements(COALESCE(execution.content->'tasks','[]'::jsonb)) task WHERE task->>'id'=booking.task_id LIMIT 1), 'Booked work') AS "taskTitle",
                resource.id AS "resourceId", resource.name AS "resourceName", resource.kind AS "resourceKind",
                unit.id AS "businessUnitId", unit.code AS "businessUnitCode",
                unit.name AS "businessUnitName", unit.color AS "businessUnitColor",
                booking.status,booking.units::float8 AS units,
                resource.capacity_mode AS "capacityMode",resource.capacity::float8 AS capacity,
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
         WHERE booking.workspace_id=$1
           AND (($7::text='active' AND booking.status IN ('tentative','confirmed')) OR booking.status=$7::varchar)
           AND project.status<>'archived'
           AND booking.ends_on >= $2::date AND booking.starts_on <= $3::date
           AND ($4::uuid IS NULL OR resource.business_unit_id=$4)
           AND ($8::uuid IS NULL OR resource.id=$8)
           AND ($9::uuid IS NULL OR project.id=$9)
           AND ($10::uuid IS NULL OR $10=ANY(booking.member_ids))
           AND ($11='' OR concat_ws(' ',project.name,opportunity.title,party.display_name,resource.name,unit.name) ILIKE '%'||$11||'%')
           AND ($6
             OR $5=ANY(booking.member_ids)
             OR EXISTS(SELECT 1 FROM project_assignments assignment
               WHERE assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id
                 AND assignment.membership_id=$5 AND assignment.active AND assignment.is_manager)
             OR EXISTS(SELECT 1 FROM workspace_team_members lead
               JOIN workspace_teams team ON team.workspace_id=lead.workspace_id AND team.id=lead.team_id
               WHERE lead.workspace_id=booking.workspace_id AND lead.membership_id=$5 AND lead.is_lead
                 AND team.status='active' AND team.business_unit_id=resource.business_unit_id))
         ORDER BY booking.starts_on, booking.id`,
        [w, from, to, query.businessUnitId ?? null, ctx.membershipId, canSeeAll,
          query.bookingStatus ?? "confirmed", query.resourceId ?? null, query.projectId ?? null,
          query.memberId ?? null, query.search?.trim() ?? ""],
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
      const managedProjects = canSeeAll ? [] : (await ctx.client.query<{ projectId: string }>(
        `SELECT project_id AS "projectId" FROM project_assignments
         WHERE workspace_id=$1 AND membership_id=$2 AND active AND is_manager`,
        [w, ctx.membershipId],
      )).rows.map((row) => row.projectId);
      const ledDepartments = canSeeAll ? [] : (await ctx.client.query<{ businessUnitId: string }>(
        `SELECT DISTINCT team.business_unit_id AS "businessUnitId"
         FROM workspace_team_members member
         JOIN workspace_teams team ON team.workspace_id=member.workspace_id AND team.id=member.team_id
         WHERE member.workspace_id=$1 AND member.membership_id=$2 AND member.is_lead AND team.status='active'`,
        [w, ctx.membershipId],
      )).rows.map((row) => row.businessUnitId);
      let items: Array<Record<string, unknown>> = [];
      if (canSeeAll || managedProjects.length || ledDepartments.length) {
        const scheduleResources = (await ctx.client.query(
          `SELECT resource.id,resource.name,resource.kind,resource.members,resource.active,resource.calendar,
                  resource.business_unit_id AS "businessUnitId",
                  CASE WHEN unit.id IS NULL THEN NULL ELSE jsonb_build_object(
                    'id',unit.id,'code',unit.code,'name',unit.name,'visibleName',unit.name,'color',unit.color
                  ) END AS department
           FROM project_resources resource
           LEFT JOIN business_units unit ON unit.workspace_id=resource.workspace_id AND unit.id=resource.business_unit_id
           WHERE resource.workspace_id=$1`,
          [w],
        )).rows;
        const scheduleProjects = (await ctx.client.query(
          `SELECT project.id,project.name,
                  COALESCE(NULLIF(execution.content->'controls'->>'reference',''),opportunity.title,project.name) AS "dealReference",
                  party.display_name AS "clientName",execution.content AS data
           FROM delivery_projects project
           JOIN pre_project_cases pre_project ON pre_project.workspace_id=project.workspace_id AND pre_project.id=project.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id=pre_project.workspace_id AND opportunity.id=pre_project.opportunity_id
           JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
           JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
           WHERE project.workspace_id=$1 AND project.status<>'archived'
             AND ($2 OR project.id=ANY($3::uuid[]) OR cardinality($4::uuid[])>0)`,
          [w, canSeeAll, managedProjects, ledDepartments],
        )).rows;
        items = scheduleProjects.flatMap((project) => projectScheduleItems(project, scheduleResources, from, to))
          .filter((item) => canSeeAll || managedProjects.includes(String(item.projectId))
            || (item.department && ledDepartments.includes(String(item.department.id))));
        const visitProjects = canSeeAll ? null : managedProjects;
        if (canSeeAll || managedProjects.length) {
          const visits = (await ctx.client.query(
            `SELECT 'site_visit:'||visit.id AS id,'site_visit' AS kind,'pre_project' AS source,
                    project.id AS "projectId",project.name AS "projectName",
                    COALESCE(NULLIF(execution.content->'controls'->>'reference',''),opportunity.title,project.name) AS "dealReference",
                    party.display_name AS "clientName",visit.title,visit.status,
                    visit.content->>'scheduledAt' AS "startsAt",visit.content->>'timezone' AS timezone,
                    COALESCE((visit.content->>'durationMinutes')::int,60) AS "durationMinutes",
                    ((visit.content->>'scheduledAt')::timestamptz AT TIME ZONE workspace.default_timezone)::date::text AS date,
                    NULL::jsonb AS department
             FROM pre_project_site_records visit
             JOIN delivery_projects project ON project.workspace_id=visit.workspace_id AND project.case_id=visit.case_id
             JOIN workspaces workspace ON workspace.id=project.workspace_id
             JOIN pre_project_cases pre_project ON pre_project.workspace_id=project.workspace_id AND pre_project.id=project.case_id
             JOIN crm_opportunities opportunity ON opportunity.workspace_id=pre_project.workspace_id AND opportunity.id=pre_project.opportunity_id
             JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
             LEFT JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
             WHERE visit.workspace_id=$1 AND visit.kind='visit' AND visit.status<>'cancelled'
               AND visit.content->>'scheduledAt' IS NOT NULL
               AND ((visit.content->>'scheduledAt')::timestamptz AT TIME ZONE workspace.default_timezone)::date BETWEEN $2::date AND $3::date
               AND ($4::uuid[] IS NULL OR project.id=ANY($4::uuid[]))`,
            [w, from, to, visitProjects],
          )).rows.map((visit) => ({
            ...visit,
            allDay: false,
            title: [visit.dealReference, visit.clientName, visit.title].filter(Boolean).join(" — "),
          }));
          items.push(...visits);
        }
      }
      return {
        range: { from, to, timezone: workspace.rows[0]?.timezone ?? "UTC" },
        departments: legend,
        events,
        overlapCount: events.filter((event) => event.overlapIds.length > 0).length,
        conflictCount: events.filter((event) => event.conflictIds.length > 0).length,
        items: items.sort((left, right) => `${left.date}:${left.kind}`.localeCompare(`${right.date}:${right.kind}`)),
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
  fieldQueue(actor: RequestActor, w: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const permissions: ProjectFieldPermissions = {
        manage: ctx.permissions.has("projects.manage"),
        review: ctx.permissions.has("projects.review"),
        report:
          ctx.permissions.has("projects.report") ||
          ctx.permissions.has("projects.manage"),
        buy: ctx.permissions.has("projects.buy"),
      };
      const projects = (
        await ctx.client.query<{ id: string; name: string; customer: string }>(
          `SELECT project.id,project.name,party.display_name AS customer
             FROM delivery_projects project
             JOIN pre_project_cases pre_project ON pre_project.workspace_id=project.workspace_id AND pre_project.id=project.case_id
             JOIN crm_opportunities opportunity ON opportunity.workspace_id=pre_project.workspace_id AND opportunity.id=pre_project.opportunity_id
             JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
            WHERE project.workspace_id=$1 AND project.status IN ('active','completed')
              AND ($3 OR EXISTS(SELECT 1 FROM project_assignments assignment
                   WHERE assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id
                     AND assignment.membership_id=$2 AND assignment.active))
            ORDER BY project.name,project.id`,
          [w, ctx.membershipId, permissions.manage],
        )
      ).rows;
      const projectMembers = projects.length
        ? (
            await ctx.client.query<{
              projectId: string;
              id: string;
              name: string;
            }>(
              `SELECT assignment.project_id AS "projectId",membership.id,user_account.display_name AS name
                 FROM project_assignments assignment
                 JOIN workspace_memberships membership
                   ON membership.workspace_id=assignment.workspace_id
                  AND membership.id=assignment.membership_id
                 JOIN users user_account ON user_account.id=membership.user_id
                WHERE assignment.workspace_id=$1 AND assignment.project_id=ANY($2::uuid[])
                  AND assignment.active AND membership.status='active'
                ORDER BY user_account.display_name,membership.id`,
              [w, projects.map((project) => project.id)],
            )
          ).rows
        : [];
      const items = [];
      for (const project of projects) {
        const item = projectFieldProject(
          {
            ...project,
            members: projectMembers
              .filter((member) => member.projectId === project.id)
              .map(({ id: memberId, name }) => ({ id: memberId, name })),
          },
          await this.load(ctx, project.id),
          ctx.membershipId,
          permissions,
        );
        if (
          item.tasks.length ||
          item.deliveries.length ||
          item.purchaseReceipts.length ||
          item.snags.length ||
          item.handovers.length
        )
          items.push(item);
      }
      return { projects: items };
    });
  }
  async fieldCommand(actor: RequestActor, w: string, id: string, input: unknown) {
    const command = await this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      await this.row(ctx, id);
      return projectFieldCommand(
        await this.load(ctx, id),
        ctx.membershipId,
        {
          manage: ctx.permissions.has("projects.manage"),
          review: ctx.permissions.has("projects.review"),
          report:
            ctx.permissions.has("projects.report") ||
            ctx.permissions.has("projects.manage"),
          buy: ctx.permissions.has("projects.buy"),
        },
        input,
      );
    });
    return this.command(actor, w, id, command);
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
    const clientApprovers = (
      await ctx.client.query<{ id: string; name: string }>(
        `SELECT portal_grant.id,portal_grant.name
           FROM client_portal_settings settings
           JOIN client_portal_grants portal_grant ON portal_grant.workspace_id=settings.workspace_id
          WHERE settings.workspace_id=$1 AND settings.enabled=true
            AND portal_grant.case_id=$2 AND portal_grant.active=true AND portal_grant.role='approver'
          ORDER BY portal_grant.name`,
        [ctx.workspaceId, r.caseId],
      )
    ).rows;
    const sites = (
      await ctx.client.query<{ id: string; name: string; address: string }>(
        `SELECT id,name,address FROM work_locations
         WHERE workspace_id=$1 AND project_id=$2 AND kind='site' AND active
         ORDER BY name`,
        [ctx.workspaceId, id],
      )
    ).rows;
    const resources = (
      await ctx.client.query(
        `SELECT id,name,kind,members,active,calendar,business_unit_id AS "businessUnitId",
                workspace_team_id AS "workspaceTeamId",capacity_mode AS "capacityMode",
                capacity::float8 AS capacity,timezone,version
         FROM project_resources WHERE workspace_id=$1 ORDER BY name`,
        [ctx.workspaceId],
      )
    ).rows;
    const bookings = (
      await ctx.client.query(
        `SELECT b.id,b.project_id AS "projectId",p.name AS "projectName",b.task_id AS "taskId",coalesce((SELECT t->>'title' FROM project_execution e, jsonb_array_elements(e.content->'tasks') t WHERE e.project_id=b.project_id AND t->>'id'=b.task_id),'Booked work') AS "taskTitle",b.resource_id AS "resourceId",b.starts_on::text AS start,b.ends_on::text AS end,b.status,b.acknowledgement,b.slots,b.units::float8 AS units,b.timezone,b.version,b.cancellation_reason AS "cancellationReason",b.slots->0->>'startTime' AS "startTime",b.slots->0->>'endTime' AS "endTime" FROM project_bookings b JOIN delivery_projects p ON p.id=b.project_id WHERE b.workspace_id=$1 AND b.status IN ('draft','tentative','confirmed') ORDER BY b.starts_on`,
        [ctx.workspaceId],
      )
    ).rows;
    const visibleBookings = ctx.permissions.has("projects.manage")
      ? bookings
      : bookings.filter((booking) => booking.projectId === id);
    return {
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
      pulse: projectExecutionPulse(
        data,
        localDate(new Date(), r.timezone ?? "UTC"),
        resources,
        visibleBookings.filter((booking) => booking.projectId === id),
      ),
      members,
      sites,
      clientApprovers,
      resources,
      bookings: visibleBookings,
      connectedPlan: projectConnectedPlan(
        data,
        resources,
        visibleBookings.filter((booking) => booking.projectId === id),
        localDate(new Date(), r.timezone ?? "UTC"),
      ),
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
      const previousTaskStatuses = new Map(
        d.tasks.map((task) => [task.id, task.status]),
      );
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
          "handover_outstanding_status",
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
          "complete_project",
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
          `SELECT id,name,kind,members,active,calendar,business_unit_id AS "businessUnitId",
                  workspace_team_id AS "workspaceTeamId",capacity_mode AS "capacityMode",
                  capacity::float8 AS capacity,timezone,version
           FROM project_resources WHERE workspace_id=$1`,
          [w],
        )
      ).rows as ProjectResource[];
      let initiationSiteIds: string[] = [];
      if (
        action === "project_initiation" ||
        action === "revise_project_initiation"
      ) {
        const initiation = obj(b.initiation);
        initiationSiteIds = ids(initiation.siteIds);
        if (
          initiationSiteIds.some(
            (siteId) => !/^[0-9a-f-]{36}$/iu.test(siteId),
          )
        )
          throw new BadRequestException("Choose a valid project site.");
        if (initiationSiteIds.length) {
          const sites = await ctx.client.query<{ id: string }>(
            `SELECT id FROM work_locations
             WHERE workspace_id=$1 AND project_id=$2 AND kind='site' AND active
               AND id=ANY($3::uuid[])`,
            [w, id, initiationSiteIds],
          );
          if (sites.rowCount !== initiationSiteIds.length)
            throw new BadRequestException(
              "Choose active sites that belong to this project.",
            );
        }
      }
      const name =
        members.find((m) => m.id === ctx.membershipId)?.name ??
        "Project member";
      if (action === "handover_status" && b.status === "ready") {
        const existingHandover = d.handovers.find(
          (handover) => handover.id === str(b.id, 80),
        );
        const requestedApproverId =
          str(b.clientApproverId, 80) || existingHandover?.clientApproverId || "";
        const approvers = await ctx.client.query<{ id: string }>(
          `SELECT portal_grant.id
             FROM client_portal_settings settings
             JOIN client_portal_grants portal_grant ON portal_grant.workspace_id=settings.workspace_id
            WHERE settings.workspace_id=$1 AND settings.enabled=true
              AND portal_grant.case_id=$2 AND portal_grant.active=true AND portal_grant.role='approver'
            ORDER BY portal_grant.created_at`,
          [w, row.caseId],
        );
        if (requestedApproverId) {
          if (!approvers.rows.some((grant) => grant.id === requestedApproverId))
            throw new BadRequestException(
              "Choose an active client-portal approver for this project.",
            );
        } else if (approvers.rowCount === 1) {
          // One configured approver is a safe, friction-free default. With
          // multiple approvers the UI can present a deliberate choice; with
          // none, the signed-record path remains available.
          b.clientApproverId = approvers.rows[0].id;
        }
      }
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
          `SELECT id,task_id,status,resource_id,starts_on,ends_on,slots,units,timezone,member_ids
           FROM project_bookings WHERE workspace_id=$1 AND project_id=$2
             AND task_id=ANY($3::text[]) AND status IN ('draft','tentative','confirmed')`,
          [w, id, changes.map((c) => c.id)],
        );
        if (bookings.rowCount && b.releaseBookings !== true)
          throw new ConflictException(
            "Confirm release of the affected bookings before moving their dates. Rebook the work after reviewing availability.",
          );
        str(b.note, 3000, true);
        const rescheduleReason = str(b.note, 1000, true);
        await ctx.client.query(
          `UPDATE project_bookings SET status='cancelled',cancellation_reason=$4,
                  cancelled_at=now(),updated_by=$5,version=version+1
           WHERE workspace_id=$1 AND project_id=$2 AND task_id=ANY($3::text[])
             AND status IN ('draft','tentative','confirmed')`,
          [w, id, changes.map((c) => c.id), rescheduleReason, ctx.userId],
        );
        for (const booking of bookings.rows)
          await ctx.client.query(
            `INSERT INTO project_booking_history(
               workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id
             ) VALUES($1,$2,'rescheduled',$3,'cancelled',$4,$5,$6)`,
            [w, booking.id, booking.status, rescheduleReason, JSON.stringify({
              projectId: id, taskId: booking.task_id, resourceId: booking.resource_id,
              startsOn: booking.starts_on, endsOn: booking.ends_on, slots: booking.slots,
              units: Number(booking.units), timezone: booking.timezone, memberIds: booking.member_ids,
            }), ctx.userId],
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
        const commercial = row.commercial as CommercialData | undefined;
        const changes = commercial
          ? acceptedVariationsToRelease(
              commercial,
              d.variations.map((variation) => variation.quoteId),
            )
          : [];
        const releasedChangeCases = new Map(
          (commercial?.requests ?? [])
            .filter(
              (request) =>
                request.control &&
                changes.some((quote) =>
                  request.control!.quoteIds.includes(quote.id),
                ),
            )
            .map((request) => [request.id, request]),
        );
        for (const request of releasedChangeCases.values())
          if (!controlledChangeCanRelease(commercial!, request.id))
            throw new ConflictException(
              `Change Case C${request.number} cannot release until every linked client document is accepted and its operational dispositions are complete.`,
            );
        for (const q of changes) {
          const variationHash = freezeHash(q);
          if (!acceptedVariationSnapshotIsCurrent(q))
            throw new ConflictException(
              `Accepted variation V${q.number} changed after client acceptance. Issue a new variation before release.`,
            );
          if (!variationReleasePaymentsReady(commercial!, q))
            throw new ConflictException(
              `Finance must verify and fully allocate the required receipt for variation V${q.number} before releasing its work.`,
            );
          if (q.currency !== d.scope.currency)
            throw new ConflictException(
              "Variation currency must match the original agreement.",
            );
          const variationDesignBaseline = await captureApprovedDesignBaseline(
            ctx.client,
            w,
            row.caseId,
            q.lines.map((line) => ({
              scopeLineId: line.id,
              sourceScopeId: line.scopeId,
              sourceScopeVersion: line.scopeVersion,
              sourceSpecificationVersion: line.specificationVersion,
              title: line.title,
            })),
            new Date().toISOString(),
            q.definitionBaseline,
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
            blockWorkPackagesForDeduction(
              d,
              q.lines
                .map((line) => line.deductsLineId)
                .filter((scopeLineId): scopeLineId is string => Boolean(scopeLineId)),
              `Accepted deduction V${q.number}. Review remaining scope and quantities.`,
              new Date().toISOString(),
            );
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
          if (variationDesignBaseline.links.length) {
            d.designBaseline = mergeDesignBaseline(
              d.designBaseline,
              variationDesignBaseline,
            );
            synchroniseApprovedDesignDocuments(
              d,
              variationDesignBaseline,
              new Date().toISOString(),
              randomUUID,
            );
          }
          syncScopeWorkPackages(d, new Date().toISOString());
        }
        d.changeCases ??= [];
        for (const request of releasedChangeCases.values()) {
          if (d.changeCases.some((item) => item.requestId === request.id))
            continue;
          const allCaseVariationsReleased = request.control!.quoteIds.every(
            (quoteId) => d.variations!.some((variation) => variation.quoteId === quoteId),
          );
          if (allCaseVariationsReleased)
            d.changeCases.push({
              requestId: request.id,
              number: request.number,
              kind: request.control!.kind,
              quoteIds: [...request.control!.quoteIds],
              sourceLineIds: [...request.control!.sourceLineIds],
              releasedAt: new Date().toISOString(),
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
                "SELECT 1 FROM project_bookings WHERE workspace_id=$1 AND resource_id=$2 AND status IN ('draft','tentative','confirmed') AND ends_on>=CURRENT_DATE",
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
          const { capacityMode, capacity } = capacityConfiguration(
            kind,
            v.capacityMode ?? current?.capacityMode ?? "exclusive",
            v.capacity ?? current?.capacity ?? 1,
          );
          const timezone = v.timezone === undefined
            ? (current?.timezone ?? null)
            : str(v.timezone, 64) || null;
          if (timezone && !(await ctx.client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [timezone])).rowCount)
            throw new BadRequestException("Choose a valid IANA timezone.");
          const workspaceTeamId = v.workspaceTeamId === undefined
            ? (current?.workspaceTeamId ?? null)
            : str(v.workspaceTeamId, 36) || null;
          if (workspaceTeamId && !(await ctx.client.query(
            `SELECT 1 FROM workspace_teams
             WHERE workspace_id=$1 AND id=$2 AND status='active'
               AND ($3::uuid IS NULL OR business_unit_id=$3)`,
            [w, workspaceTeamId, businessUnitId],
          )).rowCount)
            throw new BadRequestException("Choose an active team from the selected department.");
          await ctx.client.query(
            `INSERT INTO project_resources(
               id,workspace_id,name,kind,members,active,calendar,business_unit_id,
               workspace_team_id,capacity_mode,capacity,timezone,updated_by
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT(id) DO UPDATE SET name=$3,kind=$4,members=$5,active=$6,
               calendar=$7,business_unit_id=$8,workspace_team_id=$9,capacity_mode=$10,
               capacity=$11,timezone=$12,updated_by=$13,version=project_resources.version+1
             WHERE project_resources.workspace_id=$2`,
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
              workspaceTeamId,
              capacityMode,
              capacity,
              timezone,
              ctx.userId,
            ],
          );
        } else {
          const task = get(d.tasks, b.taskId);
          changedRecordId = task.id;
          if (action === "cancel_booking") {
            const reason = str(b.note, 1000) || "Released from the project schedule";
            const cancelled = await ctx.client.query(
              `WITH active AS (
                 SELECT id,status AS previous_status
                 FROM project_bookings
                 WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3
                   AND status IN ('draft','tentative','confirmed')
                 FOR UPDATE
               )
               UPDATE project_bookings booking SET status='cancelled',cancellation_reason=$4,
                      cancelled_at=now(),updated_by=$5,version=booking.version+1,request_id=$6
               FROM active
               WHERE booking.workspace_id=$1 AND booking.id=active.id
               RETURNING booking.id,booking.resource_id,booking.starts_on,booking.ends_on,
                         booking.slots,booking.units,booking.timezone,booking.member_ids,
                         active.previous_status`,
              [w, id, task.id, reason, ctx.userId, retry],
            );
            if (!cancelled.rowCount) throw new NotFoundException("Active booking not found.");
            const booking = cancelled.rows[0];
            await ctx.client.query(
              `INSERT INTO project_booking_history(
                 workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id,request_id
               ) VALUES($1,$2,'cancelled',$3,'cancelled',$4,$5,$6,$7)`,
              [w, booking.id, booking.previous_status, reason, JSON.stringify({
                projectId: id, taskId: task.id, resourceId: booking.resource_id,
                startsOn: booking.starts_on, endsOn: booking.ends_on, slots: booking.slots,
                units: Number(booking.units), timezone: booking.timezone, memberIds: booking.member_ids,
              }), ctx.userId, retry],
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
            const { capacityMode, capacity } = capacityConfiguration(
              resource.kind,
              resource.capacityMode ?? "exclusive",
              resource.capacity ?? 1,
            );
            const units = Number(b.units ?? 1);
            if (!Number.isFinite(units) || units <= 0 || units > capacity)
              throw new BadRequestException("Choose booking capacity within the resource limit.");
            if (capacityMode === "exclusive" && units !== 1)
              throw new BadRequestException("Exclusive resources use one capacity unit.");
            const timezone = resource.timezone ?? row.timezone ?? "UTC";
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
              if (c.timezone !== timezone)
                throw new ConflictException(
                  "Review the employee and project timezone mapping before booking this crew.",
                );
              if (
                slots.some((slot) => !calendarContainsSlot({
                  weekdays: c.working_days,
                  startTime: c.day_start.slice(0, 5),
                  endTime: c.day_end.slice(0, 5),
                  holidays: (c.holidays as string[]).map((date) => ({ date, reason: "Employee non-working date" })),
                }, slot))
              ) {
                if (b.calendarOverride !== true || !str(b.note, 3000))
                  throw new ConflictException(
                    "These hours conflict with an employee calendar. Review the exception and record the approved overtime instruction.",
                  );
              }
            }

            const clashes = await ctx.client.query(
              `SELECT p.name,b.resource_id AS "resourceId",b.member_ids AS "memberIds",
                      b.units::float8 AS units,b.starts_on::text AS start,b.ends_on::text AS end,b.slots
               FROM project_bookings b JOIN delivery_projects p ON p.id=b.project_id
               WHERE b.workspace_id=$1 AND b.status='confirmed'
                 AND b.starts_on<=$4::date AND b.ends_on>=$3::date
                 AND (b.resource_id=$2 OR b.member_ids && $5::uuid[])
                 AND NOT(b.project_id=$6 AND b.task_id=$7)`,
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
            const memberConflict = conflicts.some((conflict) =>
              (conflict.memberIds as string[]).some((memberId) => resource.members.includes(memberId)),
            );
            const resourceConflicts = conflicts.filter((conflict) => conflict.resourceId === resource.id);
            const capacityConflict = capacityMode === "exclusive"
              ? resourceConflicts.length > 0
              : exceedsPooledCapacity(
                  slots,
                  units,
                  resourceConflicts.map((conflict) => ({
                    units: Number(conflict.units),
                    slots: conflict.slots?.length
                      ? conflict.slots
                      : bookingSlots(conflict.start, conflict.end),
                  })),
                  capacity,
                );
            if (memberConflict || capacityConflict)
              throw new ConflictException(
                `Booking clash: ${conflicts.map((c) => `${c.name} (${c.start}–${c.end})`).join(", ")}. Choose another resource, capacity or dates.`,
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
            const replaced = await ctx.client.query(
              `UPDATE project_bookings SET status='cancelled',cancellation_reason='Replaced by a new confirmed booking',
                      cancelled_at=now(),updated_by=$4,version=version+1
               WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3
                 AND status IN ('draft','tentative','confirmed') RETURNING id,status`,
              [w, id, task.id, ctx.userId],
            );
            for (const previous of replaced.rows)
              await ctx.client.query(
                `INSERT INTO project_booking_history(
                   workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id
                 ) VALUES($1,$2,'cancelled',$3,'cancelled','Replaced by a new confirmed booking',$4,$5)`,
                [w, previous.id, previous.status, JSON.stringify({ projectId: id, taskId: task.id }), ctx.userId],
              );
            const calendarSnapshot = {
              source: resource.calendar ? "resource" : employeeCalendars.length ? "employees" : "workspace_default",
              timezone,
              calendar,
              employeeCalendarCount: employeeCalendars.length,
            };
            const created = await ctx.client.query(
              `INSERT INTO project_bookings(
                 workspace_id,project_id,task_id,resource_id,starts_on,ends_on,status,
                 acknowledgement,member_ids,slots,units,timezone,calendar_snapshot,request_id,
                 created_by,updated_by,confirmed_at
               ) VALUES($1,$2,$3,$4,$5,$6,'confirmed',$7,$8,$9,$10,$11,$12,$13,$14,$14,now())
               RETURNING id`,
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
                units,
                timezone,
                JSON.stringify(calendarSnapshot),
                retry,
                ctx.userId,
              ],
            );
            const bookingId = created.rows[0].id;
            for (const slot of slots) {
              const endDate = slot.endDate ?? slot.date;
              await ctx.client.query(
                `INSERT INTO project_booking_slots(
                   workspace_id,booking_id,project_id,task_id,resource_id,local_date,end_date,
                   start_time,end_time,starts_at,ends_at,timezone,units,member_ids,calendar_snapshot
                 ) VALUES($1,$2,$3,$4,$5,$6::date,$7::date,$8::time,$9::time,
                   ($6::date+$8::time) AT TIME ZONE $10,
                   ($7::date+$9::time) AT TIME ZONE $10,$10,$11,$12,$13)`,
                [w, bookingId, id, task.id, resource.id, slot.date, endDate, slot.startTime,
                  slot.endTime, timezone, units, resource.members, JSON.stringify(calendarSnapshot)],
              );
            }
            await ctx.client.query(
              `INSERT INTO project_booking_history(
                 workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id,request_id
               ) VALUES($1,$2,'created',NULL,'confirmed',$3,$4,$5,$6)`,
              [w, bookingId, acknowledgement, JSON.stringify({
                projectId: id, taskId: task.id, resourceId: resource.id, startsOn: task.start,
                endsOn: task.end, slots, units, timezone, memberIds: resource.members,
              }), ctx.userId, retry],
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
                "SELECT 1 FROM project_bookings WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND status IN ('draft','tentative','confirmed')",
                [w, id, old.id],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Release the existing booking before rescheduling or reassigning this task.",
            );
        }
        if (
          action === "complete_project" &&
          (
            await ctx.client.query(
              `SELECT 1 FROM project_bookings
               WHERE workspace_id=$1 AND project_id=$2 AND status IN ('draft','tentative')`,
              [w, id],
            )
          ).rowCount
        )
          throw new ConflictException(
            "Resolve draft and tentative resource bookings before completing the project.",
          );
        if (action === "task_status" && b.status === "in_progress") {
          this.access.require(ctx, "projects.manage");
          const t = get(d.tasks, b.id);
          if(t.location!=="office"&&!t.resourceId)throw new ConflictException("Assign a crew or factory and confirm its booking before starting work.");
          if (t.location === "factory") {
            const commercial = row.commercial as CommercialData | undefined;
            if (
              commercial?.payments?.some(
                (payment) => payment.requiredForProduction === true,
              ) &&
              !financeGatePaymentsReady(commercial, "production")
            )
              throw new ConflictException(
                "Finance must verify the contracted before-production receipt before manufacturing starts.",
              );
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
                `SELECT 1 FROM project_bookings
                 WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3 AND resource_id=$4
                   AND status='confirmed' AND starts_on <= $5::date AND ends_on >= $6::date`,
                [w, id, t.id, t.resourceId, t.start, t.end],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Assign and confirm a current resource booking before starting work.",
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
          resourceKinds: Object.fromEntries(
            resources
              .filter((resource) => resource.active)
              .map((resource) => [resource.id, resource.kind]),
          ),
          siteIds: initiationSiteIds,
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
      if (
        action === "project_initiation" ||
        action === "revise_project_initiation" ||
        action === "project_roles"
      ) {
        const projectOwnerId = d.initiation?.baseline?.projectOwnerId;
        const roster = new Set([
          ...(d.initiation?.baseline?.teamMemberIds ?? []),
          ...(d.roleAssignments ?? []).map((assignment) => assignment.memberId),
        ]);
        for (const membershipId of roster) {
          await ctx.client.query(
            `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active)
             VALUES($1,$2,$3,$4,true)
             ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL
             DO UPDATE SET active=true,
               is_manager=project_assignments.is_manager OR EXCLUDED.is_manager`,
            [
              w,
              id,
              membershipId,
              membershipId === projectOwnerId ||
                d.roleAssignments?.some(
                  (assignment) =>
                    assignment.role === "project_manager" &&
                    assignment.memberId === membershipId,
                ) === true,
            ],
          );
        }
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
          "handover_outstanding",
        ].includes(action)
      ) {
        const value = obj(b.record ?? b.snag ?? b.milestone ?? b.item);
        if (value.ownerId)
          await ctx.client.query(
            `INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,false) ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active=true`,
            [w, id, str(value.ownerId, 80, true)],
          );
      }
      const completedTaskIds = d.tasks
        .filter(
          (task) =>
            task.status === "completed" &&
            previousTaskStatuses.get(task.id) !== "completed",
        )
        .map((task) => task.id);
      if (completedTaskIds.length) {
        if (
          (
            await ctx.client.query(
              `SELECT 1 FROM project_bookings
               WHERE workspace_id=$1 AND project_id=$2 AND task_id=ANY($3::text[])
                 AND status IN ('draft','tentative')`,
              [w, id, completedTaskIds],
            )
          ).rowCount
        )
          throw new ConflictException(
            "Resolve draft and tentative resource bookings before completing this work.",
          );
        const completedBookings = await ctx.client.query(
          `WITH active AS (
             SELECT id,status AS previous_status,task_id,resource_id,starts_on,ends_on,slots,units,timezone,member_ids
             FROM project_bookings
             WHERE workspace_id=$1 AND project_id=$2 AND task_id=ANY($3::text[])
               AND status='confirmed'
             FOR UPDATE
           )
           UPDATE project_bookings booking SET status='completed',version=booking.version+1,
                  updated_by=$4,completed_at=now()
           FROM active
           WHERE booking.workspace_id=$1 AND booking.id=active.id
           RETURNING booking.id,active.previous_status,active.task_id,active.resource_id,
                     active.starts_on,active.ends_on,active.slots,active.units,
                     active.timezone,active.member_ids`,
          [w, id, completedTaskIds, ctx.userId],
        );
        for (const booking of completedBookings.rows)
          await ctx.client.query(
            `INSERT INTO project_booking_history(
               workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id
             ) VALUES($1,$2,'completed',$3,'completed','Task completed',$4,$5)`,
            [w, booking.id, booking.previous_status, JSON.stringify({
              projectId: id, taskId: booking.task_id, resourceId: booking.resource_id,
              startsOn: booking.starts_on, endsOn: booking.ends_on, slots: booking.slots,
              units: Number(booking.units), timezone: booking.timezone, memberIds: booking.member_ids,
            }), ctx.userId],
          );
      }
      if (
        action === "task_status" &&
        b.status === "cancelled"
      ) {
        const reason = str(b.note, 1000) || "Task cancelled";
        const transitioned = await ctx.client.query(
          `WITH active AS (
             SELECT id,status AS previous_status,resource_id,starts_on,ends_on,slots,units,timezone,member_ids
             FROM project_bookings
             WHERE workspace_id=$1 AND project_id=$2 AND task_id=$3
               AND status IN ('draft','tentative','confirmed')
             FOR UPDATE
           )
           UPDATE project_bookings booking SET status='cancelled',version=booking.version+1,
             updated_by=$4,cancellation_reason=$5,cancelled_at=now()
           FROM active
           WHERE booking.workspace_id=$1 AND booking.id=active.id
           RETURNING booking.id,active.previous_status,active.resource_id,active.starts_on,
                     active.ends_on,active.slots,active.units,active.timezone,active.member_ids`,
          [w, id, str(b.id, 80, true), ctx.userId, reason],
        );
        for (const booking of transitioned.rows)
          await ctx.client.query(
            `INSERT INTO project_booking_history(
               workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id
             ) VALUES($1,$2,$3,$4,$3,$5,$6,$7)`,
            [w, booking.id, "cancelled", booking.previous_status, reason, JSON.stringify({
              projectId: id, taskId: b.id, resourceId: booking.resource_id,
              startsOn: booking.starts_on, endsOn: booking.ends_on, slots: booking.slots,
              units: Number(booking.units), timezone: booking.timezone, memberIds: booking.member_ids,
            }), ctx.userId],
          );
      }
      if (action === "complete_project") {
        const completed = await ctx.client.query(
          `WITH active AS (
             SELECT id,status AS previous_status,task_id,resource_id,starts_on,ends_on,slots,units,timezone,member_ids
             FROM project_bookings
             WHERE workspace_id=$1 AND project_id=$2 AND status='confirmed'
             FOR UPDATE
           )
           UPDATE project_bookings booking SET status='completed',version=booking.version+1,
                  updated_by=$3,completed_at=now()
           FROM active
           WHERE booking.workspace_id=$1 AND booking.id=active.id
           RETURNING booking.id,active.previous_status,active.task_id,active.resource_id,
                     active.starts_on,active.ends_on,active.slots,active.units,
                     active.timezone,active.member_ids`,
          [w, id, ctx.userId],
        );
        for (const booking of completed.rows)
          await ctx.client.query(
            `INSERT INTO project_booking_history(
               workspace_id,booking_id,action,from_status,to_status,reason,snapshot,actor_user_id
             ) VALUES($1,$2,'completed',$3,'completed','Project completed',$4,$5)`,
            [w, booking.id, booking.previous_status, JSON.stringify({
              projectId: id, taskId: booking.task_id, resourceId: booking.resource_id,
              startsOn: booking.starts_on, endsOn: booking.ends_on, slots: booking.slots,
              units: Number(booking.units), timezone: booking.timezone, memberIds: booking.member_ids,
            }), ctx.userId],
          );
        await ctx.client.query(
          "UPDATE delivery_projects SET status='completed',version=version+1 WHERE workspace_id=$1 AND id=$2",
          [w, id],
        );
      }
      if (action === "reopen_project")
        await ctx.client.query(
          "UPDATE delivery_projects SET status='active',version=version+1 WHERE workspace_id=$1 AND id=$2",
          [w, id],
        );
      await this.projectNotifications.notify(
        ctx,
        id,
        row.name,
        d,
        action,
        changedRecordId,
        retry,
      );
      d.processed.push(retry);
      await this.store(ctx, id, d);
      const correlationId = randomUUID();
      let causationId: string | undefined;
      for (const event of projectExecutionEvents(
        id,
        row.name,
        d,
        action,
        changedRecordId,
      )) {
        causationId = await this.events.record(ctx.client, {
          workspaceId: ctx.workspaceId,
          actorUserId: ctx.userId,
          source: "user",
          action: event.action,
          entityType: "delivery_project",
          entityId: id,
          correlationId,
          causationId,
          after: event.data,
        });
      }
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
