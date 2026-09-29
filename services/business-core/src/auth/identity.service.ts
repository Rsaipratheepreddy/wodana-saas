import { Injectable } from "@nestjs/common";
import { PoolClient, QueryResult, QueryResultRow } from "pg";
import { ActorUser, RequestActor } from "./actor";
import { DatabaseService } from "../database/database.service";
import { allowedTenantModules, MEMBER_PERMISSIONS } from "./module-access";
import { deriveBillingAccessPolicy, effectiveEntitledModules } from "../workspaces/tenant-operations.domain";
import { effectiveTenantPermissionCodes } from "../workspaces/tenant-access.domain";

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
    // Viewing as someone reads as them, and leaves no "last sign-in" behind for either person.
    if (actor.viewAs) return { ...actor, userId: actor.viewAs.effectiveUserId };
    // An AI app's token names its person directly; it is not a sign-in, so no "last sign-in" is recorded.
    if (actor.mcp) return { ...actor, userId: actor.mcp.userId };
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
    // Viewing as someone: their name, roles and permissions (narrowed to the viewer's) in that one workspace;
    // the viewer keeps their own language and time zone.
    const viewAs = actor.viewAs ?? null;
    const user = await this.database.query<{
      id: string;
      primaryEmail: string;
      displayName: string;
      preferredLocale: string;
      preferredTimezone: string;
      status: string;
      feedbackEnabled: boolean;
    }>(
      `SELECT id, primary_email AS "primaryEmail", display_name AS "displayName",
              preferred_locale AS "preferredLocale",
              preferred_timezone AS "preferredTimezone", status, feedback_enabled AS "feedbackEnabled"
       FROM users WHERE id = $1`,
      [actorUser.userId],
    );
    const viewer = viewAs
      ? await this.database.query<{ preferredLocale: string; preferredTimezone: string }>(
        `SELECT preferred_locale AS "preferredLocale", preferred_timezone AS "preferredTimezone" FROM users WHERE id = $1`,
        [viewAs.viewerUserId],
      )
      : null;
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
        workspaceSecondaryColor: string | null;
        workspaceHeadingFont: string | null;
        workspaceBodyFont: string | null;
        workspaceLocale: string | null;
        workspaceCurrency: string | null;
        workspaceTimezone: string | null;
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
                branding.primary_color AS "workspacePrimaryColor",
                branding.secondary_color AS "workspaceSecondaryColor",
                branding.heading_font AS "workspaceHeadingFont",
                branding.body_font AS "workspaceBodyFont",
                workspace.default_locale AS "workspaceLocale",
                workspace.default_currency AS "workspaceCurrency",
                workspace.default_timezone AS "workspaceTimezone"
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
         ORDER BY workspace.name`,
        [actorUser.userId],
      ),
    );
    // A suspended organization stays readable (changes are refused by the write-block guard).
    const readable = (status: string) => status === "active" || status === "suspended";
    const unavailableOrganizations = memberships.rows
      .filter((membership) => !viewAs && !readable(membership.workspaceStatus))
      .map((membership) => ({
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspaceName,
        workspaceSlug: membership.workspaceSlug,
        workspaceStatus: membership.workspaceStatus,
        accountName: membership.accountName,
      }));
    const withRoles = [];
    for (const membership of memberships.rows.filter((item) => readable(item.workspaceStatus)
      && (!viewAs || item.workspaceId === viewAs.workspaceId))) {
      const tenantAccess = await this.database.tenantTransaction(
        membership.workspaceId,
        actorUser.userId,
        async (client) => {
          const roles = viewAs?.kind === "role"
            ? await client.query<{ code: string }>(`SELECT code FROM roles WHERE workspace_id = $1 AND id = $2`,
              [membership.workspaceId, viewAs.subjectRoleId])
            : await client.query<{ code: string }>(
              `SELECT role.code
               FROM effective_member_roles assigned
               JOIN roles role ON role.id = assigned.role_id
               WHERE assigned.membership_id = $1
               ORDER BY role.code`,
              [membership.id],
            );
          const permissions = viewAs
            ? { rows: [...viewAs.permissions].map((code) => ({ code })) }
            : await client.query<{ code: string }>(
            `SELECT DISTINCT permission.code
             FROM effective_member_roles assigned
             JOIN role_permissions granted ON granted.role_id = assigned.role_id
             JOIN permissions permission ON permission.id = granted.permission_id
             WHERE assigned.membership_id = $1`,
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
          const entitlements = await client.query<{ status: string; modules: string[]; version: number }>(
            `SELECT status,modules,version FROM effective_workspace_entitlements WHERE workspace_id=$1`,
            [membership.workspaceId],
          );
          const billing = await client.query<{
            contractStatus: "trial_uncontracted" | "contracted" | "expired" | null;
            trialEndsAt: Date | null;
            collectionStatus: "current" | "grace" | "past_due" | "collections" | "suspended" | "closed" | null;
            nextReviewAt: Date | null;
          }>(
            `SELECT contract.status AS "contractStatus", contract.trial_ends_at AS "trialEndsAt",
                    collection.status AS "collectionStatus", collection.next_review_at AS "nextReviewAt"
             FROM customer_account_organizations linked
             LEFT JOIN effective_account_contracts contract ON contract.account_id=linked.account_id
             LEFT JOIN LATERAL (
               SELECT status,next_review_at FROM account_collection_state_versions
               WHERE account_id=linked.account_id ORDER BY version DESC LIMIT 1
             ) collection ON true
             WHERE linked.workspace_id=$1`,
            [membership.workspaceId],
          );
          return { roles: roles.rows, permissions: permissions.rows, onboarding: onboarding.rows[0],
            entitlements: entitlements.rows[0] ?? null,
            billingAccess: deriveBillingAccessPolicy(billing.rows[0] ?? {}) };
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
        workspaceSecondaryColor: membership.workspaceSecondaryColor,
        workspaceHeadingFont: membership.workspaceHeadingFont,
        workspaceBodyFont: membership.workspaceBodyFont,
        // Every member formats money, dates and times the workspace's way.
        workspaceLocale: membership.workspaceLocale,
        workspaceCurrency: membership.workspaceCurrency,
        workspaceTimezone: membership.workspaceTimezone,
        accountId: membership.accountId,
        accountName: membership.accountName,
        accountRole: membership.accountRole,
        isDefaultOrganization: membership.isDefaultOrganization,
        status: membership.status,
        roles: tenantAccess.roles.map((role) => role.code),
        allowedPermissions: effectiveTenantPermissionCodes({
          status: membership.status,
          grantedPermissions: [...tenantAccess.permissions.map((permission) => permission.code), ...MEMBER_PERMISSIONS],
          entitlements: tenantAccess.entitlements,
        }),
        allowedModules: effectiveEntitledModules(
          allowedTenantModules(membership.status === "active"
            ? [...tenantAccess.permissions.map((permission) => permission.code), ...MEMBER_PERMISSIONS]
            : tenantAccess.permissions.map((permission) => permission.code)),
          tenantAccess.entitlements,
        ),
        entitlement: tenantAccess.entitlements
          ? { status: tenantAccess.entitlements.status, version: tenantAccess.entitlements.version }
          : { status: "not_configured", version: null },
        billingAccess: tenantAccess.billingAccess,
        onboarding: tenantAccess.onboarding,
      });
    }

    const pendingInvitations = viewAs ? { rows: [], rowCount: 0 } : await this.database.actorTransaction(
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
      ...(viewer?.rows[0] ?? {}),
      platformRole: viewAs ? null : platformAccess.rows[0]?.role ?? null,
      identity: { provider: actor.provider, subject: actor.subject },
      memberships: withRoles,
      unavailableOrganizations,
      pendingInvitations: pendingInvitations.rows,
      nextAction: deriveAuthBootstrapNextAction(withRoles, pendingInvitations.rowCount ?? 0),
      viewAs: viewAs ? {
        sessionId: viewAs.sessionId,
        kind: viewAs.kind,
        workspaceId: viewAs.workspaceId,
        subjectName: viewAs.subjectName,
        subjectRoleLabel: viewAs.subjectRoleLabel,
        startedAt: viewAs.startedAt.toISOString(),
        expiresAt: viewAs.expiresAt.toISOString(),
        returnPath: viewAs.returnPath,
      } : null,
    };
  }
}
