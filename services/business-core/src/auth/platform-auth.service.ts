import {
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { LocalAuthService } from "./local-auth.service";
import { hashOpaqueToken } from "./local-password";
import { MfaService } from "./mfa.service";
import {
  isPlatformOperatorRole,
  platformOperatorPermissions,
  type PlatformOperatorRole,
} from "./platform-operator-policy";

const CHALLENGE_MINUTES = 5;
const SESSION_HOURS = 8;

type DeviceMetadata = { ipAddress?: string; userAgent?: string };
type OperatorRow = {
  userId: string;
  email: string;
  displayName: string;
  passwordUnchanged: boolean;
  mfaSessionVersion: number;
  currentMfaSessionVersion: number;
  expiresAt: Date;
  consumedAt: Date | null;
  failedAttempts: number;
  maxAttempts: number;
  purpose: "login" | "enroll";
  id: string;
  ipAddress: string | null;
  role: PlatformOperatorRole;
};

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly localAuth: LocalAuthService,
    private readonly mfa: MfaService,
  ) {}

  async login(email: string, password: string, metadata: DeviceMetadata = {}) {
    const user = await this.localAuth.verifyPlatformCredentials(email, password);
    const enrolled = await this.mfa.platformMfaEnabled(user.id);
    const purpose = enrolled ? "login" : "enroll";
    const challengeToken = randomBytes(32).toString("base64url");
    await this.database.transaction(async (client) => {
      const current = await client.query<{ version: number }>(
        `SELECT mfa_session_version AS version FROM users WHERE id = $1 AND status = 'active'
         AND EXISTS (SELECT 1 FROM platform_administrators
                     WHERE user_id = $1 AND status = 'active')`,
        [user.id],
      );
      if (!current.rowCount) throw new UnauthorizedException("Operator access is unavailable");
      await client.query(
        `UPDATE platform_operator_challenges SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [user.id],
      );
      const created = await client.query(
        `INSERT INTO platform_operator_challenges
          (token_hash, user_id, purpose, credential_changed_at, mfa_session_version,
           expires_at, ip_address, user_agent)
         SELECT $1, credential.user_id, $3, credential.password_changed_at, $4,
                now() + ($5 * interval '1 minute'), $6, $7
         FROM local_auth_credentials credential
         WHERE credential.user_id = $2 AND credential.password_hash = $8
         RETURNING id`,
        [hashOpaqueToken(challengeToken), user.id, purpose,
          current.rows[0].version, CHALLENGE_MINUTES, metadata.ipAddress ?? null,
          metadata.userAgent ?? null, user.passwordHash],
      );
      if (!created.rowCount) throw new UnauthorizedException("Operator security changed. Sign in again");
      await this.audit(client, user.id, "operator.challenge_created", { purpose });
    });
    return { challengeToken, purpose, expiresInSeconds: CHALLENGE_MINUTES * 60 };
  }

  async startEnrollment(challengeToken: string) {
    return this.database.transaction(async (client) => {
      const challenge = await this.challenge(client, challengeToken, "enroll");
      const setup = await this.mfa.startTotpEnrollment(challenge.userId, null, client);
      await this.audit(client, challenge.userId, "operator.mfa_setup_started");
      return setup;
    });
  }

  async confirmEnrollment(challengeToken: string, code: string, metadata: DeviceMetadata = {}) {
    const outcome = await this.database.transaction(async (client) => {
      const challenge = await this.challenge(client, challengeToken, "enroll");
      const confirmed = await this.mfa.confirmTotpEnrollment(challenge.userId, null, code, client);
      if (confirmed.state !== "confirmed") {
        await this.failChallenge(client, challenge);
        return { state: confirmed.state };
      }
      await client.query(
        "UPDATE platform_operator_challenges SET consumed_at = now() WHERE id = $1",
        [challenge.id],
      );
      const session = await this.issueSession(client, challenge, confirmed.assurance.mfaSessionVersion, metadata);
      await this.audit(client, challenge.userId, "operator.mfa_enrolled");
      return { state: "verified" as const, ...session, recoveryCodes: confirmed.recoveryCodes };
    });
    if (outcome.state === "locked") this.tooManyAttempts();
    if (outcome.state !== "verified") throw new UnauthorizedException("Verification code is incorrect");
    return outcome;
  }

  async verify(challengeToken: string, factor: string, metadata: DeviceMetadata = {}) {
    const outcome = await this.database.transaction(async (client) => {
      const challenge = await this.challenge(client, challengeToken, "login");
      const result = await this.mfa.verifyPlatformFactor(
        client, challenge.userId, factor, challenge.ipAddress ?? undefined,
      );
      if (!result.ok) {
        const exhausted = await this.failChallenge(client, challenge);
        return { state: result.locked || exhausted ? "locked" as const : "invalid" as const };
      }
      await client.query(
        "UPDATE platform_operator_challenges SET consumed_at = now() WHERE id = $1",
        [challenge.id],
      );
      const session = await this.issueSession(client, challenge, challenge.currentMfaSessionVersion, metadata);
      await this.audit(client, challenge.userId, "operator.signed_in", { method: result.method });
      return { state: "verified" as const, ...session };
    });
    if (outcome.state === "locked") this.tooManyAttempts();
    if (outcome.state !== "verified") throw new UnauthorizedException("Verification code is incorrect");
    return outcome;
  }

  async session(token: string) {
    const result = await this.database.query<{
      userId: string; email: string; displayName: string; expiresAt: Date; role: string;
    }>(
      `SELECT session.user_id AS "userId", app_user.primary_email AS email,
              app_user.display_name AS "displayName", session.expires_at AS "expiresAt",
              operator.role
       FROM platform_operator_sessions session
       JOIN users app_user ON app_user.id = session.user_id AND app_user.status = 'active'
       JOIN platform_administrators operator ON operator.user_id = app_user.id
         AND operator.status = 'active'
       JOIN local_auth_credentials credential ON credential.user_id = app_user.id
         AND credential.password_changed_at = session.credential_changed_at
       JOIN user_mfa_credentials mfa ON mfa.user_id = app_user.id
         AND mfa.confirmed_at IS NOT NULL AND mfa.disabled_at IS NULL
       WHERE session.token_hash = $1 AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND session.mfa_session_version = app_user.mfa_session_version`,
      [hashOpaqueToken(token)],
    );
    if (!result.rowCount) throw new UnauthorizedException("Operator session has ended");
    const session = result.rows[0];
    if (!isPlatformOperatorRole(session.role)) throw new UnauthorizedException("Operator role is unavailable");
    return { ...session, role: session.role, permissions: platformOperatorPermissions(session.role) };
  }

  async logout(token: string) {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ userId: string }>(
        `UPDATE platform_operator_sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id AS "userId"`,
        [hashOpaqueToken(token)],
      );
      if (result.rowCount) await this.audit(client, result.rows[0].userId, "operator.signed_out");
    });
    return { revoked: true };
  }

  private async challenge(client: PoolClient, token: string, purpose: OperatorRow["purpose"]) {
    const result = await client.query<OperatorRow>(
      `SELECT challenge.id, challenge.user_id AS "userId", challenge.purpose,
              (challenge.credential_changed_at = credential.password_changed_at) AS "passwordUnchanged",
              challenge.mfa_session_version AS "mfaSessionVersion",
              app_user.mfa_session_version AS "currentMfaSessionVersion",
              challenge.expires_at AS "expiresAt", challenge.consumed_at AS "consumedAt",
              challenge.failed_attempts AS "failedAttempts", challenge.max_attempts AS "maxAttempts",
              challenge.ip_address AS "ipAddress",
              app_user.primary_email AS email, app_user.display_name AS "displayName",
              operator.role
       FROM platform_operator_challenges challenge
       JOIN users app_user ON app_user.id = challenge.user_id AND app_user.status = 'active'
       JOIN platform_administrators operator ON operator.user_id = app_user.id
         AND operator.status = 'active'
       JOIN local_auth_credentials credential ON credential.user_id = app_user.id
       WHERE challenge.token_hash = $1 FOR UPDATE OF challenge`,
      [hashOpaqueToken(token)],
    );
    const challenge = result.rows[0];
    if (!challenge || challenge.purpose !== purpose) throw new UnauthorizedException("Operator challenge is invalid");
    if (challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()
      || challenge.failedAttempts >= challenge.maxAttempts) {
      throw new GoneException("Operator challenge has expired");
    }
    if (!challenge.passwordUnchanged || challenge.mfaSessionVersion !== challenge.currentMfaSessionVersion) {
      throw new UnauthorizedException("Operator security changed. Sign in again");
    }
    if (!isPlatformOperatorRole(challenge.role)) throw new UnauthorizedException("Operator role is unavailable");
    return challenge;
  }

  private async issueSession(
    client: PoolClient, challenge: OperatorRow, mfaSessionVersion: number, metadata: DeviceMetadata,
  ) {
    const sessionToken = randomBytes(32).toString("base64url");
    await client.query(
      `INSERT INTO platform_operator_sessions
        (token_hash, user_id, credential_changed_at, mfa_session_version,
         mfa_verified_at, expires_at, ip_address, user_agent)
       SELECT $1, $2, challenge.credential_changed_at, $3, now(),
              now() + ($4 * interval '1 hour'), $5, $6
       FROM platform_operator_challenges challenge WHERE challenge.id = $7`,
      [hashOpaqueToken(sessionToken), challenge.userId,
        mfaSessionVersion, SESSION_HOURS, metadata.ipAddress ?? null,
        metadata.userAgent ?? null, challenge.id],
    );
    return { sessionToken, expiresInSeconds: SESSION_HOURS * 60 * 60,
      operator: {
        userId: challenge.userId,
        email: challenge.email,
        displayName: challenge.displayName,
        role: challenge.role,
        permissions: platformOperatorPermissions(challenge.role),
      } };
  }

  private async failChallenge(client: PoolClient, challenge: OperatorRow) {
    const attempts = challenge.failedAttempts + 1;
    await client.query(
      `UPDATE platform_operator_challenges SET failed_attempts = $2,
         consumed_at = CASE WHEN $2 >= max_attempts THEN now() ELSE consumed_at END
       WHERE id = $1`,
      [challenge.id, attempts],
    );
    return attempts >= challenge.maxAttempts;
  }

  private async audit(
    client: PoolClient, actorUserId: string, action: string, details: Record<string, unknown> = {},
  ) {
    await client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, details) VALUES ($1, $2, $3)`,
      [actorUserId, action, details],
    );
  }

  private tooManyAttempts(): never {
    throw new HttpException("Too many MFA attempts. Sign in again later", HttpStatus.TOO_MANY_REQUESTS);
  }
}
