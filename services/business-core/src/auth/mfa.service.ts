import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { hashOpaqueToken } from "./local-password";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  parseMfaEncryptionKey,
  recoveryCodeHash,
  verifyTotp,
} from "./mfa-crypto";

const SETUP_MINUTES = 10;
const CHALLENGE_MINUTES = 5;
const MAX_FACTOR_ATTEMPTS = 5;
const FACTOR_LOCK_MINUTES = 15;

export type MfaSecurityPolicy = {
  requireMfaForAdmins: boolean;
  requireMfaForAllUsers: boolean;
  recoveryCodeCount: number;
  enrollmentGraceDays: number;
  stepUpMinutes: number;
};

export type MfaSessionAssurance = {
  mfaVerifiedAt?: Date;
  authenticationMethods?: string[];
  mfaSessionVersion: number;
  mfaEnrollmentDeadline?: Date;
};

type CredentialRow = {
  userId: string;
  encryptedTotpSecret: string;
  encryptionNonce: string;
  encryptionAuthTag: string;
  encryptionKeyVersion: number;
  setupExpiresAt: Date;
  confirmedAt: Date | null;
  disabledAt: Date | null;
  lastUsedStep: string | number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
};

type PolicyContext = {
  accountId: string | null;
  accountName: string | null;
  policy: MfaSecurityPolicy;
  isAdministrator: boolean;
  required: boolean;
};

type FactorResult =
  | { ok: true; method: "totp" | "recovery_code" }
  | { ok: false; locked: boolean };

const DEFAULT_POLICY: MfaSecurityPolicy = {
  requireMfaForAdmins: true,
  requireMfaForAllUsers: false,
  recoveryCodeCount: 10,
  enrollmentGraceDays: 7,
  stepUpMinutes: 10,
};

@Injectable()
export class MfaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async beginPrimaryAuthentication(input: {
    userId: string;
    workspaceId: string;
    passwordChangedAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<
    | { challengeRequired: true; challengeToken: string; expiresInSeconds: number }
    | { challengeRequired: false; assurance: MfaSessionAssurance }
  > {
    return this.database.transaction(async (client) => {
      await this.setActorContext(client, input.workspaceId, input.userId);
      const credential = await this.credential(client, input.userId);
      const policy = await this.policyContext(client, input.userId, input.workspaceId);
      const mfaVersion = await this.userMfaVersion(client, input.userId);
      if (this.isActive(credential)) {
        const token = randomBytes(32).toString("base64url");
        await client.query(
          `UPDATE auth_mfa_challenges SET consumed_at = COALESCE(consumed_at, now())
           WHERE user_id = $1 AND purpose = 'login' AND consumed_at IS NULL`,
          [input.userId],
        );
        await client.query(
          `INSERT INTO auth_mfa_challenges
            (token_hash, user_id, workspace_id, purpose, credential_changed_at,
             expires_at, ip_address, user_agent)
           VALUES ($1, $2, $3, 'login', $4, now() + ($5 * interval '1 minute'), $6, $7)`,
          [
            hashOpaqueToken(token),
            input.userId,
            input.workspaceId,
            input.passwordChangedAt,
            CHALLENGE_MINUTES,
            input.ipAddress ?? null,
            input.userAgent ?? null,
          ],
        );
        await this.recordEvent(client, input.userId, input.workspaceId, "mfa.login_challenge_created", {
          expiresInSeconds: CHALLENGE_MINUTES * 60,
        }, input.ipAddress);
        return {
          challengeRequired: true,
          challengeToken: token,
          expiresInSeconds: CHALLENGE_MINUTES * 60,
        };
      }

      let deadline: Date | undefined;
      if (policy.required && policy.accountId) {
        const requirement = await client.query<{ graceExpiresAt: Date }>(
          `INSERT INTO mfa_enrollment_requirements
            (user_id, account_id, grace_expires_at)
           VALUES ($1, $2, now() + ($3 * interval '1 day'))
           ON CONFLICT (user_id, account_id) DO UPDATE
             SET resolved_at = NULL
           RETURNING grace_expires_at AS "graceExpiresAt"`,
          [input.userId, policy.accountId, policy.policy.enrollmentGraceDays],
        );
        deadline = requirement.rows[0].graceExpiresAt;
      }
      return {
        challengeRequired: false,
        assurance: {
          authenticationMethods: ["pwd"],
          mfaSessionVersion: mfaVersion,
          ...(deadline ? { mfaEnrollmentDeadline: deadline } : {}),
        },
      };
    });
  }

  async consumeLoginChallenge(challengeToken: string, factor: string) {
    const outcome = await this.database.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        userId: string;
        workspaceId: string;
        expiresAt: Date;
        consumedAt: Date | null;
        failedAttempts: number;
        maxAttempts: number;
        credentialChangedAt: Date;
        currentCredentialChangedAt: Date;
        passwordHash: string;
        primaryEmail: string;
        displayName: string;
        status: string;
        ipAddress: string | null;
      }>(
        `SELECT challenge.id, challenge.user_id AS "userId",
                challenge.workspace_id AS "workspaceId", challenge.expires_at AS "expiresAt",
                challenge.consumed_at AS "consumedAt", challenge.failed_attempts AS "failedAttempts",
                challenge.max_attempts AS "maxAttempts",
                challenge.credential_changed_at AS "credentialChangedAt",
                credential.password_changed_at AS "currentCredentialChangedAt",
                credential.password_hash AS "passwordHash",
                app_user.primary_email AS "primaryEmail",
                app_user.display_name AS "displayName", app_user.status,
                challenge.ip_address AS "ipAddress"
         FROM auth_mfa_challenges challenge
         JOIN users app_user ON app_user.id = challenge.user_id
         JOIN local_auth_credentials credential ON credential.user_id = challenge.user_id
         WHERE challenge.token_hash = $1
         FOR UPDATE OF challenge`,
        [hashOpaqueToken(challengeToken)],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.status !== "active") {
        throw new UnauthorizedException("MFA challenge is invalid or expired");
      }
      if (challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()
        || challenge.failedAttempts >= challenge.maxAttempts) {
        throw new GoneException("MFA challenge is invalid or expired");
      }
      if (challenge.credentialChangedAt.getTime() !== challenge.currentCredentialChangedAt.getTime()) {
        await client.query(
          "UPDATE auth_mfa_challenges SET consumed_at = now() WHERE id = $1",
          [challenge.id],
        );
        return { state: "changed" as const };
      }
      await this.setActorContext(client, challenge.workspaceId, challenge.userId);
      const membership = await client.query(
        `SELECT 1 FROM workspace_memberships membership
         JOIN workspaces workspace ON workspace.id = membership.workspace_id
         WHERE membership.workspace_id = $1 AND membership.user_id = $2
           AND membership.status = 'active' AND workspace.status IN ('active', 'suspended')`,
        [challenge.workspaceId, challenge.userId],
      );
      if (!membership.rowCount) {
        await client.query("UPDATE auth_mfa_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
        return { state: "changed" as const };
      }

      const verified = await this.verifyFactor(client, challenge.userId, factor);
      if (!verified.ok) {
        const failedAttempts = challenge.failedAttempts + 1;
        await client.query(
          `UPDATE auth_mfa_challenges
           SET failed_attempts = $2,
               consumed_at = CASE WHEN $2 >= max_attempts THEN now() ELSE consumed_at END
           WHERE id = $1`,
          [challenge.id, failedAttempts],
        );
        await this.recordEvent(client, challenge.userId, challenge.workspaceId, "mfa.login_challenge_failed", {
          failedAttempts,
          locked: verified.locked,
        }, challenge.ipAddress ?? undefined);
        return { state: verified.locked ? "locked" as const : "invalid" as const };
      }
      await client.query("UPDATE auth_mfa_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
      const authenticatedAt = new Date();
      const mfaSessionVersion = await this.userMfaVersion(client, challenge.userId);
      await this.recordEvent(client, challenge.userId, challenge.workspaceId, "mfa.login_verified", {
        method: verified.method,
      }, challenge.ipAddress ?? undefined);
      return {
        state: "verified" as const,
        userId: challenge.userId,
        workspaceId: challenge.workspaceId,
        passwordHash: challenge.passwordHash,
        actor: {
          subject: `local:${challenge.userId}`,
          provider: "local",
          email: challenge.primaryEmail.toLowerCase(),
          displayName: challenge.displayName,
        },
        assurance: {
          mfaVerifiedAt: authenticatedAt,
          authenticationMethods: ["pwd", verified.method],
          mfaSessionVersion,
        } satisfies MfaSessionAssurance,
      };
    });
    if (outcome.state === "changed") {
      throw new UnauthorizedException("Your account or workspace access changed. Sign in again");
    }
    if (outcome.state === "locked") {
      throw new HttpException("Too many MFA attempts. Try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (outcome.state === "invalid") throw new UnauthorizedException("Verification code is incorrect");
    if (outcome.state !== "verified") throw new UnauthorizedException("MFA challenge is invalid or expired");
    return {
      userId: outcome.userId,
      workspaceId: outcome.workspaceId,
      passwordHash: outcome.passwordHash,
      actor: outcome.actor,
      assurance: outcome.assurance,
    };
  }

  async status(userId: string, workspaceId: string) {
    return this.database.transaction(async (client) => {
      await this.setActorContext(client, workspaceId, userId);
      const policy = await this.policyContext(client, userId, workspaceId);
      const credential = await this.credential(client, userId);
      const remaining = this.isActive(credential)
        ? await this.remainingRecoveryCodes(client, userId)
        : 0;
      const requirement = policy.accountId
        ? await client.query<{ graceExpiresAt: Date; resolvedAt: Date | null }>(
          `SELECT grace_expires_at AS "graceExpiresAt", resolved_at AS "resolvedAt"
           FROM mfa_enrollment_requirements WHERE user_id = $1 AND account_id = $2`,
          [userId, policy.accountId],
        )
        : { rows: [] as { graceExpiresAt: Date; resolvedAt: Date | null }[] };
      return {
        enabled: this.isActive(credential),
        setupPending: Boolean(credential && !credential.confirmedAt && credential.setupExpiresAt.getTime() > Date.now()),
        confirmedAt: credential?.confirmedAt ?? null,
        recoveryCodesRemaining: remaining,
        required: policy.required,
        enrollmentDeadline: requirement.rows[0]?.resolvedAt ? null : requirement.rows[0]?.graceExpiresAt ?? null,
        policy: policy.policy,
      };
    });
  }

  async platformMfaEnabled(userId: string) {
    const result = await this.database.query<{ enabled: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM user_mfa_credentials
         WHERE user_id = $1 AND confirmed_at IS NOT NULL AND disabled_at IS NULL
       ) AS enabled`,
      [userId],
    );
    return result.rows[0]?.enabled ?? false;
  }

  async verifyPlatformFactor(client: PoolClient, userId: string, factor: string, ipAddress?: string) {
    const result = await this.verifyFactor(client, userId, factor);
    await this.recordEvent(client, userId, null, result.ok
      ? "mfa.platform_verified" : "mfa.platform_failed", result.ok
      ? { method: result.method } : { locked: result.locked }, ipAddress);
    return result;
  }

  async startTotpEnrollment(userId: string, workspaceId: string | null, transactionClient?: PoolClient) {
    const key = this.encryptionKey();
    const work = async (client: PoolClient) => {
      await this.setActorContext(client, workspaceId, userId);
      const existing = await this.credential(client, userId, true);
      if (this.isActive(existing)) throw new ConflictException("MFA is already enabled");
      const identity = workspaceId
        ? await client.query<{ email: string; workspaceName: string }>(
          `SELECT app_user.primary_email AS email, workspace.name AS "workspaceName"
           FROM users app_user CROSS JOIN workspaces workspace
           WHERE app_user.id = $1 AND workspace.id = $2`,
          [userId, workspaceId],
        )
        : await client.query<{ email: string; workspaceName: string }>(
          `SELECT primary_email AS email, 'Wodana Control' AS "workspaceName"
           FROM users WHERE id = $1`, [userId],
        );
      if (!identity.rowCount) throw new NotFoundException("User or workspace not found");
      const secret = generateTotpSecret();
      const encrypted = encryptMfaSecret(secret, key);
      await client.query(
        `INSERT INTO user_mfa_credentials
          (user_id, encrypted_totp_secret, encryption_nonce, encryption_auth_tag,
           encryption_key_version, setup_expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 minute'))
         ON CONFLICT (user_id) DO UPDATE SET
           encrypted_totp_secret = EXCLUDED.encrypted_totp_secret,
           encryption_nonce = EXCLUDED.encryption_nonce,
           encryption_auth_tag = EXCLUDED.encryption_auth_tag,
           encryption_key_version = EXCLUDED.encryption_key_version,
           setup_expires_at = EXCLUDED.setup_expires_at,
           confirmed_at = NULL, disabled_at = NULL, last_used_step = NULL,
           failed_attempts = 0, locked_until = NULL`,
        [userId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag,
          this.encryptionKeyVersion(), SETUP_MINUTES],
      );
      await client.query("DELETE FROM user_mfa_recovery_codes WHERE user_id = $1", [userId]);
      const issuer = this.config.get<string>("MFA_TOTP_ISSUER", "Wodana").trim() || "Wodana";
      const label = `${issuer}:${identity.rows[0].email}`;
      const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}`
        + `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      await this.recordEvent(client, userId, workspaceId, "mfa.enrollment_started", {
        setupExpiresInSeconds: SETUP_MINUTES * 60,
      });
      return {
        secret,
        otpauthUri,
        issuer,
        accountName: identity.rows[0].workspaceName,
        setupExpiresInSeconds: SETUP_MINUTES * 60,
      };
    };
    return transactionClient ? work(transactionClient) : this.database.transaction(work);
  }

  async confirmTotpEnrollment(
    userId: string, workspaceId: string | null, code: string,
  ): Promise<{ state: "confirmed"; recoveryCodes: string[]; assurance: MfaSessionAssurance }>;
  async confirmTotpEnrollment(
    userId: string, workspaceId: string | null, code: string, transactionClient: PoolClient,
  ): Promise<
    | { state: "confirmed"; recoveryCodes: string[]; assurance: MfaSessionAssurance }
    | { state: "locked" | "invalid" }
  >;
  async confirmTotpEnrollment(
    userId: string, workspaceId: string | null, code: string, transactionClient?: PoolClient,
  ): Promise<
    | { state: "confirmed"; recoveryCodes: string[]; assurance: MfaSessionAssurance }
    | { state: "locked" | "invalid" }
  > {
    const key = this.encryptionKey();
    const work = async (client: PoolClient) => {
      await this.setActorContext(client, workspaceId, userId);
      const credential = await this.credential(client, userId, true);
      if (!credential) throw new NotFoundException("Start MFA setup first");
      if (this.isActive(credential)) throw new ConflictException("MFA is already enabled");
      if (credential.setupExpiresAt.getTime() <= Date.now()) {
        throw new GoneException("MFA setup expired. Start again");
      }
      if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
        return { state: "locked" as const };
      }
      const secret = this.decryptSecret(credential, key);
      const step = verifyTotp(secret, code);
      if (step === null || (credential.lastUsedStep !== null && step <= Number(credential.lastUsedStep))) {
        await this.recordFailedFactor(client, userId);
        return { state: "invalid" as const };
      }
      const recoveryCodeCount = workspaceId
        ? (await this.policyContext(client, userId, workspaceId)).policy.recoveryCodeCount
        : DEFAULT_POLICY.recoveryCodeCount;
      const recoveryCodes = generateRecoveryCodes(recoveryCodeCount);
      await client.query(
        `UPDATE user_mfa_credentials
         SET confirmed_at = now(), last_used_step = $2, failed_attempts = 0, locked_until = NULL
         WHERE user_id = $1`,
        [userId, step],
      );
      await this.replaceRecoveryCodes(client, userId, recoveryCodes, key);
      const version = await client.query<{ mfaSessionVersion: number }>(
        `UPDATE users SET mfa_session_version = mfa_session_version + 1
         WHERE id = $1 RETURNING mfa_session_version AS "mfaSessionVersion"`,
        [userId],
      );
      await client.query(
        "UPDATE mfa_enrollment_requirements SET resolved_at = now() WHERE user_id = $1 AND resolved_at IS NULL",
        [userId],
      );
      const authenticatedAt = new Date();
      await this.recordEvent(client, userId, workspaceId, "mfa.enrollment_confirmed", {
        recoveryCodeCount: recoveryCodes.length,
      });
      return {
        state: "confirmed" as const,
        recoveryCodes,
        assurance: {
          mfaVerifiedAt: authenticatedAt,
          authenticationMethods: ["pwd", "totp"],
          mfaSessionVersion: version.rows[0].mfaSessionVersion,
        } satisfies MfaSessionAssurance,
      };
    };
    const outcome = transactionClient ? await work(transactionClient) : await this.database.transaction(work);
    if (transactionClient) return outcome;
    if (outcome.state === "locked") {
      throw new HttpException("Too many MFA attempts. Try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (outcome.state === "invalid") throw new UnauthorizedException("Verification code is incorrect");
    return outcome;
  }

  async verifyForStepUp(userId: string, workspaceId: string, factor: string) {
    const outcome = await this.database.transaction(async (client) => {
      await this.setActorContext(client, workspaceId, userId);
      const verified = await this.verifyFactor(client, userId, factor);
      if (!verified.ok) return { state: verified.locked ? "locked" as const : "invalid" as const };
      const assurance: MfaSessionAssurance = {
        mfaVerifiedAt: new Date(),
        authenticationMethods: ["pwd", verified.method],
        mfaSessionVersion: await this.userMfaVersion(client, userId),
      };
      await this.recordEvent(client, userId, workspaceId, "mfa.step_up_verified", {
        method: verified.method,
      });
      return { state: "verified" as const, assurance };
    });
    if (outcome.state === "locked") {
      throw new HttpException("Too many MFA attempts. Try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
    // The person is signed in; only the code is wrong. A 401 here reads as "your session has expired".
    if (outcome.state === "invalid" || !outcome.assurance) throw new UnprocessableEntityException("Verification code is incorrect");
    return outcome.assurance;
  }

  async rotateRecoveryCodes(userId: string, workspaceId: string) {
    const key = this.encryptionKey();
    return this.database.transaction(async (client) => {
      await this.setActorContext(client, workspaceId, userId);
      const credential = await this.credential(client, userId, true);
      if (!this.isActive(credential)) throw new ConflictException("Enable MFA first");
      const policy = await this.policyContext(client, userId, workspaceId);
      const codes = generateRecoveryCodes(policy.policy.recoveryCodeCount);
      await this.replaceRecoveryCodes(client, userId, codes, key);
      await this.recordEvent(client, userId, workspaceId, "mfa.recovery_codes_rotated", {
        recoveryCodeCount: codes.length,
      });
      return codes;
    });
  }

  async disable(userId: string, workspaceId: string) {
    return this.database.transaction(async (client) => {
      await this.setActorContext(client, workspaceId, userId);
      const required = await this.anyRequiredPolicy(client, userId, workspaceId);
      if (required) throw new ConflictException("MFA is required by an account security policy");
      const credential = await this.credential(client, userId, true);
      if (!this.isActive(credential)) throw new ConflictException("MFA is not enabled");
      await client.query("DELETE FROM user_mfa_credentials WHERE user_id = $1", [userId]);
      const version = await client.query<{ mfaSessionVersion: number }>(
        `UPDATE users SET mfa_session_version = mfa_session_version + 1
         WHERE id = $1 RETURNING mfa_session_version AS "mfaSessionVersion"`,
        [userId],
      );
      await this.recordEvent(client, userId, workspaceId, "mfa.disabled", {});
      return version.rows[0].mfaSessionVersion;
    });
  }

  private async verifyFactor(client: PoolClient, userId: string, factor: string): Promise<FactorResult> {
    const credential = await this.credential(client, userId, true);
    if (!this.isActive(credential) || !credential) return { ok: false, locked: false };
    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      return { ok: false, locked: true };
    }
    const key = this.encryptionKey();
    const secret = this.decryptSecret(credential, key);
    const step = verifyTotp(secret, factor);
    if (step !== null && (credential.lastUsedStep === null || step > Number(credential.lastUsedStep))) {
      await client.query(
        `UPDATE user_mfa_credentials
         SET last_used_step = $2, failed_attempts = 0, locked_until = NULL
         WHERE user_id = $1`,
        [userId, step],
      );
      return { ok: true, method: "totp" };
    }
    const recovery = await client.query(
      `UPDATE user_mfa_recovery_codes SET used_at = now()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
       RETURNING id`,
      [userId, recoveryCodeHash(factor, key)],
    );
    if (recovery.rowCount) {
      await client.query(
        "UPDATE user_mfa_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1",
        [userId],
      );
      return { ok: true, method: "recovery_code" };
    }
    const locked = await this.recordFailedFactor(client, userId);
    return { ok: false, locked };
  }

  private async recordFailedFactor(client: PoolClient, userId: string) {
    const updated = await client.query<{ lockedUntil: Date | null }>(
      `UPDATE user_mfa_credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= $2
             THEN now() + ($3 * interval '1 minute') ELSE NULL END
       WHERE user_id = $1 RETURNING locked_until AS "lockedUntil"`,
      [userId, MAX_FACTOR_ATTEMPTS, FACTOR_LOCK_MINUTES],
    );
    return Boolean(updated.rows[0]?.lockedUntil);
  }

  private async replaceRecoveryCodes(
    client: PoolClient,
    userId: string,
    codes: string[],
    key: Buffer,
  ) {
    await client.query("DELETE FROM user_mfa_recovery_codes WHERE user_id = $1", [userId]);
    for (const code of codes) {
      await client.query(
        "INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
        [userId, recoveryCodeHash(code, key)],
      );
    }
  }

  private async remainingRecoveryCodes(client: PoolClient, userId: string) {
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM user_mfa_recovery_codes
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return result.rows[0]?.count ?? 0;
  }

  private async credential(client: PoolClient, userId: string, lock = false) {
    const result = await client.query<CredentialRow>(
      `SELECT user_id AS "userId", encrypted_totp_secret AS "encryptedTotpSecret",
              encryption_nonce AS "encryptionNonce", encryption_auth_tag AS "encryptionAuthTag",
              encryption_key_version AS "encryptionKeyVersion",
              setup_expires_at AS "setupExpiresAt", confirmed_at AS "confirmedAt",
              disabled_at AS "disabledAt", last_used_step AS "lastUsedStep",
              failed_attempts AS "failedAttempts", locked_until AS "lockedUntil"
       FROM user_mfa_credentials WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private isActive(credential: CredentialRow | null): boolean {
    return Boolean(credential?.confirmedAt && !credential.disabledAt);
  }

  private async policyContext(
    client: PoolClient,
    userId: string,
    workspaceId: string,
  ): Promise<PolicyContext> {
    const result = await client.query<{
      accountId: string;
      accountName: string;
      securityPolicy: Record<string, unknown>;
      accountRole: string | null;
      workspaceAdministrator: boolean;
    }>(
      `SELECT account.id AS "accountId", account.display_name AS "accountName",
              account.security_policy AS "securityPolicy", account_member.role AS "accountRole",
              EXISTS (
                SELECT 1 FROM workspace_memberships membership
                JOIN member_roles assigned ON assigned.membership_id = membership.id
                JOIN roles role ON role.id = assigned.role_id
                WHERE membership.workspace_id = $1 AND membership.user_id = $2
                  AND membership.status = 'active' AND role.code IN ('owner', 'administrator')
              ) AS "workspaceAdministrator"
       FROM customer_account_organizations linked
       JOIN customer_accounts account ON account.id = linked.account_id
       LEFT JOIN customer_account_memberships account_member
         ON account_member.account_id = account.id AND account_member.user_id = $2
        AND account_member.status = 'active'
       WHERE linked.workspace_id = $1`,
      [workspaceId, userId],
    );
    if (!result.rowCount) {
      return {
        accountId: null,
        accountName: null,
        policy: this.normalizePolicy(null),
        isAdministrator: false,
        required: false,
      };
    }
    const row = result.rows[0];
    const policy = this.normalizePolicy(row.securityPolicy);
    const isAdministrator = ["owner", "administrator"].includes(row.accountRole ?? "")
      || row.workspaceAdministrator;
    return {
      accountId: row.accountId,
      accountName: row.accountName,
      policy,
      isAdministrator,
      required: policy.requireMfaForAllUsers || (policy.requireMfaForAdmins && isAdministrator),
    };
  }

  private async anyRequiredPolicy(client: PoolClient, userId: string, workspaceId: string) {
    const allUser = await client.query(
      `SELECT 1 FROM customer_account_memberships member
       JOIN customer_accounts account ON account.id = member.account_id
       WHERE member.user_id = $1 AND member.status = 'active'
         AND (
           COALESCE((account.security_policy->>'requireMfaForAllUsers')::boolean, false)
           OR (
             member.role IN ('owner', 'administrator')
             AND COALESCE((account.security_policy->>'requireMfaForAdmins')::boolean, true)
           )
         ) LIMIT 1`,
      [userId],
    );
    if (allUser.rowCount) return true;
    return (await this.policyContext(client, userId, workspaceId)).required;
  }

  private normalizePolicy(input: Record<string, unknown> | null): MfaSecurityPolicy {
    const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
    };
    return {
      requireMfaForAdmins: typeof input?.requireMfaForAdmins === "boolean"
        ? input.requireMfaForAdmins : DEFAULT_POLICY.requireMfaForAdmins,
      requireMfaForAllUsers: typeof input?.requireMfaForAllUsers === "boolean"
        ? input.requireMfaForAllUsers : DEFAULT_POLICY.requireMfaForAllUsers,
      recoveryCodeCount: integer(input?.recoveryCodeCount, DEFAULT_POLICY.recoveryCodeCount, 5, 20),
      enrollmentGraceDays: integer(input?.enrollmentGraceDays, DEFAULT_POLICY.enrollmentGraceDays, 0, 30),
      stepUpMinutes: Number(this.config.get<string>("MFA_STEP_UP_MINUTES", "10")),
    };
  }

  private async userMfaVersion(client: PoolClient, userId: string) {
    const result = await client.query<{ version: number }>(
      "SELECT mfa_session_version AS version FROM users WHERE id = $1",
      [userId],
    );
    if (!result.rowCount) throw new NotFoundException("User not found");
    return result.rows[0].version;
  }

  private async setActorContext(client: PoolClient, workspaceId: string | null, userId: string) {
    if (workspaceId) await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [userId]);
  }

  private async recordEvent(
    client: PoolClient,
    userId: string | null,
    workspaceId: string | null,
    eventType: string,
    metadata: Record<string, unknown>,
    ipAddress?: string,
  ) {
    await client.query(
      `INSERT INTO mfa_security_events
        (user_id, workspace_id, event_type, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, workspaceId, eventType, metadata, ipAddress ?? null],
    );
  }

  private encryptionKey() {
    try {
      return parseMfaEncryptionKey(this.config.get<string>("MFA_ENCRYPTION_KEY"));
    } catch {
      throw new ServiceUnavailableException("MFA encryption is not configured");
    }
  }

  private decryptSecret(credential: CredentialRow, key: Buffer) {
    if (credential.encryptionKeyVersion !== this.encryptionKeyVersion()) {
      throw new ServiceUnavailableException("MFA encryption key version is unavailable");
    }
    try {
      return decryptMfaSecret({
        ciphertext: credential.encryptedTotpSecret,
        nonce: credential.encryptionNonce,
        authTag: credential.encryptionAuthTag,
      }, key);
    } catch {
      throw new ServiceUnavailableException("MFA credential could not be decrypted");
    }
  }

  private encryptionKeyVersion() {
    const version = Number(this.config.get<string>("MFA_ENCRYPTION_KEY_VERSION", "1"));
    return Number.isInteger(version) && version > 0 ? version : 1;
  }
}
