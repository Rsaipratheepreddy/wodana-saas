import { acceptPendingInvitation } from "../workspaces/invitation-acceptance";
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { configuredDeviceLimit, sessionDeviceLimit } from "./session-policy";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import * as jwt from "jsonwebtoken";
import { DatabaseService } from "../database/database.service";
import { deriveWorkspaceOnboardingNextAction, IdentityService } from "./identity.service";
import { RequestActor } from "./actor";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { hashOpaqueToken, hashPassword, verifyPassword } from "./local-password";
import { MfaService, MfaSessionAssurance } from "./mfa.service";
import { PLATFORM_OPERATOR_ROLES } from "./platform-operator-policy";

interface LoginMetadata {
  ipAddress?: string;
  userAgent?: string;
  currentRefreshToken?: string;
  revokeFamilyId?: string;
  verifiedPasswordHash?: string;
}

interface LocalUserRow {
  id: string;
  primaryEmail: string;
  displayName: string;
  status: string;
  passwordHash: string;
  passwordSalt: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
}

interface RefreshRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  email: string;
  displayName: string;
  subject: string;
  authenticationMethods: string[];
  mfaVerifiedAt: Date | null;
  mfaSessionVersion: number;
  currentMfaSessionVersion: number;
  mfaEnrollmentDeadline: Date | null;
}

export interface SecuritySessionRow {
  familyId: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_EMAILS_PER_HOUR = 3;
/** The tenant's own sign-in background (tenant_login_branding columns), versioned by its asset; null: the default. */
const LOGIN_BACKGROUND_URL = `CASE WHEN login_background_asset_id IS NOT NULL
                   THEN '/api/auth/tenant-background/' || login_slug || '?v=' || login_background_asset_id::text
                   END AS "loginBackgroundUrl"`;

/** Raised inside the activation transaction; the failed attempt is recorded after its rollback. */
class ExistingAccountPasswordError extends Error {
  constructor(readonly userId: string) {
    super("existing account password mismatch");
  }
}

@Injectable()
export class LocalAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly identities: IdentityService,
    private readonly email: TransactionalEmailService,
    private readonly mfa: MfaService,
  ) {}

  async getTenantBranding(loginSlug: string) {
    const result = await this.database.query<{
      displayName: string;
      loginSlug: string;
      logoUrl: string | null;
      primaryColor: string | null;
      secondaryColor: string | null;
      headingFont: string | null;
      bodyFont: string | null;
      loginBackgroundUrl: string | null;
    }>(
      `SELECT display_name AS "displayName", login_slug AS "loginSlug",
              CASE WHEN logo_asset_id IS NOT NULL
                   THEN '/api/auth/tenant-logo/' || login_slug || '?v=' || logo_asset_id::text
                   ELSE logo_url END AS "logoUrl",
              primary_color AS "primaryColor", secondary_color AS "secondaryColor",
              heading_font AS "headingFont", body_font AS "bodyFont",
              ${LOGIN_BACKGROUND_URL}
       FROM tenant_login_branding WHERE login_slug = $1 AND tenant_login_open(workspace_id)`,
      [loginSlug.toLowerCase()],
    );
    if (!result.rowCount) throw new NotFoundException("Tenant login was not found");
    return result.rows[0];
  }

  async resolveOrganization(identifier: string) {
    const value = identifier.trim().toLowerCase();
    if (!value || value.length > 160) throw new NotFoundException("Organization was not found");
    const slug = value.replace(/\s+/g, "-");
    // Public branding is readable without an actor; workspace rows are RLS-protected. An archived organization's
    // login address is closed (tenant_login_open). The login flow independently enforces active workspace membership.
    const fields = `SELECT branding.display_name AS "displayName", branding.login_slug AS "loginSlug",
              CASE WHEN branding.logo_asset_id IS NOT NULL
                   THEN '/api/auth/tenant-logo/' || branding.login_slug || '?v=' || branding.logo_asset_id::text
                   ELSE branding.logo_url END AS "logoUrl",
              branding.primary_color AS "primaryColor", branding.secondary_color AS "secondaryColor",
              branding.heading_font AS "headingFont", branding.body_font AS "bodyFont"
       FROM tenant_login_branding branding
       WHERE tenant_login_open(branding.workspace_id) AND `;
    const direct = await this.database.query<{
      displayName: string; loginSlug: string; logoUrl: string | null;
      primaryColor: string | null; secondaryColor: string | null;
      headingFont: string | null; bodyFont: string | null;
    }>(`${fields}(branding.login_slug = $1 OR branding.workspace_id::text = $2)
       ORDER BY CASE WHEN branding.login_slug = $1 THEN 0 ELSE 1 END LIMIT 1`, [slug, value]);
    if (direct.rowCount) return direct.rows[0];
    const byName = await this.database.query<{
      displayName: string; loginSlug: string; logoUrl: string | null;
      primaryColor: string | null; secondaryColor: string | null;
      headingFont: string | null; bodyFont: string | null;
    }>(`${fields}lower(branding.display_name) = $1 LIMIT 2`, [value]);
    if (!byName.rowCount) throw new NotFoundException("Organization was not found");
    if (byName.rowCount > 1) throw new ConflictException("More than one organization has this name. Use its slug or ID.");
    return byName.rows[0];
  }

  async getTenantBrandingForHost(hostname: string) {
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname) || hostname.length > 253) {
      throw new NotFoundException("Tenant login was not found");
    }
    // The custom domain's tenant, with its sign-in background (public branding, as the slug's own lookup reads it).
    const result = await this.database.query<{
      displayName: string; loginSlug: string; logoUrl: string | null; primaryColor: string | null;
      secondaryColor: string | null; headingFont: string | null; bodyFont: string | null; loginBackgroundUrl: string | null;
    }>(
      `SELECT host.*, ${LOGIN_BACKGROUND_URL}
       FROM wodana_public_tenant_host($1::varchar) host
       LEFT JOIN tenant_login_branding ON tenant_login_branding.login_slug = host."loginSlug"`,
      [hostname.toLowerCase()],
    );
    if (!result.rowCount) throw new NotFoundException("Tenant login was not found");
    return result.rows[0];
  }

  async login(email: string, password: string, tenantSlug: string | undefined, metadata: LoginMetadata = {}) {
    this.assertLocalAuthAvailable();
    const user = await this.verifyLocalPassword(email, password);

    if (!tenantSlug) {
      // Email-first sign-in: the verified user's active workspaces decide the next step.
      const workspaces = await this.activeLoginWorkspaces(user.id);
      if (!workspaces.length) throw new UnauthorizedException("Email, password, or tenant is incorrect");
      if (workspaces.length > 1) {
        // No session yet: the client resubmits with the chosen workspace's slug.
        return { workspaceSelectionRequired: true as const, workspaces };
      }
      tenantSlug = workspaces[0].loginSlug;
    }

    const branding = await this.database.query<{ workspaceId: string }>(
      `SELECT workspace_id AS "workspaceId" FROM tenant_login_branding WHERE login_slug = $1`,
      [tenantSlug.toLowerCase()],
    );
    const membership = branding.rowCount
      ? await this.database.actorTransaction(user.id, (client) => client.query(
        `SELECT membership.id FROM workspace_memberships membership
         JOIN workspaces workspace ON workspace.id = membership.workspace_id
         WHERE membership.workspace_id = $1
           AND membership.user_id = $2
           AND membership.status = 'active'
           AND workspace.status IN ('active', 'suspended')`,
        [branding.rows[0].workspaceId, user.id],
      ))
      : null;
    if (!branding.rowCount || !membership?.rowCount) {
      throw new UnauthorizedException("Email, password, or tenant is incorrect");
    }

    await this.recordSuccessfulPasswordLogin(user.id);

    return this.completePrimaryAuthentication(
      this.actorFor(user),
      user.id,
      branding.rows[0].workspaceId,
      user.passwordChangedAt,
      { ...metadata, verifiedPasswordHash: user.passwordHash },
    );
  }

  private async activeLoginWorkspaces(userId: string) {
    const result = await this.database.actorTransaction(userId, (client) => client.query<{
      workspaceId: string; name: string; loginSlug: string; logoUrl: string | null; primaryColor: string | null;
    }>(
      `SELECT workspace.id AS "workspaceId", COALESCE(branding.display_name, workspace.name) AS name,
              branding.login_slug AS "loginSlug",
              CASE WHEN branding.logo_asset_id IS NOT NULL
                   THEN '/api/auth/tenant-logo/' || branding.login_slug || '?v=' || branding.logo_asset_id::text
                   ELSE branding.logo_url END AS "logoUrl",
              branding.primary_color AS "primaryColor"
       FROM workspace_memberships membership
       JOIN workspaces workspace ON workspace.id = membership.workspace_id
       JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
       WHERE membership.user_id = $1 AND membership.status = 'active' AND workspace.status IN ('active', 'suspended')
       ORDER BY lower(COALESCE(branding.display_name, workspace.name))`,
      [userId],
    ));
    return result.rows;
  }

  async verifyPlatformCredentials(email: string, password: string) {
    this.assertLocalAuthAvailable();
    const user = await this.verifyLocalPassword(email, password);
    // Every scoped operator role signs in; what each one may do is enforced per route by its policy.
    const administrator = await this.database.query(
      `SELECT 1 FROM platform_administrators
       WHERE user_id = $1 AND status = 'active' AND role = ANY($2::text[])`,
      [user.id, [...PLATFORM_OPERATOR_ROLES]],
    );
    if (!administrator.rowCount) throw new UnauthorizedException("Email or password is incorrect");
    await this.recordSuccessfulPasswordLogin(user.id);
    return user;
  }

  private async verifyLocalPassword(email: string, password: string): Promise<LocalUserRow> {
    const result = await this.database.query<LocalUserRow>(
      `SELECT app_user.id, app_user.primary_email AS "primaryEmail",
              app_user.display_name AS "displayName", app_user.status,
              credential.password_hash AS "passwordHash",
              credential.password_salt AS "passwordSalt",
              credential.failed_attempts AS "failedAttempts",
              credential.locked_until AS "lockedUntil",
              credential.password_changed_at AS "passwordChangedAt"
       FROM users app_user
       JOIN local_auth_credentials credential ON credential.user_id = app_user.id
       WHERE app_user.primary_email = $1`,
      [email.toLowerCase()],
    );
    const user = result.rows[0];
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Email, password, or tenant is incorrect");
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        "Too many sign-in attempts. Try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const validPassword = await verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!validPassword) {
      await this.recordFailedPassword(user.id);
      throw new UnauthorizedException("Email, password, or tenant is incorrect");
    }

    return user;
  }

  private async recordFailedPassword(userId: string) {
    await this.database.query(
      `UPDATE local_auth_credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= $2
             THEN now() + ($3 * interval '1 minute') ELSE NULL END,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
    );
  }

  private async recordSuccessfulPasswordLogin(userId: string) {
    await this.database.query(
      `UPDATE local_auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE user_id = $1`,
      [userId],
    );
    await this.database.query(
      `UPDATE user_identities SET last_login_at = now(), updated_at = now()
       WHERE provider = 'local' AND provider_subject = $1`,
      [`local:${userId}`],
    );
  }

  async activateInvitation(invitationToken: string, password: string, metadata: LoginMetadata = {}) {
    this.assertLocalAuthAvailable();
    const tokenHash = hashOpaqueToken(invitationToken);
    const activated = await this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_invitation_token_hash', $1, true)", [tokenHash]);
      const invitation = await client.query<{
        id: string;
        workspaceId: string;
        email: string;
        status: string;
        expiresAt: Date;
        userId: string;
        displayName: string;
      }>(
        `SELECT invitation.id, invitation.workspace_id AS "workspaceId", invitation.email,
                invitation.status, invitation.expires_at AS "expiresAt",
                app_user.id AS "userId", app_user.display_name AS "displayName"
         FROM workspace_invitations invitation
         JOIN users app_user ON app_user.primary_email = invitation.email
         WHERE invitation.token_hash = $1`,
        [tokenHash],
      );
      const row = invitation.rows[0];
      if (!row) throw new NotFoundException("Invitation was not found");
      if (row.status !== "pending" || row.expiresAt.getTime() <= Date.now()) {
        throw new GoneException("Invitation is no longer active");
      }

      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [row.workspaceId]);
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [row.userId]);
      const locked = await client.query<{ status: string; expiresAt: Date }>(
        `SELECT status, expires_at AS "expiresAt" FROM workspace_invitations
         WHERE id = $1 FOR UPDATE`,
        [row.id],
      );
      if (!locked.rowCount || locked.rows[0].status !== "pending"
        || locked.rows[0].expiresAt.getTime() <= Date.now()) {
        throw new GoneException("Invitation is no longer active");
      }
      // A person who already has a Wodana password accepts with that password: an invitation link (which the inviter
      // can see) must never replace an existing account's password, or any inviter could take the account over.
      const existing = await client.query<{
        passwordHash: string; passwordSalt: string; lockedUntil: Date | null; passwordChangedAt: Date;
      }>(
        `SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt", locked_until AS "lockedUntil",
                password_changed_at AS "passwordChangedAt"
         FROM local_auth_credentials WHERE user_id = $1 FOR UPDATE`,
        [row.userId],
      );
      let credential: { passwordChangedAt: Date; passwordHash: string };
      if (existing.rowCount) {
        const current = existing.rows[0];
        if (current.lockedUntil && current.lockedUntil.getTime() > Date.now()) {
          throw new HttpException("Too many sign-in attempts. Try again later", HttpStatus.TOO_MANY_REQUESTS);
        }
        if (!(await verifyPassword(password, current.passwordSalt, current.passwordHash))) {
          throw new ExistingAccountPasswordError(row.userId);
        }
        await client.query(
          `UPDATE local_auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = now()
           WHERE user_id = $1`,
          [row.userId],
        );
        credential = { passwordChangedAt: current.passwordChangedAt, passwordHash: current.passwordHash };
      } else {
        const encoded = await hashPassword(password);
        const created = await client.query<{ passwordChangedAt: Date }>(
          `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
           VALUES ($1, $2, $3)
           RETURNING password_changed_at AS "passwordChangedAt"`,
          [row.userId, encoded.hash, encoded.salt],
        );
        credential = { passwordChangedAt: created.rows[0].passwordChangedAt, passwordHash: encoded.hash };
      }
      await client.query(
        `INSERT INTO user_identities
          (user_id, provider, provider_subject, email_at_provider, last_login_at)
         VALUES ($1, 'local', $2, $3, now())
         ON CONFLICT (provider, provider_subject) DO UPDATE SET
           email_at_provider = EXCLUDED.email_at_provider, last_login_at = now(), updated_at = now()`,
        [row.userId, `local:${row.userId}`, row.email],
      );
      const accepted = await acceptPendingInvitation(client, { invitationId: row.id, userId: row.userId });
      await client.query(
        `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, after, correlation_id)
         VALUES ($1, $2, 'user', 'workspace.invitation_accepted', 'workspace_membership', $3, $4::jsonb, $5)`,
        [row.workspaceId, row.userId, accepted.membershipId, JSON.stringify({ invitationId: row.id, email: row.email }), randomUUID()],
      );
      return { ...row, passwordChangedAt: credential.passwordChangedAt, passwordHash: credential.passwordHash };
    }).catch(async (error: unknown) => {
      if (!(error instanceof ExistingAccountPasswordError)) throw error;
      await this.recordFailedPassword(error.userId);
      throw new UnauthorizedException(
        "You already have a Wodana account. Enter your current password to accept this invitation, or reset it first.",
      );
    });

    return this.completePrimaryAuthentication({
      subject: `local:${activated.userId}`,
      provider: "local",
      email: activated.email.toLowerCase(),
      displayName: activated.displayName,
    }, activated.userId, activated.workspaceId, activated.passwordChangedAt, {
      ...metadata,
      verifiedPasswordHash: activated.passwordHash,
    });
  }

  async verifyMfaLogin(challengeToken: string, code: string, metadata: LoginMetadata = {}) {
    this.assertLocalAuthAvailable();
    const verified = await this.mfa.consumeLoginChallenge(challengeToken, code);
    return this.issueSession(
      verified.actor,
      verified.workspaceId,
      { ...metadata, verifiedPasswordHash: verified.passwordHash },
      verified.assurance,
    );
  }

  async refresh(refreshToken: string, metadata: LoginMetadata = {}) {
    this.assertLocalAuthAvailable();
    const tokenHash = hashOpaqueToken(refreshToken);
    const result = await this.database.transaction(async (client) => {
      const owner = await client.query<{ userId: string }>(
        'SELECT user_id AS "userId" FROM auth_refresh_sessions WHERE token_hash = $1', [tokenHash],
      );
      if (!owner.rowCount) throw new UnauthorizedException("Refresh session is invalid or expired");
      await this.lockSessions(client, owner.rows[0].userId);
      const result = await client.query<RefreshRow>(
        `SELECT session.id, session.user_id AS "userId", session.family_id AS "familyId",
                session.expires_at AS "expiresAt", session.revoked_at AS "revokedAt",
                app_user.primary_email AS email, app_user.display_name AS "displayName",
                identity.provider_subject AS subject,
                session.authentication_methods AS "authenticationMethods",
                session.mfa_verified_at AS "mfaVerifiedAt",
                session.mfa_session_version AS "mfaSessionVersion",
                app_user.mfa_session_version AS "currentMfaSessionVersion",
                session.mfa_enrollment_deadline AS "mfaEnrollmentDeadline"
         FROM auth_refresh_sessions session
         JOIN users app_user ON app_user.id = session.user_id
         JOIN user_identities identity ON identity.user_id = app_user.id AND identity.provider = 'local'
         WHERE session.token_hash = $1 AND app_user.status = 'active'
         FOR UPDATE OF session`,
        [tokenHash],
      );
      const prior = result.rows[0];
      if (!prior || prior.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException("Refresh session is invalid or expired");
      }
      if (prior.revokedAt) {
        await client.query(
          `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
           WHERE family_id = $1`,
          [prior.familyId],
        );
        return { reuseDetected: true as const };
      }
      if (prior.mfaSessionVersion !== prior.currentMfaSessionVersion) {
        throw new UnauthorizedException("Security settings changed. Sign in again");
      }

      const active = await this.activeSessions(client, prior.userId);
      const deviceLimit = this.deviceLimit(prior.userId);
      if (deviceLimit !== null && active.length > deviceLimit) {
        throw new UnauthorizedException("Device limit exceeded. Sign in to manage your devices.");
      }
      const nextToken = randomBytes(48).toString("base64url");
      const nextId = randomUUID();
      await client.query(
        `INSERT INTO auth_refresh_sessions
          (id, user_id, family_id, token_hash, expires_at, user_agent, ip_address,
           authentication_methods, mfa_verified_at, mfa_session_version, mfa_enrollment_deadline)
         VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 day'), $6, $7, $8::jsonb, $9, $10, $11)`,
        [nextId, prior.userId, prior.familyId, hashOpaqueToken(nextToken), REFRESH_TOKEN_DAYS,
          metadata.userAgent ?? active.find((session) => session.familyId === prior.familyId)?.userAgent ?? null,
          metadata.ipAddress ?? active.find((session) => session.familyId === prior.familyId)?.ipAddress ?? null,
          JSON.stringify(prior.authenticationMethods), prior.mfaVerifiedAt, prior.mfaSessionVersion,
          prior.mfaEnrollmentDeadline],
      );
      await client.query(
        `UPDATE auth_refresh_sessions SET revoked_at = now(), replaced_by_session_id = $2
         WHERE id = $1`,
        [prior.id, nextId],
      );

      const actor: RequestActor = {
        subject: prior.subject,
        provider: "local",
        email: prior.email,
        displayName: prior.displayName,
      };
      return {
        reuseDetected: false as const,
        accessToken: this.signAccessToken(actor, prior.familyId, {
          authenticationMethods: prior.authenticationMethods,
          mfaVerifiedAt: prior.mfaVerifiedAt ?? undefined,
          mfaSessionVersion: prior.mfaSessionVersion,
          mfaEnrollmentDeadline: prior.mfaEnrollmentDeadline ?? undefined,
        }),
        refreshToken: nextToken,
        accessTokenExpiresIn: this.accessTokenSeconds(),
        refreshTokenExpiresIn: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
      };
    });
    if (result.reuseDetected) {
      throw new UnauthorizedException("Refresh session reuse was detected");
    }
    const { reuseDetected: _reuseDetected, ...session } = result;
    return session;
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.database.transaction(async (client) => {
        const session = await client.query<{ userId: string; familyId: string }>(
          'SELECT user_id AS "userId", family_id AS "familyId" FROM auth_refresh_sessions WHERE token_hash = $1',
          [hashOpaqueToken(refreshToken)],
        );
        if (!session.rowCount) return;
        await this.lockSessions(client, session.rows[0].userId);
        await client.query(
          `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
           WHERE user_id = $1 AND family_id = $2`,
          [session.rows[0].userId, session.rows[0].familyId],
        );
      });
    }
    return { signedOut: true };
  }

  async mfaStatus(actor: RequestActor, workspaceId: string) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    return this.mfa.status(actorUser.userId, workspaceId);
  }

  async startTotpEnrollment(
    actor: RequestActor,
    refreshToken: string,
    workspaceId: string,
  ) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    await this.currentSession(actorUser.userId, refreshToken);
    return this.mfa.startTotpEnrollment(actorUser.userId, workspaceId);
  }

  async confirmTotpEnrollment(
    actor: RequestActor,
    refreshToken: string,
    workspaceId: string,
    code: string,
  ) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    const confirmed = await this.mfa.confirmTotpEnrollment(actorUser.userId, workspaceId, code);
    await this.updateSessionAssurance(actorUser.userId, current.familyId, confirmed.assurance);
    return {
      enabled: true,
      recoveryCodes: confirmed.recoveryCodes,
      accessToken: this.signAccessToken(actor, current.familyId, confirmed.assurance),
      accessTokenExpiresIn: this.accessTokenSeconds(),
    };
  }

  async stepUpMfa(
    actor: RequestActor,
    refreshToken: string,
    workspaceId: string,
    code: string,
  ) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    const assurance = await this.mfa.verifyForStepUp(actorUser.userId, workspaceId, code);
    await this.updateSessionAssurance(actorUser.userId, current.familyId, assurance);
    return {
      accessToken: this.signAccessToken(actor, current.familyId, assurance),
      accessTokenExpiresIn: this.accessTokenSeconds(),
      verifiedAt: assurance.mfaVerifiedAt,
      authenticationMethods: assurance.authenticationMethods,
    };
  }

  async rotateRecoveryCodes(actor: RequestActor, refreshToken: string, workspaceId: string) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    await this.currentSession(actorUser.userId, refreshToken);
    const recoveryCodes = await this.mfa.rotateRecoveryCodes(actorUser.userId, workspaceId);
    return { recoveryCodes };
  }

  async disableMfa(actor: RequestActor, refreshToken: string, workspaceId: string) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    const mfaSessionVersion = await this.mfa.disable(actorUser.userId, workspaceId);
    const assurance: MfaSessionAssurance = {
      authenticationMethods: ["pwd"],
      mfaSessionVersion,
    };
    await this.database.transaction(async (client) => {
      await this.lockSessions(client, actorUser.userId);
      await client.query(
        `UPDATE auth_refresh_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL`,
        [actorUser.userId, current.familyId],
      );
      await client.query(
        `UPDATE auth_refresh_sessions
         SET authentication_methods = '["pwd"]'::jsonb, mfa_verified_at = NULL,
             mfa_session_version = $3, mfa_enrollment_deadline = NULL
         WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL`,
        [actorUser.userId, current.familyId, mfaSessionVersion],
      );
    });
    if (actorUser.email) {
      await this.email.sendSecurityNotice({ email: actorUser.email, kind: "mfa_disabled", workspaceId }).catch(() => undefined);
    }
    return {
      enabled: false,
      accessToken: this.signAccessToken(actor, current.familyId, assurance),
      accessTokenExpiresIn: this.accessTokenSeconds(),
    };
  }

  async securityOverview(actor: RequestActor, refreshToken: string, workspaceId: string) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    const sessions = { rows: await this.database.transaction((client) =>
      this.activeSessions(client, actorUser.userId, current.familyId)) };
    if (!sessions.rows.some((session) => session.current)) {
      throw new UnauthorizedException("The current session is no longer active");
    }
    const credential = await this.database.query<{ passwordChangedAt: Date }>(
      `SELECT password_changed_at AS "passwordChangedAt"
       FROM local_auth_credentials WHERE user_id = $1`,
      [actorUser.userId],
    );
    return {
      authenticationMethod: actor.provider,
      passwordChangedAt: credential.rows[0]?.passwordChangedAt ?? null,
      policy: {
        accessTokenMinutes: this.accessTokenSeconds() / 60,
        refreshSessionDays: REFRESH_TOKEN_DAYS,
        maxFailedAttempts: MAX_FAILED_ATTEMPTS,
        lockMinutes: LOCK_MINUTES,
        minimumPasswordLength: 10,
        maxActiveDevices: this.deviceLimit(actorUser.userId),
      },
      mfa: await this.mfa.status(actorUser.userId, workspaceId),
      sessions: sessions.rows,
    };
  }

  async revokeSession(
    actor: RequestActor,
    familyId: string,
    refreshToken: string,
    workspaceId: string,
  ) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    if (current.familyId === familyId) {
      throw new ConflictException("Use Sign out to end the current session");
    }
    const revoked = await this.database.transaction(async (client) => {
      await this.lockSessions(client, actorUser.userId);
      return client.query<{ familyId: string }>(
      `UPDATE auth_refresh_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL
       RETURNING family_id AS "familyId"`,
      [actorUser.userId, familyId],
      );
    });
    if (!revoked.rowCount) throw new NotFoundException("The session is no longer active");
    await this.recordSecurityAudit(actorUser.userId, workspaceId, "security.session_revoked", familyId, { familyId });
    return { familyId, revoked: true };
  }

  async revokeOtherSessions(actor: RequestActor, refreshToken: string, workspaceId: string) {
    this.assertLocalAuthAvailable();
    const actorUser = await this.identities.resolveActor(actor);
    await this.assertWorkspaceMembership(actorUser.userId, workspaceId);
    const current = await this.currentSession(actorUser.userId, refreshToken);
    const revoked = await this.database.transaction(async (client) => {
      await this.lockSessions(client, actorUser.userId);
      return client.query<{ familyId: string }>(
      `UPDATE auth_refresh_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL AND expires_at > now()
       RETURNING family_id AS "familyId"`,
      [actorUser.userId, current.familyId],
      );
    });
    const count = new Set(revoked.rows.map((row) => row.familyId)).size;
    await this.recordSecurityAudit(
      actorUser.userId,
      workspaceId,
      "security.other_sessions_revoked",
      current.familyId,
      { count },
    );
    return { revoked: count };
  }

  async forgotPassword(email: string, tenantSlug: string | undefined) {
    this.assertLocalAuthAvailable();
    const user = await this.database.query<{ id: string }>(
      `SELECT app_user.id FROM users app_user
       JOIN local_auth_credentials credential ON credential.user_id = app_user.id
       WHERE app_user.primary_email = $1`,
      [email.toLowerCase()],
    );
    let developmentResetToken: string | undefined;
    if (!tenantSlug) {
      // Email-first recovery: brand the link with the user's first active workspace.
      const workspaces = user.rowCount ? await this.activeLoginWorkspaces(user.rows[0].id) : [];
      tenantSlug = workspaces[0]?.loginSlug ?? "";
    }
    const branding = await this.database.query<{ workspaceId: string }>(
      `SELECT workspace_id AS "workspaceId" FROM tenant_login_branding WHERE login_slug = $1`,
      [tenantSlug.toLowerCase()],
    );
    const membership = user.rowCount && branding.rowCount
      ? await this.database.actorTransaction(user.rows[0].id, (client) => client.query(
        `SELECT membership.id FROM workspace_memberships membership
         JOIN workspaces workspace ON workspace.id = membership.workspace_id
         WHERE membership.workspace_id = $1
           AND membership.user_id = $2
           AND membership.status = 'active'
           AND workspace.status IN ('active', 'suspended')`,
        [branding.rows[0].workspaceId, user.rows[0].id],
      ))
      : null;
    // At most RESET_EMAILS_PER_HOUR reset emails per person, with the same answer either way: a flood of requests can
    // neither fill someone's inbox nor hold up every workspace's email behind the shared send limiter.
    const recent = user.rowCount && membership?.rowCount
      ? await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM password_reset_tokens
         WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [user.rows[0].id],
      )
      : null;
    if (user.rowCount && membership?.rowCount && (recent?.rows[0]?.count ?? 0) < RESET_EMAILS_PER_HOUR) {
      const token = randomBytes(32).toString("base64url");
      await this.database.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 minutes')`,
        [user.rows[0].id, hashOpaqueToken(token)],
      );
      await this.email.sendPasswordReset({ email: email.toLowerCase(), resetToken: token, tenantSlug });
      if (this.config.get<string>("NODE_ENV") !== "production"
        && this.config.get<string>("EXPOSE_DEMO_AUTH_TOKENS", "false") === "true") {
        developmentResetToken = token;
      }
    }
    return {
      accepted: true,
      message: "If the account exists, password reset instructions have been issued.",
      ...(developmentResetToken ? { developmentResetToken } : {}),
    };
  }

  async resetPassword(resetToken: string, password: string) {
    this.assertLocalAuthAvailable();
    const encoded = await hashPassword(password);
    const userId = await this.database.transaction(async (client) => {
      const result = await client.query<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null }>(
        `SELECT id, user_id AS "userId", expires_at AS "expiresAt", used_at AS "usedAt"
         FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hashOpaqueToken(resetToken)],
      );
      const row = result.rows[0];
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
        throw new GoneException("Password reset token is invalid or expired");
      }
      await this.lockSessions(client, row.userId);
      await client.query(
        `UPDATE local_auth_credentials SET password_hash = $2, password_salt = $3,
           failed_attempts = 0, locked_until = NULL, password_changed_at = now(), updated_at = now()
         WHERE user_id = $1`,
        [row.userId, encoded.hash, encoded.salt],
      );
      // Any other reset link still in the inbox stops working too.
      await client.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [row.userId],
      );
      await client.query(
        `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
         WHERE user_id = $1`,
        [row.userId],
      );
      return row.userId;
    });
    const account = await this.database.query<{ email: string }>(`SELECT primary_email AS email FROM users WHERE id = $1`, [userId]);
    const workspace = (await this.activeLoginWorkspaces(userId))[0];
    if (account.rows[0]) {
      await this.email.sendSecurityNotice({ email: account.rows[0].email, kind: "password_changed", loginSlug: workspace?.loginSlug })
        .catch(() => undefined);
    }
    return { passwordReset: true };
  }

  /** Whether an active member of the workspace has a local password and sign-in identity (the operator CLI's sandbox). */
  async hasLocalPassword(workspaceId: string, userId: string) {
    const found = await this.database.tenantTransaction(workspaceId, userId, (client) => client.query(
      `SELECT 1 FROM workspace_memberships membership
         JOIN local_auth_credentials credential ON credential.user_id = membership.user_id
         JOIN user_identities identity ON identity.user_id = membership.user_id AND identity.provider = 'local'
        WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`,
      [workspaceId, userId]));
    return Boolean(found.rowCount);
  }

  /**
   * The operator CLI's sandbox (src/ops): gives an active member a local password, hashed as activating an invitation
   * does (scrypt), with their local sign-in identity. Not a sign-in: no session is issued. The same password again
   * changes nothing; a new one ends the member's sessions, as a password reset does. Audited in the workspace as an
   * internal change (the platform, not a person); the password itself is never stored or recorded.
   */
  async setMemberPassword(workspaceId: string, userId: string, password: string): Promise<{ changed: boolean }> {
    return this.database.tenantTransaction(workspaceId, userId, async (client) => {
      const member = await client.query<{ email: string }>(
        `SELECT app_user.primary_email AS email FROM workspace_memberships membership JOIN users app_user ON app_user.id = membership.user_id
          WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND app_user.status = 'active'`,
        [workspaceId, userId],
      );
      if (!member.rowCount) throw new NotFoundException("This person is not an active member of the workspace");
      await this.lockSessions(client, userId);
      const current = await client.query<{ passwordHash: string; passwordSalt: string }>(
        `SELECT password_hash AS "passwordHash", password_salt AS "passwordSalt" FROM local_auth_credentials WHERE user_id = $1`, [userId]);
      const identity = await client.query(`SELECT 1 FROM user_identities WHERE provider = 'local' AND provider_subject = $1`, [`local:${userId}`]);
      const credential = current.rows[0];
      const same = credential ? await verifyPassword(password, credential.passwordSalt, credential.passwordHash) : false;
      if (same && identity.rowCount) return { changed: false };
      if (!same) {
        const encoded = await hashPassword(password);
        await client.query(
          `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt, failed_attempts = 0, locked_until = NULL,
             password_changed_at = now(), updated_at = now()`,
          [userId, encoded.hash, encoded.salt],
        );
        if (credential) {
          await client.query(`UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`, [userId]);
        }
      }
      await client.query(
        `INSERT INTO user_identities (user_id, provider, provider_subject, email_at_provider)
         VALUES ($1, 'local', $2, $3)
         ON CONFLICT (provider, provider_subject) DO UPDATE SET email_at_provider = EXCLUDED.email_at_provider, updated_at = now()`,
        [userId, `local:${userId}`, member.rows[0].email.toLowerCase()],
      );
      await client.query(
        `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, after, correlation_id)
         VALUES ($1, NULL, 'internal', 'auth.local_password_set', 'user', $2, $3::jsonb, $4)`,
        [workspaceId, userId, JSON.stringify({ firstPassword: !credential }), randomUUID()],
      );
      return { changed: true };
    });
  }

  async ensureDemoAccount(workspaceId: string, email: string, password: string) {
    const user = await this.database.query<{ id: string; displayName: string }>(
      `SELECT id, display_name AS "displayName" FROM users WHERE primary_email = $1`,
      [email.toLowerCase()],
    );
    if (!user.rowCount) throw new NotFoundException("Demo owner was not provisioned");
    const userId = user.rows[0].id;
    const encoded = await hashPassword(password);
    await this.database.tenantTransaction(workspaceId, userId, async (client) => {
      await client.query(
        `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt, failed_attempts = 0, locked_until = NULL,
           password_changed_at = now(), updated_at = now()`,
        [userId, encoded.hash, encoded.salt],
      );
      await client.query(
        `INSERT INTO user_identities
          (user_id, provider, provider_subject, email_at_provider)
         VALUES ($1, 'local', $2, $3)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [userId, `local:${userId}`, email.toLowerCase()],
      );
      const membership = await client.query<{ id: string }>(
        `INSERT INTO workspace_memberships (workspace_id, user_id, status, joined_at)
         VALUES ($1, $2, 'active', now())
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active',
           joined_at = COALESCE(workspace_memberships.joined_at, now()), updated_at = now()
         RETURNING id`,
        [workspaceId, userId],
      );
      await client.query(
        `INSERT INTO member_roles (workspace_id, membership_id, role_id)
         SELECT $1, $2, id FROM roles WHERE workspace_id = $1 AND code = 'owner'
         ON CONFLICT DO NOTHING`,
        [workspaceId, membership.rows[0].id],
      );
      await client.query(
        `UPDATE workspace_invitations SET status = 'accepted', accepted_at = COALESCE(accepted_at, now()),
           updated_at = now() WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
        [workspaceId, email.toLowerCase()],
      );
      await client.query(
        `UPDATE workspace_onboarding SET status = 'completed', current_step = 'complete',
           completed_steps = '["workspace_profile","organization","team","integrations"]'::jsonb,
           started_at = COALESCE(started_at, now()), completed_at = COALESCE(completed_at, now()),
           updated_at = now() WHERE workspace_id = $1`,
        [workspaceId],
      );
    });
  }

  private actorFor(user: LocalUserRow): RequestActor {
    return {
      subject: `local:${user.id}`,
      provider: "local",
      email: user.primaryEmail.toLowerCase(),
      displayName: user.displayName,
    };
  }

  private async assertWorkspaceMembership(userId: string, workspaceId: string) {
    const membership = await this.database.actorTransaction(userId, (client) => client.query(
      `SELECT membership.id FROM workspace_memberships membership
       JOIN workspaces workspace ON workspace.id = membership.workspace_id
       WHERE membership.workspace_id = $1
         AND membership.user_id = $2
         AND membership.status = 'active'
         AND workspace.status IN ('active', 'suspended')`,
      [workspaceId, userId],
    ));
    if (!membership.rowCount) throw new ForbiddenException("Workspace access is required");
  }

  private async currentSession(userId: string, refreshToken: string) {
    const current = await this.database.query<{ familyId: string }>(
      `SELECT prior.family_id AS "familyId"
       FROM auth_refresh_sessions prior
       WHERE prior.user_id = $1 AND prior.token_hash = $2
         AND EXISTS (
           SELECT 1 FROM auth_refresh_sessions active
           WHERE active.user_id = prior.user_id AND active.family_id = prior.family_id
             AND active.revoked_at IS NULL AND active.expires_at > now()
         )`,
      [userId, hashOpaqueToken(refreshToken)],
    );
    if (!current.rowCount) throw new UnauthorizedException("The current session is no longer active");
    return current.rows[0];
  }

  private async updateSessionAssurance(
    userId: string,
    familyId: string,
    assurance: MfaSessionAssurance,
  ) {
    const updated = await this.database.query(
      `UPDATE auth_refresh_sessions
       SET authentication_methods = $3::jsonb, mfa_verified_at = $4,
           mfa_session_version = $5, mfa_enrollment_deadline = $6
       WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id`,
      [
        userId,
        familyId,
        JSON.stringify(assurance.authenticationMethods ?? ["pwd"]),
        assurance.mfaVerifiedAt ?? null,
        assurance.mfaSessionVersion,
        assurance.mfaEnrollmentDeadline ?? null,
      ],
    );
    if (!updated.rowCount) throw new UnauthorizedException("The current session is no longer active");
  }

  private async recordSecurityAudit(
    actorUserId: string,
    workspaceId: string,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    await this.database.tenantTransaction(workspaceId, actorUserId, (client) => client.query(
      `INSERT INTO audit_events
        (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
       VALUES ($1, $2, 'user', $3, 'auth_session', $4, NULL, $5::jsonb, $6)`,
      [workspaceId, actorUserId, action, entityId, JSON.stringify(after), randomUUID()],
    ));
  }

  private async lockSessions(client: PoolClient, userId: string) {
    // A per-user database lock covers every login, refresh, and revocation across servers.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  }

  private async activeSessions(client: PoolClient, userId: string, currentFamilyId?: string) {
    const result = await client.query<SecuritySessionRow>(
      `SELECT active.family_id AS "familyId", min(history.created_at) AS "createdAt",
              active.created_at AS "lastActiveAt", active.expires_at AS "expiresAt",
              active.user_agent AS "userAgent", active.ip_address AS "ipAddress",
              COALESCE(active.family_id = $2::uuid, false) AS current
       FROM auth_refresh_sessions active
       JOIN auth_refresh_sessions history ON history.family_id = active.family_id AND history.user_id = active.user_id
       WHERE active.user_id = $1 AND active.revoked_at IS NULL AND active.expires_at > now()
       GROUP BY active.id
       ORDER BY current DESC, active.created_at DESC, active.id`,
      [userId, currentFamilyId ?? null],
    );
    return result.rows;
  }

  private async completePrimaryAuthentication(
    actor: RequestActor,
    userId: string,
    workspaceId: string,
    passwordChangedAt: Date,
    metadata: LoginMetadata,
  ) {
    const decision = await this.mfa.beginPrimaryAuthentication({
      userId,
      workspaceId,
      passwordChangedAt,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });
    if (decision.challengeRequired) {
      return {
        mfaRequired: true,
        challengeToken: decision.challengeToken,
        challengeExpiresIn: decision.expiresInSeconds,
        methods: ["totp", "recovery_code"],
        selectedWorkspaceId: workspaceId,
      };
    }
    return this.issueSession(actor, workspaceId, metadata, decision.assurance);
  }

  private async issueSession(
    actor: RequestActor,
    selectedWorkspaceId: string,
    metadata: LoginMetadata,
    assurance: MfaSessionAssurance,
  ) {
    const user = await this.identities.resolveActor(actor);
    const profile = await this.identities.getProfile(actor);
    const selectedMembership = profile.memberships.find(
      (membership) => membership.workspaceId === selectedWorkspaceId,
    );
    const selectedProfile = selectedMembership
      ? {
          ...profile,
          nextAction: deriveWorkspaceOnboardingNextAction(selectedMembership.onboarding?.status, selectedMembership.roles),
        }
      : profile;
    const result = await this.database.transaction(async (client) => {
      await this.lockSessions(client, user.userId);
      if (metadata.verifiedPasswordHash) {
        const credential = await client.query(
          `SELECT 1 FROM local_auth_credentials credential JOIN users app_user ON app_user.id = credential.user_id
           WHERE credential.user_id = $1 AND credential.password_hash = $2 AND app_user.status = 'active'`,
          [user.userId, metadata.verifiedPasswordHash],
        );
        if (!credential.rowCount) throw new UnauthorizedException("Your account changed. Sign in again.");
      }

      if (metadata.revokeFamilyId) {
        // Credentials and tenant membership have already been verified. Only this user's family can be revoked.
        const revoked = await client.query(
          `UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
           WHERE user_id = $1 AND family_id = $2 AND revoked_at IS NULL RETURNING id`,
          [user.userId, metadata.revokeFamilyId],
        );
        if (revoked.rowCount) {
          await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [selectedWorkspaceId]);
          await client.query("SELECT set_config('app.current_actor_id', $1, true)", [user.userId]);
          await client.query(
            `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, after, correlation_id)
             VALUES ($1, $2, 'user', 'security.session_revoked', 'auth_session', $3, $4::jsonb, $5)`,
            [selectedWorkspaceId, user.userId, metadata.revokeFamilyId,
              JSON.stringify({ familyId: metadata.revokeFamilyId, reason: "device_limit" }), randomUUID()],
          );
        }
      }
      // A valid refresh token proves an existing browser session; user-agent strings do not.
      const current = metadata.currentRefreshToken ? await client.query<{ familyId: string }>(
        `SELECT family_id AS "familyId" FROM auth_refresh_sessions
         WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()`,
        [user.userId, hashOpaqueToken(metadata.currentRefreshToken)],
      ) : null;
      const sessions = await this.activeSessions(client, user.userId);
      const currentFamilyId = current?.rows[0]?.familyId;
      const deviceLimit = this.deviceLimit(user.userId);
      if (deviceLimit !== null && sessions.length - (currentFamilyId ? 1 : 0) >= deviceLimit) {
        // Return normally so any chosen logout commits even if more devices still need removal.
        return { blocked: true as const, sessions, deviceLimit };
      }
      if (currentFamilyId) {
        await client.query(
          'UPDATE auth_refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND family_id = $2',
          [user.userId, currentFamilyId],
        );
      }
      const refreshToken = randomBytes(48).toString("base64url");
      const familyId = randomUUID();
      await client.query(
        `INSERT INTO auth_refresh_sessions
          (user_id, family_id, token_hash, expires_at, user_agent, ip_address,
           authentication_methods, mfa_verified_at, mfa_session_version, mfa_enrollment_deadline)
         VALUES ($1, $2, $3, now() + ($4 * interval '1 day'), $5, $6, $7::jsonb, $8, $9, $10)`,
        [user.userId, familyId, hashOpaqueToken(refreshToken), REFRESH_TOKEN_DAYS,
          metadata.userAgent ?? null, metadata.ipAddress ?? null,
          JSON.stringify(assurance.authenticationMethods ?? ["pwd"]), assurance.mfaVerifiedAt ?? null,
          assurance.mfaSessionVersion, assurance.mfaEnrollmentDeadline ?? null],
      );
      return { blocked: false as const, refreshToken, familyId };
    });
    if (result.blocked) {
      throw new ConflictException({
        code: "DEVICE_LIMIT_REACHED",
        message: `You are already signed in on ${result.sessions.length} devices. You can use a maximum of ${result.deviceLimit} devices. Log out a device to continue.`,
        maxActiveDevices: result.deviceLimit,
        sessions: result.sessions,
      });
    }
    return {
      accessToken: this.signAccessToken(actor, result.familyId, assurance),
      refreshToken: result.refreshToken,
      accessTokenExpiresIn: this.accessTokenSeconds(),
      refreshTokenExpiresIn: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
      selectedWorkspaceId,
      profile: selectedProfile,
      mfa: {
        verified: Boolean(assurance.mfaVerifiedAt),
        authenticationMethods: assurance.authenticationMethods ?? ["pwd"],
        enrollmentRequired: Boolean(assurance.mfaEnrollmentDeadline),
        enrollmentDeadline: assurance.mfaEnrollmentDeadline ?? null,
      },
    };
  }

  private signAccessToken(
    actor: RequestActor,
    familyId: string,
    assurance: MfaSessionAssurance,
  ) {
    const mfaVerifiedAt = assurance.mfaVerifiedAt
      ? Math.floor(assurance.mfaVerifiedAt.getTime() / 1000)
      : undefined;
    const enrollmentDeadline = assurance.mfaEnrollmentDeadline
      ? Math.floor(assurance.mfaEnrollmentDeadline.getTime() / 1000)
      : undefined;
    return jwt.sign(
      {
        email: actor.email,
        email_verified: true,
        name: actor.displayName,
        provider: "local",
        sid: familyId,
        amr: assurance.authenticationMethods ?? ["pwd"],
        mfa: Boolean(mfaVerifiedAt),
        mfa_at: mfaVerifiedAt,
        mfa_version: assurance.mfaSessionVersion,
        mfa_enrollment_required: Boolean(enrollmentDeadline),
        mfa_enrollment_deadline: enrollmentDeadline,
      },
      this.config.getOrThrow<string>("LOCAL_AUTH_JWT_SECRET"),
      {
        algorithm: "HS256",
        subject: actor.subject,
        issuer: this.config.get<string>("LOCAL_AUTH_ISSUER", "wodana-local"),
        audience: this.config.get<string>("LOCAL_AUTH_AUDIENCE", "wodana-web"),
        expiresIn: this.accessTokenSeconds(),
      },
    );
  }

  /** How long a sign-in stays valid before a silent refresh: AUTH_ACCESS_TOKEN_MINUTES (5–1440), default 15. */
  private accessTokenSeconds() {
    const minutes = Number(this.config.get<string>("AUTH_ACCESS_TOKEN_MINUTES", ""));
    return Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440 ? minutes * 60 : ACCESS_TOKEN_SECONDS;
  }

  private deviceLimit(userId: string) {
    return sessionDeviceLimit(userId, this.config.get<string>("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", ""), configuredDeviceLimit(this.config.get<string>("AUTH_MAX_ACTIVE_DEVICES", "")));
  }

  private assertLocalAuthAvailable() {
    const mode = this.config.get<string>("AUTH_MODE", "development");
    if (!["local", "password"].includes(mode)
      || (this.config.get<string>("NODE_ENV") === "production" && mode !== "password")) {
      throw new NotFoundException("Local authentication is not enabled");
    }
  }
}
