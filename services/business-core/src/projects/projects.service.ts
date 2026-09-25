import { releaseDeliveryProject } from "./project-release";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestActor } from "../auth/actor";
import { HrmsAccessService, HrmsContext } from "../hrms/hrms-access.service";
import { dateRange } from "../hrms/hrms-domain";
import { ProjectAttendanceDto } from "./project-attendance.dto";
import { AssignmentDto, WorkLocationDto } from "./projects.dto";

@Injectable()
export class ProjectsService {
  constructor(private readonly access: HrmsAccessService) {}
  siteAttendance(
    actor: RequestActor,
    workspaceId: string,
    input: ProjectAttendanceDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      dateRange(input.from, input.to);
      this.access.require(
        ctx,
        "projects.view",
        "projects.manage",
        "hrms.manage",
      );
      if (
        !ctx.permissions.has("projects.manage") &&
        !ctx.permissions.has("hrms.manage")
      ) {
        const manager = await ctx.client.query(
          `SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND project_id=$2 AND membership_id=$3 AND active AND is_manager`,
          [workspaceId, input.projectId, ctx.membershipId],
        );
        if (!manager.rowCount)
          throw new ForbiddenException(
            "Site attendance is available to this project’s assigned managers.",
          );
      }
      return (
        await ctx.client.query(
          `SELECT g.id,u.display_name AS name,g.context_snapshot->'location'->>'name' AS site,g.started_at AS "checkedInAt",g.ended_at AS "checkedOutAt",e.evidence->'arrival'->>'status' AS "locationStatus",CASE WHEN g.ended_at IS NOT NULL THEN floor(extract(epoch FROM (g.ended_at-g.started_at))/60)::int ELSE NULL END AS minutes FROM hrms_segments g JOIN hrms_sessions s ON s.workspace_id=g.workspace_id AND s.id=g.session_id JOIN workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.membership_id JOIN users u ON u.id=m.user_id JOIN hrms_attendance_events e ON e.workspace_id=g.workspace_id AND e.id=g.start_event_id WHERE g.workspace_id=$1 AND g.project_id=$2 AND g.mode='site' AND (g.started_at AT TIME ZONE (s.calendar_snapshot->>'timezone'))::date<=$4::date AND ((g.ended_at AT TIME ZONE (s.calendar_snapshot->>'timezone'))::date>=$3::date OR g.ended_at IS NULL) ORDER BY g.started_at DESC`,
          [workspaceId, input.projectId, input.from, input.to],
        )
      ).rows;
    });
  }
  async assertContext(
    ctx: HrmsContext,
    projectId?: string | null,
    caseId?: string | null,
  ) {
    if (projectId && caseId)
      throw new BadRequestException("Choose one project or pre-execution.");
    if (!projectId && !caseId) return;
    const result = projectId
      ? await ctx.client.query(
          `SELECT id FROM delivery_projects WHERE workspace_id=$1 AND id=$2 AND status='active'`,
          [ctx.workspaceId, projectId],
        )
      : await ctx.client.query(
          `SELECT id FROM pre_project_cases WHERE workspace_id=$1 AND id=$2 AND status='active'`,
          [ctx.workspaceId, caseId],
        );
    if (!result.rowCount)
      throw new BadRequestException(
        "This project or pre-execution is not active.",
      );
    if (
      ctx.permissions.has("projects.manage") ||
      ctx.permissions.has("hrms.manage")
    )
      return;
    const assigned = await ctx.client.query(
      `SELECT 1 FROM project_assignments WHERE workspace_id=$1 AND membership_id=$2 AND active AND (project_id=$3 OR case_id=$4)`,
      [ctx.workspaceId, ctx.membershipId, projectId ?? null, caseId ?? null],
    );
    if (!assigned.rowCount)
      throw new ForbiddenException(
        "You are not assigned to this project or pre-execution.",
      );
  }
  contexts(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, (ctx) => this.contextsIn(ctx));
  }
  async contextsIn(ctx: HrmsContext) {
    this.access.require(
      ctx,
      "hrms.self",
      "hrms.manage",
      "projects.view",
      "projects.manage",
    );
    const all =
      ctx.permissions.has("projects.manage") ||
      ctx.permissions.has("hrms.manage");
    const rows = await ctx.client.query(
      `SELECT p.id,p.name,p.status,'project' AS kind,c.id AS "caseId",party.display_name AS "customerName",($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.membership_id=$2 AND a.active AND a.is_manager)) AS "canViewAttendance" FROM delivery_projects p JOIN pre_project_cases c ON c.workspace_id=p.workspace_id AND c.id=p.case_id JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id WHERE p.workspace_id=$1 AND p.status='active' AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id AND a.project_id=p.id AND a.membership_id=$2 AND a.active))
   UNION ALL SELECT c.id,o.title,c.status,'pre_project',c.id,party.display_name,false FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id JOIN crm_parties party ON party.workspace_id=o.workspace_id AND party.id=o.party_id WHERE c.workspace_id=$1 AND c.status='active' AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=c.workspace_id AND a.case_id=c.id AND a.membership_id=$2 AND a.active)) ORDER BY name`,
      [ctx.workspaceId, ctx.membershipId, all],
    );
    return rows.rows;
  }
  release(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.run(actor, workspaceId, async ctx => {
      this.access.require(ctx,"commercial.release");
      const row=await ctx.client.query("SELECT id FROM pre_project_cases WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[workspaceId,caseId]);
      if(!row.rowCount)throw new NotFoundException("Pre-execution not found.");
      const data=(await ctx.client.query("SELECT content FROM commercial_cases_view WHERE workspace_id=$1 AND case_id=$2",[workspaceId,caseId])).rows[0]?.content;
      if(!data)throw new ConflictException("Complete the commercial release checklist first.");
      return releaseDeliveryProject(ctx.client,workspaceId,caseId,ctx.userId,data);
    });
  }
  assignments(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.manage", "hrms.manage");
      return (
        await ctx.client.query(
          `SELECT id,project_id AS "projectId",case_id AS "caseId",membership_id AS "membershipId",is_manager AS "isManager",active FROM project_assignments WHERE workspace_id=$1`,
          [workspaceId],
        )
      ).rows;
    });
  }
  assign(actor: RequestActor, workspaceId: string, input: AssignmentDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "projects.manage", "hrms.manage");
      if (Boolean(input.projectId) === Boolean(input.caseId))
        throw new BadRequestException("Choose exactly one work context.");
      await this.assertContext(ctx, input.projectId, input.caseId);
      await this.access.memberExists(ctx, input.membershipId);
      const column = input.projectId ? "project_id" : "case_id";
      const id = input.projectId ?? input.caseId;
      const row = await ctx.client.query(
        `INSERT INTO project_assignments(workspace_id,${column},membership_id,is_manager,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,${column},membership_id) WHERE ${column} IS NOT NULL DO UPDATE SET is_manager=EXCLUDED.is_manager,active=EXCLUDED.active RETURNING id`,
        [workspaceId, id, input.membershipId, input.isManager, input.active],
      );
      await this.access.audit(
        ctx,
        "project_assignment_updated",
        row.rows[0].id,
        { ...input },
      );
      return { ...input, id: row.rows[0].id };
    });
  }
  locations(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(
        ctx,
        "hrms.self",
        "hrms.manage",
        "projects.view",
        "projects.manage",
      );
      const all =
        ctx.permissions.has("hrms.manage") ||
        ctx.permissions.has("projects.manage");
      return (
        await ctx.client.query(
          `SELECT l.id,l.name,l.kind,l.project_id AS "projectId",l.case_id AS "caseId",l.address,l.latitude,l.longitude,l.radius_m AS "radiusM",l.active,l.version FROM work_locations l WHERE l.workspace_id=$1 AND ($3 OR (l.active AND (l.kind='office' OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=l.workspace_id AND a.membership_id=$2 AND a.active AND (a.project_id=l.project_id OR a.case_id=l.case_id))))) ORDER BY l.name`,
          [workspaceId, ctx.membershipId, all],
        )
      ).rows;
    });
  }
  async location(ctx: HrmsContext, id: string) {
    const row = await ctx.client.query(
      `SELECT id,name,kind,project_id AS "projectId",case_id AS "caseId",address,latitude,longitude,radius_m AS "radiusM",version FROM work_locations WHERE workspace_id=$1 AND id=$2 AND active`,
      [ctx.workspaceId, id],
    );
    if (!row.rowCount)
      throw new BadRequestException("Choose an active work location.");
    return row.rows[0];
  }
  saveLocation(
    actor: RequestActor,
    workspaceId: string,
    input: WorkLocationDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.manage", "projects.manage");
      if (!input.name.trim())
        throw new BadRequestException("Name the office or site.");
      if (
        input.kind === "site" &&
        Boolean(input.projectId) === Boolean(input.caseId)
      )
        throw new BadRequestException(
          "A site requires one project or pre-execution.",
        );
      if (input.kind === "office" && (input.projectId || input.caseId))
        throw new BadRequestException("An office cannot belong to a project.");
      await this.assertContext(ctx, input.projectId, input.caseId);
      const id = input.id ?? randomUUID();
      await ctx.client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`location:${id}`],
      );
      const current = await ctx.client.query(
        `SELECT * FROM work_locations WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      this.access.version(current.rows[0]?.version, input.version);
      if (
        current.rowCount &&
        (current.rows[0].kind !== input.kind ||
          current.rows[0].project_id !== (input.projectId ?? null) ||
          current.rows[0].case_id !== (input.caseId ?? null))
      )
        throw new ConflictException(
          "Create a new location to change its office/site or project association.",
        );
      const result = await ctx.client.query(
        `INSERT INTO work_locations(id,workspace_id,name,kind,project_id,case_id,address,latitude,longitude,radius_m,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,address=EXCLUDED.address,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_m=EXCLUDED.radius_m,active=EXCLUDED.active,version=work_locations.version+1 WHERE work_locations.workspace_id=EXCLUDED.workspace_id RETURNING version`,
        [
          id,
          workspaceId,
          input.name.trim(),
          input.kind,
          input.projectId ?? null,
          input.caseId ?? null,
          input.address,
          input.latitude,
          input.longitude,
          input.radiusM,
          input.active,
        ],
      );
      if (!result.rowCount)
        throw new ConflictException("Location could not be saved.");
      await this.access.audit(
        ctx,
        "location_updated",
        id,
        { ...input },
        current.rows[0],
      );
      return { ...input, id, version: result.rows[0].version };
    });
  }
}
