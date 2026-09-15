import { Injectable } from "@nestjs/common";
import { PoolClient, QueryResult, QueryResultRow } from "pg";
import { ActorUser, RequestActor } from "./actor";
import { DatabaseService } from "../database/database.service";

export type AuthBootstrapNextAction =
  | "accept_invitation"
  | "start_onboarding"
  | "resume_onboarding"
  | "enter_workspace"
  | "await_invitation";

export function deriveWorkspaceOnboardingNextAction(
  status: string | null | undefined,
): Extract<AuthBootstrapNextAction, "start_onboarding" | "resume_onboarding" | "enter_workspace"> {
  if (status === "completed") return "enter_workspace";
  if (!status || status === "not_started") return "start_onboarding";
  return "resume_onboarding";
}

export function deriveAuthBootstrapNextAction(
  memberships: Array<{ onboarding: { status: string } }>,
  pendingInvitationCount: number,
): AuthBootstrapNextAction {
  if (memberships.length === 0) {
    return pendingInvitationCount > 0 ? "accept_invitation" : "await_invitation";
  }
  const unfinished = memberships.find(({ onboarding }) => onboarding.status !== "completed");
  if (!unfinished) return "enter_workspace";
  return deriveWorkspaceOnboardingNextAction(unfinished.onboarding.status);
}

@Injectable()
export class IdentityService {
  constructor(private readonly database: DatabaseService) {}

  async resolveActor(actor: RequestActor, client?: PoolClient): Promise<ActorUser> {
    const query = <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values: unknown[] = [],
    ): Promise<QueryResult<Row>> => client
      ? client.query<Row>(text, values)
      : this.database.query<Row>(text, values);

    const identity = await query<{ user_id: string }>(
      `SELECT user_id
       FROM user_identities
       WHERE provider = $1 AND provider_subject = $2`,
      [actor.provider, actor.subject],
    );

    if (identity.rowCount) {
      await query(
        `UPDATE user_identities
         SET email_at_provider = $1, last_login_at = now(), updated_at = now()
         WHERE provider = $2 AND provider_subject = $3`,
        [actor.email, actor.provider, actor.subject],
      );
      return { ...actor, userId: identity.rows[0].user_id };
    }

    const user = await query<{ id: string }>(
      `INSERT INTO users (primary_email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (primary_email)
       DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
       RETURNING id`,
      [actor.email, actor.displayName],
    );
    const userId = user.rows[0].id;

    const linkedIdentity = await query<{ user_id: string }>(
      `INSERT INTO user_identities
        (user_id, provider, provider_subject, email_at_provider, last_login_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET email_at_provider = EXCLUDED.email_at_provider,
                     last_login_at = now(), updated_at = now()
       RETURNING user_id`,
      [userId, actor.provider, actor.subject, actor.email],
    );

    return { ...actor, userId: linkedIdentity.rows[0]?.user_id ?? userId };
  }

  async getProfile(actor: RequestActor) {
    const actorUser = await this.resolveActor(actor);
    const user = await this.database.query<{
      id: string;
      primaryEmail: string;
      displayName: string;
      preferredLocale: string;
      preferredTimezone: string;
      status: string;
    }>(
      `SELECT id, primary_email AS "primaryEmail", display_name AS "displayName",
              preferred_locale AS "preferredLocale",
              preferred_timezone AS "preferredTimezone", status
       FROM users WHERE id = $1`,
      [actorUser.userId],
    );
    const platformAccess = await this.database.query<{ role: string }>(
      `SELECT role FROM platform_administrators
       WHERE user_id = $1 AND status = 'active'`,
      [actorUser.userId],
    );
    const memberships = await this.database.actorTransaction(actorUser.userId, (client) =>
      client.query<{
        id: string;
        workspaceId: string;
        workspaceName: string;
        workspaceSlug: string;
        workspaceStatus: string;
        workspaceLogoUrl: string | null;
        workspacePrimaryColor: string | null;
        accountId: string | null;
        accountName: string | null;
        accountRole: string | null;
        isDefaultOrganization: boolean;
        status: string;
      }>(
        `SELECT membership.id, membership.workspace_id AS "workspaceId",
                workspace.name AS "workspaceName", workspace.slug AS "workspaceSlug",
                workspace.status AS "workspaceStatus", membership.status,
                linked.account_id AS "accountId", account.display_name AS "accountName",
                account_member.role AS "accountRole",
                COALESCE(linked.is_default, false) AS "isDefaultOrganization",
                CASE WHEN branding.logo_asset_id IS NOT NULL
                     THEN '/api/auth/tenant-logo/' || workspace.slug || '?v=' || branding.logo_asset_id::text
                     ELSE branding.logo_url END AS "workspaceLogoUrl",
                branding.primary_color AS "workspacePrimaryColor"
         FROM workspace_memberships membership
         JOIN workspaces workspace ON workspace.id = membership.workspace_id
         LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
         LEFT JOIN customer_account_organizations linked ON linked.workspace_id = workspace.id
         LEFT JOIN customer_accounts account ON account.id = linked.account_id
         LEFT JOIN customer_account_memberships account_member
           ON account_member.account_id = linked.account_id
          AND account_member.user_id = membership.user_id
          AND account_member.status = 'active'
         WHERE membership.user_id = $1
           AND membership.status = 'active'
           AND workspace.status = 'active'
         ORDER BY workspace.name`,
        [actorUser.userId],
      ),
    );
    const withRoles = [];
    for (const membership of memberships.rows) {
      const tenantAccess = await this.database.tenantTransaction(
        membership.workspaceId,
        actorUser.userId,
        async (client) => {
          const roles = await client.query<{ code: string }>(
            `SELECT role.code
             FROM member_roles assigned
             JOIN roles role ON role.id = assigned.role_id
             WHERE assigned.membership_id = $1
             ORDER BY role.code`,
            [membership.id],
          );
          const onboarding = await client.query<{
            status: string;
            currentStep: string | null;
            completedSteps: string[];
            version: number;
          }>(
            `SELECT status, NULLIF(current_step, 'complete') AS "currentStep",
                    completed_steps AS "completedSteps", version
             FROM workspace_onboarding
             WHERE workspace_id = $1`,
            [membership.workspaceId],
          );
          return { roles: roles.rows, onboarding: onboarding.rows[0] };
        },
      );
      withRoles.push({
        id: membership.id,
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspaceName,
        workspaceSlug: membership.workspaceSlug,
        workspaceStatus: membership.workspaceStatus,
        workspaceLogoUrl: membership.workspaceLogoUrl,
        workspacePrimaryColor: membership.workspacePrimaryColor,
        accountId: membership.accountId,
        accountName: membership.accountName,
        accountRole: membership.accountRole,
        isDefaultOrganization: membership.isDefaultOrganization,
        status: membership.status,
        roles: tenantAccess.roles.map((role) => role.code),
        onboarding: tenantAccess.onboarding,
      });
    }

    const pendingInvitations = await this.database.actorTransaction(
      actorUser.userId,
      (client) => client.query<{
        id: string;
        workspaceId: string;
        workspaceName: string;
        workspaceSlug: string;
        expiresAt: Date;
      }>(
        `SELECT invitation.id, invitation.workspace_id AS "workspaceId",
                workspace.name AS "workspaceName", workspace.slug AS "workspaceSlug",
                invitation.expires_at AS "expiresAt"
         FROM workspace_invitations invitation
         JOIN workspaces workspace ON workspace.id = invitation.workspace_id
         WHERE invitation.email = $1
           AND invitation.status = 'pending'
           AND invitation.expires_at > now()
         ORDER BY invitation.created_at`,
        [actorUser.email],
      ),
    );

    return {
      ...user.rows[0],
      platformRole: platformAccess.rows[0]?.role ?? null,
      identity: { provider: actor.provider, subject: actor.subject },
      memberships: withRoles,
      pendingInvitations: pendingInvitations.rows,
      nextAction: deriveAuthBootstrapNextAction(withRoles, pendingInvitations.rowCount ?? 0),
    };
  }
}
