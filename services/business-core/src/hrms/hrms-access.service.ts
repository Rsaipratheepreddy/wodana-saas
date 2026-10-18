import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { MEMBER_PERMISSIONS } from "../auth/module-access";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import {
  notifyUserInApp,
  queueUserEmail,
} from "../notifications/default-templates";
import { Calendar, localDate } from "./hrms-domain";

export type HrmsContext = {
  client: PoolClient;
  workspaceId: string;
  userId: string;
  membershipId: string;
  permissions: Set<string>;
};
export type HrmsNotice = {
  code: string;
  users: string[];
  variables: Record<string, string>;
  deepLink: string;
  /** Unique per record and event; the recipient is added. */
  key: string;
  email?: boolean;
};
const NOTICE_VARIABLES = [
  "person",
  "leaveType",
  "dates",
  "days",
  "note",
  "actor",
  "when",
  "place",
];
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
      // Everyone in the workspace uses their own attendance and leave; roles add team and admin rights.
      const permissionCodes = [
        ...grants.rows.map((row: { code: string }) => row.code),
        ...MEMBER_PERMISSIONS,
      ];
      const effectivePermissions = await this.access.effectivePermissions(client, workspaceId, permissionCodes);
      const ctx = {
        client,
        workspaceId,
        userId: user.userId,
        membershipId: member.rows[0].id,
        permissions: new Set(effectivePermissions),
      };
      if (effectivePermissions.some((code) => code.startsWith("hrms."))) {
        await this.provision(ctx);
        // Being someone's manager, or the fallback approver, is the right to decide for those people.
        if (!ctx.permissions.has("hrms.team")) {
          const leads = await client.query(
            `SELECT 1 FROM hrms_employees WHERE workspace_id=$1 AND manager_id=$2
             UNION ALL SELECT 1 FROM hrms_settings WHERE workspace_id=$1 AND fallback_approver_id=$2 LIMIT 1`,
            [workspaceId, ctx.membershipId],
          );
          if (leads.rowCount) ctx.permissions.add("hrms.team");
        }
      }
      return work(ctx);
    });
  }
  /**
   * HRMS works on day one: the first use makes the workspace's calendar (its time zone and its
   * country's working week) with the attendance rules and three leave types, and every active member
   * is enrolled from the day they joined. HR changes any of it later; nothing here overwrites.
   */
  private async provision(ctx: HrmsContext) {
    const ready = await ctx.client.query(
      `SELECT 1 FROM hrms_settings WHERE workspace_id=$1`,
      [ctx.workspaceId],
    );
    if (!ready.rowCount) {
      await ctx.client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`hrms-settings:${ctx.workspaceId}`],
      );
      const again = await ctx.client.query(
        `SELECT 1 FROM hrms_settings WHERE workspace_id=$1`,
        [ctx.workspaceId],
      );
      if (!again.rowCount) await this.setUp(ctx);
    }
    const enrolled = await ctx.client.query<{ membershipId: string }>(
      `INSERT INTO hrms_employees(workspace_id,membership_id,calendar_id,active_from)
       SELECT m.workspace_id,m.id,s.default_calendar_id,(coalesce(m.joined_at,m.created_at) AT TIME ZONE c.timezone)::date
         FROM workspace_memberships m
         JOIN hrms_settings s ON s.workspace_id=m.workspace_id
         JOIN hrms_calendars c ON c.workspace_id=s.workspace_id AND c.id=s.default_calendar_id
        WHERE m.workspace_id=$1 AND m.status='active'
       ON CONFLICT (workspace_id,membership_id) DO NOTHING
       RETURNING membership_id AS "membershipId"`,
      [ctx.workspaceId],
    );
    for (const row of enrolled.rows)
      await this.audit(ctx, "employee_enrolled", row.membershipId, {
        membershipId: row.membershipId,
        automatic: true,
      });
  }
  private async setUp(ctx: HrmsContext) {
    const region = (
      await ctx.client.query<{
        timezone: string | null;
        regionTimezone: string | null;
        workingDays: unknown;
      }>(
        `SELECT workspace.default_timezone AS timezone,
                profile.configuration->>'timezone' AS "regionTimezone",
                profile.configuration->'calendarPolicy'->'workingDays' AS "workingDays"
           FROM workspaces workspace
           LEFT JOIN LATERAL (SELECT configuration FROM tenant_setup_profiles
                               WHERE kind='region' AND code=upper(split_part(workspace.default_locale,'-',2))
                               ORDER BY version DESC LIMIT 1) profile ON true
          WHERE workspace.id=$1`,
        [ctx.workspaceId],
      )
    ).rows[0];
    const valid = (zone: string | null | undefined) => {
      if (!zone) return null;
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone }).format();
        return zone;
      } catch {
        return null;
      }
    };
    const timezone =
      valid(region?.timezone) ?? valid(region?.regionTimezone) ?? "UTC";
    const days = Array.isArray(region?.workingDays)
      ? [
          ...new Set(
            region.workingDays.filter(
              (day): day is number =>
                Number.isInteger(day) && day >= 0 && day <= 6,
            ),
          ),
        ]
      : [];
    const workingDays = days.length ? days : [1, 2, 3, 4, 5];
    const calendar = await ctx.client.query<{ id: string }>(
      `INSERT INTO hrms_calendars(workspace_id,name,timezone,working_days) VALUES($1,'Company calendar',$2,$3) RETURNING id`,
      [ctx.workspaceId, timezone, workingDays],
    );
    await ctx.client.query(
      `INSERT INTO hrms_settings(workspace_id,default_calendar_id) VALUES($1,$2)`,
      [ctx.workspaceId, calendar.rows[0].id],
    );
    const types = await ctx.client.query(
      `SELECT 1 FROM hrms_leave_types WHERE workspace_id=$1 LIMIT 1`,
      [ctx.workspaceId],
    );
    if (!types.rowCount)
      await ctx.client.query(
        `INSERT INTO hrms_leave_types(workspace_id,name,annual_days,limited,paid) VALUES
           ($1,'Annual leave',0,true,true),($1,'Sick leave',0,false,true),($1,'Unpaid leave',0,false,false)`,
        [ctx.workspaceId],
      );
    await this.audit(ctx, "set_up", ctx.workspaceId, {
      calendarId: calendar.rows[0].id,
      timezone,
      workingDays,
      automatic: true,
    });
  }
  /**
   * Who decides a person's leave and attendance: their manager while active, else the workspace's
   * fallback approver, else everyone who manages HRMS. Never the person themself.
   */
  async approvers(ctx: HrmsContext, membershipId: string): Promise<string[]> {
    const chosen = await ctx.client.query<{ userId: string }>(
      `SELECT "userId" FROM (
         SELECT 0 AS rank,m.user_id AS "userId" FROM hrms_employees e
           JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.manager_id AND m.status='active'
          WHERE e.workspace_id=$1 AND e.membership_id=$2 AND e.manager_id<>$2
         UNION ALL
         SELECT 1,m.user_id FROM hrms_settings s
           JOIN workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.fallback_approver_id AND m.status='active'
          WHERE s.workspace_id=$1 AND s.fallback_approver_id<>$2) chosen
       ORDER BY rank LIMIT 1`,
      [ctx.workspaceId, membershipId],
    );
    if (chosen.rowCount) return [chosen.rows[0].userId];
    const managers = await ctx.client.query<{ userId: string }>(
      `SELECT DISTINCT m.user_id AS "userId" FROM workspace_memberships m
         JOIN effective_member_roles r ON r.workspace_id=m.workspace_id AND r.membership_id=m.id
         JOIN role_permissions rp ON rp.role_id=r.role_id
         JOIN permissions p ON p.id=rp.permission_id AND p.code='hrms.manage'
        WHERE m.workspace_id=$1 AND m.status='active' AND m.id<>$2`,
      [ctx.workspaceId, membershipId],
    );
    return managers.rows.map((row) => row.userId);
  }
  async userOf(ctx: HrmsContext, membershipId: string): Promise<string[]> {
    const row = await ctx.client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id=$1 AND id=$2 AND status='active'`,
      [ctx.workspaceId, membershipId],
    );
    return row.rows.map((item) => item.userId);
  }
  async nameOf(ctx: HrmsContext, membershipId: string): Promise<string> {
    const row = await ctx.client.query<{ name: string }>(
      `SELECT u.display_name AS name FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.id=$2`,
      [ctx.workspaceId, membershipId],
    );
    return row.rows[0]?.name ?? "";
  }
  async locale(ctx: HrmsContext): Promise<string> {
    const row = await ctx.client.query<{ locale: string | null }>(
      `SELECT default_locale AS locale FROM workspaces WHERE id=$1`,
      [ctx.workspaceId],
    );
    return row.rows[0]?.locale || "en";
  }
  /** In-app (and email when asked) to each person, never the one acting; once per key and person. */
  async notify(ctx: HrmsContext, notices: HrmsNotice[]) {
    if (!notices.length) return;
    const actor = await ctx.client.query<{ name: string }>(
      `SELECT display_name AS name FROM users WHERE id=$1`,
      [ctx.userId],
    );
    for (const notice of notices) {
      const variables = Object.fromEntries(
        NOTICE_VARIABLES.map((name) => [
          name,
          (name === "actor"
            ? (notice.variables.actor ?? actor.rows[0]?.name ?? "")
            : (notice.variables[name] ?? "")
          ).slice(0, 480),
        ]),
      );
      for (const userId of new Set(
        notice.users.filter((id) => id !== ctx.userId),
      )) {
        const base = {
          workspaceId: ctx.workspaceId,
          recipientUserId: userId,
          code: notice.code,
          eventType: notice.code,
          variables,
          deepLink: notice.deepLink,
        };
        await notifyUserInApp(ctx.client, {
          ...base,
          idempotencyKey: `${notice.key}:${userId}`,
        });
        if (notice.email)
          await queueUserEmail(ctx.client, {
            ...base,
            idempotencyKey: `${notice.key}:${userId}:email`,
          });
      }
    }
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
      `SELECT default_calendar_id AS "defaultCalendarId",fallback_approver_id AS "fallbackApproverId",max_gps_accuracy_m AS "maxGpsAccuracyM",max_capture_age_seconds AS "maxCaptureAgeSeconds",media_retention_days AS "mediaRetentionDays",site_documents::text[] AS "siteDocuments",version FROM hrms_settings WHERE workspace_id=$1`,
      [ctx.workspaceId],
    );
    if (!result.rowCount)
      throw new ConflictException("HRMS isn't set up for this workspace.");
    return result.rows[0];
  }
  async employee(
    ctx: HrmsContext,
    membershipId = ctx.membershipId,
    active = false,
  ): Promise<Employee> {
    const result = await ctx.client.query(
      `SELECT e.membership_id AS "membershipId",m.user_id AS "userId",u.display_name AS name,e.enabled,e.remote_allowed AS "remoteAllowed",e.manager_id AS "managerId",e.active_from::text AS "activeFrom",e.active_to::text AS "activeTo",e.version,
   jsonb_build_object('id',c.id,'name',c.name,'timezone',c.timezone,'workingDays',c.working_days,'holidays',c.holidays,'dayStart',to_char(c.day_start,'HH24:MI'),'halfDay',to_char(c.half_day,'HH24:MI'),'dayEnd',to_char(c.day_end,'HH24:MI'),'version',c.version) AS calendar,m.status
   FROM hrms_employees e JOIN workspace_memberships m ON m.workspace_id=e.workspace_id AND m.id=e.membership_id JOIN users u ON u.id=m.user_id JOIN hrms_calendars c ON c.workspace_id=e.workspace_id AND c.id=e.calendar_id WHERE e.workspace_id=$1 AND e.membership_id=$2`,
      [ctx.workspaceId, membershipId],
    );
    if (!result.rowCount)
      throw new NotFoundException(
        "This person isn't an active member of the workspace.",
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
        "Attendance and leave are switched off for you. Ask HR to switch them on.",
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
