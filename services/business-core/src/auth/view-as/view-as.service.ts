import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";
import { DatabaseService } from "../../database/database.service";
import { formatWhen } from "../../hrms/hrms-domain";
import { notifyUserInApp } from "../../notifications/default-templates";
import { assertValidIdempotencyKey } from "../../workspaces/provisioning-idempotency";
import type { RequestActor } from "../actor";
import { IdentityService } from "../identity.service";
import { MEMBER_PERMISSIONS } from "../module-access";
import type { ViewAsContext } from "./view-as.context";
import {
  VIEW_AS_MAX_RECORDED_ROUTES,
  ViewAsRuleError,
  planViewAsStart,
  safeReturnPath,
  viewAsDurationMinutes,
} from "./view-as.domain";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEW_AS = "workspace.view_as";

type OpenSessionRow = {
  id: string; workspaceId: string; kind: "person" | "role"; viewerUserId: string; viewerMembershipId: string;
  subjectUserId: string | null; subjectMembershipId: string | null; subjectRoleId: string | null; subjectName: string;
  subjectRoleLabel: string | null; returnPath: string | null; startedAt: Date; expiresAt: Date; expired: boolean;
  viewerAllowed: boolean; permissions: string[];
};

type SessionRow = {
  id: string; kind: "person" | "role"; viewerUserId: string; viewerName: string; subjectUserId: string | null;
  subjectName: string; subjectRoleLabel: string | null; returnPath: string | null; startedAt: Date; expiresAt: Date;
  endedAt: Date | null; endReason: string | null; version: number;
};

export type StartViewAsInput =
  | { kind: "person"; membershipId: string; returnPath?: string; minutes?: number }
  | { kind: "role"; roleId: string; returnPath?: string };

/**
 * View as (VA-1 to VA-4). An owner or administrator opens a read-only, time-boxed session as one team member (or
 * one role) after a recent MFA step-up. The session is bound to the viewer's own sign-in session, which stays
 * as it is; every request of that sign-in session then reads as the subject until exit or expiry. Start and end
 * are audited with the pages and routes opened, and the subject is told afterwards (a workspace setting).
 */
@Injectable()
export class ViewAsService {
  private readonly logger = new Logger(ViewAsService.name);

  constructor(private readonly database: DatabaseService, private readonly identities: IdentityService) {}

  /** The open session of this sign-in session, or null. An expired or no-longer-allowed one is ended here. */
  async resolve(actor: RequestActor): Promise<ViewAsContext | null> {
    const sessionId = actor.sessionId && UUID.test(actor.sessionId) ? actor.sessionId : null;
    const found = await this.database.query<OpenSessionRow>(
      `SELECT id, workspace_id AS "workspaceId", kind, viewer_user_id AS "viewerUserId",
              viewer_membership_id AS "viewerMembershipId", subject_user_id AS "subjectUserId",
              subject_membership_id AS "subjectMembershipId", subject_role_id AS "subjectRoleId",
              subject_name AS "subjectName", subject_role_label AS "subjectRoleLabel", return_path AS "returnPath",
              started_at AS "startedAt", expires_at AS "expiresAt", expired, viewer_allowed AS "viewerAllowed", permissions
         FROM view_as_open_session($1, $2, $3::uuid)`,
      [actor.provider, actor.subject, sessionId],
    );
    const row = found.rows[0];
    if (!row) return null;
    if (row.expired || !row.viewerAllowed) {
      await this.database.tenantTransaction(row.workspaceId, row.viewerUserId, (client) =>
        this.end(client, row.workspaceId, row.id, row.expired ? "expired" : "revoked"));
      return null;
    }
    // Every active member keeps their own attendance and leave (MEMBER_PERMISSIONS); so does the view of them.
    const permissions = new Set(row.permissions);
    for (const code of MEMBER_PERMISSIONS) permissions.add(code);
    return {
      sessionId: row.id, workspaceId: row.workspaceId, kind: row.kind, viewerUserId: row.viewerUserId,
      viewerMembershipId: row.viewerMembershipId, subjectUserId: row.subjectUserId,
      subjectMembershipId: row.subjectMembershipId, subjectRoleId: row.subjectRoleId, subjectName: row.subjectName,
      subjectRoleLabel: row.subjectRoleLabel, effectiveUserId: row.kind === "person" && row.subjectUserId ? row.subjectUserId : row.viewerUserId,
      permissions, startedAt: new Date(row.startedAt), expiresAt: new Date(row.expiresAt), returnPath: row.returnPath,
    };
  }

  /** Keeps one row per distinct page or route opened during the session, for the `view_as.ended` audit. */
  async recordVisit(viewAs: ViewAsContext, route: string) {
    try {
      await this.database.tenantTransaction(viewAs.workspaceId, viewAs.viewerUserId, (client) => client.query(
        `INSERT INTO view_as_session_views (workspace_id, session_id, route)
         SELECT $1::uuid, $2::uuid, $3::varchar
          WHERE EXISTS (SELECT 1 FROM view_as_session_views WHERE session_id = $2::uuid AND route = $3::varchar)
             OR (SELECT count(*) FROM view_as_session_views WHERE session_id = $2::uuid) < $4::int
         ON CONFLICT (session_id, route) DO UPDATE SET last_opened_at = now(), open_count = view_as_session_views.open_count + 1`,
        [viewAs.workspaceId, viewAs.sessionId, route, VIEW_AS_MAX_RECORDED_ROUTES]));
    } catch (error) {
      // The audit trail of pages is best effort; the read itself must not fail because of it.
      this.logger.warn(`View-as visit not recorded for ${viewAs.sessionId}: ${(error as Error).message}`);
    }
  }

  async start(actor: RequestActor, workspaceId: string, input: StartViewAsInput, suppliedKey: string | undefined) {
    let idempotencyKey: string;
    try { idempotencyKey = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    if (actor.viewAs) throw this.refusal(new ViewAsRuleError("view_as_chained"));
    const viewer = await this.identities.resolveActor(actor);
    const viewerSessionId = actor.sessionId && UUID.test(actor.sessionId) ? actor.sessionId : null;
    return this.database.tenantTransaction(workspaceId, viewer.userId, async (client) => {
      const membership = await client.query<{ id: string; roles: string[]; canViewAs: boolean }>(
        `SELECT membership.id,
                COALESCE(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), '{}') AS roles,
                COALESCE(bool_or(permission.code = $3), false) AS "canViewAs"
           FROM workspace_memberships membership
           JOIN workspaces workspace ON workspace.id = membership.workspace_id AND workspace.status IN ('active', 'suspended')
           LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
           LEFT JOIN roles role ON role.id = assigned.role_id
           LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
           LEFT JOIN permissions permission ON permission.id = granted.permission_id
          WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
          GROUP BY membership.id`,
        [workspaceId, viewer.userId, VIEW_AS],
      );
      if (!membership.rowCount) throw new NotFoundException("Workspace not found");
      const viewerMembership = membership.rows[0];

      const replay = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1
        AND session.viewer_user_id = $2 AND session.idempotency_key = $3`, [workspaceId, viewer.userId, idempotencyKey]);
      if (replay.rowCount) return { ...this.summary(replay.rows[0]), replayed: true };

      let plan: { minutes: number };
      let subject: { userId: string | null; membershipId: string | null; roleId: string | null; name: string; roleLabel: string | null };
      try {
        if (input.kind === "person") {
          const found = await client.query<{ userId: string; name: string; active: boolean; roles: string[]; roleNames: string[]; operator: boolean }>(
            `SELECT membership.user_id AS "userId", app_user.display_name AS name,
                    membership.status = 'active' AS active,
                    COALESCE(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), '{}') AS roles,
                    COALESCE(array_agg(DISTINCT role.name ORDER BY role.name) FILTER (WHERE role.name IS NOT NULL), '{}') AS "roleNames",
                    EXISTS (SELECT 1 FROM platform_administrators operator
                             WHERE operator.user_id = membership.user_id AND operator.status = 'active') AS operator
               FROM workspace_memberships membership
               JOIN users app_user ON app_user.id = membership.user_id
               LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
               LEFT JOIN roles role ON role.id = assigned.role_id
              WHERE membership.workspace_id = $1 AND membership.id = $2
              GROUP BY membership.id, app_user.id`,
            [workspaceId, input.membershipId],
          );
          const row = found.rows[0];
          plan = planViewAsStart({ kind: "person", chained: false, minutes: input.minutes,
            viewer: { userId: viewer.userId, roles: viewerMembership.roles, canViewAs: viewerMembership.canViewAs },
            subject: row ? { userId: row.userId, active: row.active, roles: row.roles, operator: row.operator } : null });
          subject = { userId: row!.userId, membershipId: input.membershipId, roleId: null, name: row!.name,
            roleLabel: row!.roleNames.join(", ").slice(0, 200) || null };
        } else {
          const found = await client.query<{ code: string; name: string }>(
            `SELECT code, name FROM roles WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.roleId]);
          const row = found.rows[0];
          plan = planViewAsStart({ kind: "role", chained: false,
            viewer: { userId: viewer.userId, roles: viewerMembership.roles, canViewAs: viewerMembership.canViewAs },
            role: row ? { code: row.code } : null });
          subject = { userId: null, membershipId: null, roleId: input.roleId, name: row!.name, roleLabel: row!.name };
        }
      } catch (error) {
        if (error instanceof ViewAsRuleError) throw this.refusal(error);
        throw error;
      }

      // A view left open in another window of the same viewer is replaced (and audited as such).
      const open = await client.query<{ id: string }>(
        `SELECT id FROM view_as_sessions WHERE workspace_id = $1 AND viewer_user_id = $2 AND ended_at IS NULL FOR UPDATE`,
        [workspaceId, viewer.userId]);
      for (const previous of open.rows) await this.end(client, workspaceId, previous.id, "replaced");

      const created = await client.query<{ id: string }>(
        `INSERT INTO view_as_sessions (workspace_id, kind, viewer_user_id, viewer_membership_id, viewer_session_id,
           subject_user_id, subject_membership_id, subject_role_id, subject_name, subject_role_label, return_path,
           started_at, expires_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now() + make_interval(mins => $12), $13)
         RETURNING id`,
        [workspaceId, input.kind, viewer.userId, viewerMembership.id, viewerSessionId, subject.userId, subject.membershipId,
          subject.roleId, subject.name.slice(0, 200), subject.roleLabel, safeReturnPath(input.returnPath), plan.minutes, idempotencyKey],
      );
      const sessionId = created.rows[0].id;
      await recordAudit(client, {
        workspaceId, actorUserId: viewer.userId, action: "view_as.started", entityType: "view_as_session", entityId: sessionId,
        after: { kind: input.kind, subjectUserId: subject.userId, subjectRoleId: subject.roleId, subjectName: subject.name,
          minutes: plan.minutes, accessLevel: "read_only" },
      });
      const saved = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1 AND session.id = $2`, [workspaceId, sessionId]);
      return { ...this.summary(saved.rows[0]), replayed: false };
    });
  }

  /** Leaves the view: the viewer's own session carries on. Exiting a view that already ended is a no-op. */
  async exit(actor: RequestActor, workspaceId: string, sessionId: string) {
    const viewerUserId = actor.viewAs?.viewerUserId ?? (await this.identities.resolveActor(actor)).userId;
    return this.database.tenantTransaction(workspaceId, viewerUserId, async (client) => {
      const found = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1 AND session.id = $2
        AND session.viewer_user_id = $3`, [workspaceId, sessionId, viewerUserId]);
      if (!found.rowCount) throw new NotFoundException("View not found");
      const session = found.rows[0];
      const ended = session.endedAt ? null : await this.end(client, workspaceId, sessionId,
        session.expiresAt.getTime() <= Date.now() ? "expired" : "exited");
      return { sessionId, returnPath: session.returnPath, endedAt: ended?.endedAt ?? session.endedAt, endReason: ended?.endReason ?? session.endReason };
    });
  }

  /** The signed-in person's own record of who viewed as them (Security > Activity). It can't be switched off. */
  async aboutMe(actor: RequestActor, workspaceId: string) {
    const me = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, me.userId, async (client) => {
      await this.assertMember(client, workspaceId, me.userId);
      const sessions = await client.query<SessionRow>(`${this.select()} WHERE session.workspace_id = $1
        AND session.subject_user_id = $2 ORDER BY session.started_at DESC LIMIT 100`, [workspaceId, me.userId]);
      return { sessions: sessions.rows.map((row) => ({
        id: row.id, viewerName: row.viewerName, startedAt: row.startedAt,
        endedAt: row.endedAt, minutes: row.endedAt ? viewAsDurationMinutes(row.startedAt, row.endedAt) : null,
        open: !row.endedAt,
      })) };
    });
  }

  async settings(actor: RequestActor, workspaceId: string) {
    const me = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, me.userId, async (client) => {
      await this.assertCanViewAs(client, workspaceId, me.userId);
      return this.readSettings(client, workspaceId);
    });
  }

  async updateSettings(actor: RequestActor, workspaceId: string, input: { notifySubject: boolean; version: number }) {
    const me = await this.identities.resolveActor(actor);
    return this.database.tenantTransaction(workspaceId, me.userId, async (client) => {
      await this.assertCanViewAs(client, workspaceId, me.userId);
      const before = await this.readSettings(client, workspaceId, true);
      if (before.version !== input.version) throw new ConflictException("This setting changed. Refresh and try again.");
      if (before.notifySubject === input.notifySubject) return before;
      await client.query(
        `INSERT INTO workspace_view_as_settings (workspace_id, notify_subject, version, updated_by)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (workspace_id) DO UPDATE SET notify_subject = EXCLUDED.notify_subject,
           version = workspace_view_as_settings.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [workspaceId, input.notifySubject, me.userId]);
      const after = await this.readSettings(client, workspaceId);
      await recordAudit(client, { workspaceId, actorUserId: me.userId, action: "view_as.settings_changed",
        entityType: "workspace_view_as_settings", entityId: workspaceId, before, after });
      return after;
    });
  }

  /** Sweep (control plane, every few minutes): views past their time end, and their subjects are told. */
  async sweep(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const due = await client.query<{ id: string }>(
        `SELECT id FROM view_as_sessions WHERE workspace_id = $1 AND ended_at IS NULL AND expires_at <= now() FOR UPDATE SKIP LOCKED`,
        [workspaceId]);
      let expired = 0;
      for (const session of due.rows) if (await this.end(client, workspaceId, session.id, "expired")) expired += 1;
      return { expired };
    });
  }

  /**
   * Ends one open session once: the audit carries the pages and routes opened, and the subject of a person view
   * gets the in-app notice unless the workspace turned it off. Returns null when it had already ended.
   */
  private async end(client: Db, workspaceId: string, sessionId: string, reason: "exited" | "expired" | "replaced" | "revoked") {
    const ended = await client.query<{ kind: "person" | "role"; viewerUserId: string; subjectUserId: string | null;
      subjectRoleId: string | null; subjectName: string; startedAt: Date; endedAt: Date; endReason: string }>(
      `UPDATE view_as_sessions
          SET ended_at = CASE WHEN $3::text = 'expired' THEN LEAST(now(), expires_at) ELSE now() END,
              end_reason = $3::varchar, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND ended_at IS NULL
        RETURNING kind, viewer_user_id AS "viewerUserId", subject_user_id AS "subjectUserId",
                  subject_role_id AS "subjectRoleId", subject_name AS "subjectName", started_at AS "startedAt",
                  ended_at AS "endedAt", end_reason AS "endReason"`,
      [workspaceId, sessionId, reason]);
    const session = ended.rows[0];
    if (!session) return null;
    const routes = await client.query<{ route: string; count: number }>(
      `SELECT route, open_count AS count FROM view_as_session_views WHERE workspace_id = $1 AND session_id = $2
        ORDER BY first_opened_at, route`, [workspaceId, sessionId]);
    const minutes = viewAsDurationMinutes(new Date(session.startedAt), new Date(session.endedAt));
    await recordAudit(client, {
      workspaceId, actorUserId: session.viewerUserId, action: "view_as.ended", entityType: "view_as_session", entityId: sessionId,
      after: { kind: session.kind, reason, subjectUserId: session.subjectUserId, subjectRoleId: session.subjectRoleId,
        subjectName: session.subjectName, startedAt: session.startedAt, endedAt: session.endedAt, minutes, routes: routes.rows },
    });
    if (session.kind === "person" && session.subjectUserId) {
      const context = await client.query<{ notify: boolean; viewerName: string; timeZone: string; locale: string }>(
        `SELECT COALESCE(setting.notify_subject, true) AS notify, viewer.display_name AS "viewerName",
                workspace.default_timezone AS "timeZone", workspace.default_locale AS locale
           FROM workspaces workspace
           JOIN users viewer ON viewer.id = $2
           LEFT JOIN workspace_view_as_settings setting ON setting.workspace_id = workspace.id
          WHERE workspace.id = $1`, [workspaceId, session.viewerUserId]);
      const facts = context.rows[0];
      if (facts?.notify) {
        const sent = await notifyUserInApp(client, {
          workspaceId, recipientUserId: session.subjectUserId, code: "workspace.viewed_as", eventType: "workspace.viewed_as",
          variables: { viewerName: facts.viewerName, minutes: String(minutes), startedAt: formatWhen(session.startedAt, facts.timeZone, facts.locale) },
          deepLink: "/workspace/settings/security#activity", idempotencyKey: `view_as:${sessionId}`,
        });
        if (sent.queued) await client.query(`UPDATE view_as_sessions SET subject_notified_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, sessionId]);
      }
    }
    return { endedAt: session.endedAt, endReason: session.endReason };
  }

  private async readSettings(client: Db, workspaceId: string, lock = false) {
    const found = await client.query<{ notifySubject: boolean; version: number }>(
      `SELECT notify_subject AS "notifySubject", version FROM workspace_view_as_settings WHERE workspace_id = $1${lock ? " FOR UPDATE" : ""}`,
      [workspaceId]);
    // No row yet: the notice is on, version 0.
    return found.rows[0] ?? { notifySubject: true, version: 0 };
  }

  private async assertMember(client: Db, workspaceId: string, userId: string) {
    const found = await client.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, userId]);
    if (!found.rowCount) throw new NotFoundException("Workspace not found");
  }

  private async assertCanViewAs(client: Db, workspaceId: string, userId: string) {
    const found = await client.query(
      `SELECT 1 FROM workspace_memberships membership
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $3
        WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' LIMIT 1`,
      [workspaceId, userId, VIEW_AS]);
    if (!found.rowCount) throw this.refusal(new ViewAsRuleError("view_as_not_allowed"));
  }

  private refusal(error: ViewAsRuleError) {
    return error.code === "view_as_role_not_found" || error.code === "view_as_not_a_member"
      ? new NotFoundException({ code: error.code, message: error.message })
      : new ForbiddenException({ code: error.code, message: error.message });
  }

  private summary(row: SessionRow) {
    return { sessionId: row.id, kind: row.kind, subjectName: row.subjectName, subjectRoleLabel: row.subjectRoleLabel,
      startedAt: row.startedAt, expiresAt: row.expiresAt, returnPath: row.returnPath };
  }

  private select() {
    return `SELECT session.id, session.kind, session.viewer_user_id AS "viewerUserId", viewer.display_name AS "viewerName",
        session.subject_user_id AS "subjectUserId", session.subject_name AS "subjectName",
        session.subject_role_label AS "subjectRoleLabel", session.return_path AS "returnPath",
        session.started_at AS "startedAt", session.expires_at AS "expiresAt", session.ended_at AS "endedAt",
        session.end_reason AS "endReason", session.version
      FROM view_as_sessions session
      JOIN users viewer ON viewer.id = session.viewer_user_id`;
  }
}

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
