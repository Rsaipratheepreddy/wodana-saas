import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { Calendar, localDate } from "./hrms-domain";

export type HrmsContext = {
  client: PoolClient;
  workspaceId: string;
  userId: string;
  membershipId: string;
  permissions: Set<string>;
};
export type Employee = {
  membershipId: string;
  userId: string;
  name: string;
  enabled: boolean;
  remoteAllowed: boolean;
  managerId: string | null;
  activeFrom: string;
  activeTo: string | null;
  calendar: Calendar;
  version: number;
};
@Injectable()
export class HrmsAccessService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
  ) {}
  run<T>(
    actor: RequestActor,
    workspaceId: string,
    work: (ctx: HrmsContext) => Promise<T>,
  ): Promise<T> {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const member = await client.query(
        `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
        [workspaceId, user.userId],
      );
      if (!member.rowCount) throw new NotFoundException("Workspace not found.");
      const grants = await client.query(
        `SELECT DISTINCT p.code FROM effective_member_roles mr JOIN role_permissions rp ON rp.role_id=mr.role_id JOIN permissions p ON p.id=rp.permission_id WHERE mr.workspace_id=$1 AND mr.membership_id=$2`,
        [workspaceId, member.rows[0].id],
      );
      const permissionCodes = grants.rows.map((row: { code: string }) => row.code);
      const effectivePermissions = await this.access.effectivePermissions(client, workspaceId, permissionCodes);
      return work({
        client,
        workspaceId,
        userId: user.userId,
        membershipId: member.rows[0].id,
        permissions: new Set(effectivePermissions),
      });
    });
  }
  require(ctx: HrmsContext, ...codes: string[]) {
    if (!codes.some((code) => ctx.permissions.has(code)))
      throw new ForbiddenException(
        "You do not have access to this HRMS action.",
      );
  }
  async lock(ctx: HrmsContext, membershipId = ctx.membershipId) {
    await ctx.client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`${ctx.workspaceId}:${membershipId}`],
    );
  }
  async settings(ctx: HrmsContext) {
    const result = await ctx.client.query(
      `SELECT default_calendar_id AS "defaultCalendarId",fallback_approver_id AS "fallbackApproverId",max_gps_accuracy_m AS "maxGpsAccuracyM",max_capture_age_seconds AS "maxCaptureAgeSeconds",media_retention_days AS "mediaRetentionDays",version FROM hrms_settings WHERE workspace_id=$1`,
      [ctx.workspaceId],
    );
    if (!result.rowCount)
      throw new ConflictException(
        "An administrator must configure the HRMS work calendar first.",
      );
    return result.rows[0];
  }
  async employee(
    ctx: HrmsContext,
    membershipId = ctx.membershipId,
    active = false,
  ): Promise<Employee> {
    const result = await ctx.client.query(
      `SELECT e.membership_id AS "membershipId",m.user_id AS "userId",u.display_name AS name,e.enabled,e.remote_allowed AS "remoteAllowed",e.manager_id AS "managerId",e.active_from::text AS "activeFrom",e.active_to::text AS "activeTo",e.version,
   jsonb_build_object('id',c.id,'name',c.name,'timezone',c.timezone,'workingDays',c.working_days,'holidays',c.holidays,'dayStart',c.day_start::text,'halfDay',c.half_day::text,'dayEnd',c.day_end::text) AS calendar,m.status
   FROM hrms_employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.membership_id JOIN users u ON u.id=m.user_id JOIN hrms_calendars c ON c.workspace_id=e.workspace_id AND c.id=e.calendar_id WHERE e.workspace_id=$1 AND e.membership_id=$2`,
      [ctx.workspaceId, membershipId],
    );
    if (!result.rowCount)
      throw new NotFoundException(
        "This workspace member is not enrolled in employee attendance.",
      );
    const employee = result.rows[0] as Employee & { status: string };
    const today = localDate(new Date(), employee.calendar.timezone);
    if (
      active &&
      (!employee.enabled ||
        employee.status !== "active" ||
        today < employee.activeFrom ||
        (employee.activeTo && today > employee.activeTo))
    )
      throw new ForbiddenException(
        "Employee attendance is not active for this member.",
      );
    return employee;
  }
  async self(ctx: HrmsContext) {
    this.require(ctx, "hrms.self", "hrms.manage");
    return this.employee(ctx, ctx.membershipId, true);
  }
  async canManageEmployee(ctx: HrmsContext, membershipId: string) {
    if (ctx.permissions.has("hrms.manage")) return true;
    if (!ctx.permissions.has("hrms.team")) return false;
    const result = await ctx.client.query(
      `SELECT 1 FROM hrms_employees e LEFT JOIN workspace_memberships manager ON manager.workspace_id=e.workspace_id AND manager.id=e.manager_id LEFT JOIN hrms_settings s ON s.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.membership_id=$2 AND (e.manager_id=$3 OR ((e.manager_id IS NULL OR manager.status<>'active') AND s.fallback_approver_id=$3))`,
      [ctx.workspaceId, membershipId, ctx.membershipId],
    );
    return Boolean(result.rowCount);
  }
  async assertReadEmployee(ctx: HrmsContext, membershipId: string) {
    if (membershipId === ctx.membershipId) {
      this.require(ctx, "hrms.self", "hrms.manage");
      await this.employee(ctx);
      return;
    }
    if (!(await this.canManageEmployee(ctx, membershipId)))
      throw new ForbiddenException(
        "This employee is outside your reporting scope.",
      );
  }
  async assertReviewer(ctx: HrmsContext, membershipId: string) {
    if (membershipId === ctx.membershipId)
      throw new ForbiddenException(
        "Your own request requires an independent approver.",
      );
    if (!(await this.canManageEmployee(ctx, membershipId)))
      throw new ForbiddenException(
        "This request is outside your approval scope.",
      );
  }
  async memberExists(ctx: HrmsContext, id: string) {
    const r = await ctx.client.query(
      `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND id=$2 AND status='active'`,
      [ctx.workspaceId, id],
    );
    if (!r.rowCount)
      throw new BadRequestException(
        "Choose an active member of this workspace.",
      );
  }
  async audit(
    ctx: HrmsContext,
    action: string,
    id: string,
    after: Record<string, unknown>,
    before?: Record<string, unknown>,
  ) {
    await this.events.record(ctx.client, {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      source: "user",
      action: `hrms.${action}.v1`,
      entityType: "hrms",
      entityId: id,
      after,
      before,
    });
  }
  version(actual: number | undefined, expected: number) {
    if ((actual ?? 0) !== expected)
      throw new ConflictException(
        "This record changed. Refresh before saving.",
      );
  }
}
