import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ControlNoticesService, SERVICE_ACTOR_ID } from "../control-plane/control-notices.service";
import { domainState, signInHost } from "../control-plane/control-plane.domain";
import { resolveTenantRegistry } from "../control-plane/tenant-registry";
import { BASE_DOMAIN, domainDnsChallenge, normalizeCustomDomain, txtAnswerMatches } from "./domain-policy";
import { assertValidIdempotencyKey } from "./provisioning-idempotency";

type DomainRow = {
  id: string; workspaceId: string; hostname: string; requestKey: string; challengeValue: string;
  challengeExpiresAt: Date; dnsStatus: string; dnsVerifiedAt: Date | null;
  certificateStatus: string; certificateExpiresAt: Date | null;
  routingStatus: string; routingActivatedAt: Date | null; rollbackStatus: string;
  lastErrorCode: string | null; version: number; removedAt: Date | null;
  lastCheckedAt: Date | null; checkCount: number; ownershipLostAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

@Injectable()
export class TenantDomainsService {
  constructor(
    private readonly database: DatabaseService,
    @Optional() private readonly notices?: ControlNoticesService,
  ) {}

  // TXT lookup is the only network operation. Tests replace it without touching DNS.
  lookupTxt: (hostname: string) => Promise<string[][]> = resolveTxt;

  async list(externalTenantId: string, operatorUserId: string) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    return this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const result = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY (routing_status = 'active') DESC, created_at DESC`, [workspace.id]);
      const domains = result.rows.map((row) => this.publicDomain(row));
      return {
        platformHostname: `${workspace.slug}.${BASE_DOMAIN}`,
        signIn: signInHost({ slug: workspace.slug, baseDomain: BASE_DOMAIN, domains }),
        domains,
      };
    });
  }

  async request(externalTenantId: string, hostnameInput: string, suppliedKey: string | undefined,
    operatorUserId: string, correlationId?: string) {
    const hostname = normalizeCustomDomain(hostnameInput);
    let key: string;
    try { key = assertValidIdempotencyKey(suppliedKey); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    try {
      return await this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`domain:${hostname}`]);
        const byKey = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND request_key = $2`, [workspace.id, key]);
        if (byKey.rowCount) {
          if (byKey.rows[0].hostname !== hostname) throw new ConflictException("This domain request key belongs to another hostname");
          return { ...this.publicDomain(byKey.rows[0]), replayed: true };
        }
        const alreadyBound = await client.query<{ id: string }>(
          "SELECT id FROM workspace_domains WHERE hostname = $1 AND removed_at IS NULL", [hostname],
        );
        if (alreadyBound.rowCount) throw new ConflictException("This domain is already reserved");
        const tenant = await client.query<{ status: string }>("SELECT status FROM workspaces WHERE id = $1 FOR UPDATE", [workspace.id]);
        if (tenant.rows[0]?.status !== "active") throw new ConflictException("An active organization is required to request a domain");
        const challengeValue = randomBytes(32).toString("base64url");
        const inserted = await client.query<DomainRow>(
          `${this.insert()} VALUES ($1, $2, $3, $4, now() + interval '48 hours', $5) ${this.returning()}`,
          [workspace.id, hostname, key, challengeValue, operatorUserId],
        );
        await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_requested", correlationId,
          { domainId: inserted.rows[0].id, hostname });
        return { ...this.publicDomain(inserted.rows[0]), replayed: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("This domain is already reserved");
      throw error;
    }
  }

  async verify(externalTenantId: string, domainId: string, expectedVersion: number,
    operatorUserId: string, correlationId?: string) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    const initial = await this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const found = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND id = $2`, [workspace.id, domainId]);
      if (!found.rowCount) throw new NotFoundException("Domain request not found");
      return found.rows[0];
    });
    if (initial.removedAt) throw new GoneException("Domain request was removed");
    if (initial.version !== expectedVersion) throw new ConflictException("Domain request changed; reload and try again");
    if (initial.dnsStatus === "verified") return this.publicDomain(initial);
    if (initial.challengeExpiresAt <= new Date()) throw new GoneException("DNS challenge expired; request a new one");
    if (!await this.ownershipRecordPresent(initial)) {
      // The attempt is a fact ("verifying"), even though the record is not there yet.
      await this.database.tenantTransaction(workspace.id, operatorUserId, (client) => client.query(
        `UPDATE workspace_domains SET last_checked_at = now(), check_count = check_count + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 AND removed_at IS NULL`, [workspace.id, domainId]));
      throw new ConflictException("DNS ownership record was not found yet");
    }
    return this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET dns_status = 'verified', dns_verified_at = now(),
           last_checked_at = now(), check_count = check_count + 1,
           certificate_status = 'manual_setup_required', version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 AND version = $3 AND challenge_value = $4
           AND removed_at IS NULL AND challenge_expires_at > now() AND dns_status = 'pending'
         ${this.returning()}`,
        [workspace.id, domainId, expectedVersion, initial.challengeValue],
      );
      if (!updated.rowCount) throw new ConflictException("Domain request changed; reload and try again");
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_dns_verified", correlationId,
        { domainId, hostname: initial.hostname });
      return this.publicDomain(updated.rows[0]);
    });
  }

  async recheckOwnership(externalTenantId: string, domainId: string, expectedVersion: number,
    operatorUserId: string, correlationId?: string) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    const initial = await this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const found = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND id = $2`, [workspace.id, domainId]);
      if (!found.rowCount) throw new NotFoundException("Domain request not found");
      return found.rows[0];
    });
    if (initial.removedAt) throw new GoneException("Domain request was removed");
    if (initial.version !== expectedVersion) throw new ConflictException("Domain request changed; reload and try again");
    if (initial.dnsStatus !== "verified") throw new ConflictException("Verify a current DNS challenge before rechecking ownership");
    const present = await this.ownershipRecordPresent(initial);
    return this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET
           dns_status = CASE WHEN $5 THEN 'verified' ELSE 'failed' END,
           dns_verified_at = CASE WHEN $5 THEN now() ELSE dns_verified_at END,
           routing_status = CASE WHEN NOT $5 AND routing_status IN ('active', 'pending') THEN 'failed' ELSE routing_status END,
           rollback_status = CASE WHEN NOT $5 AND (routing_status IN ('active', 'pending') OR certificate_status IN ('pending', 'issued')) THEN 'pending' ELSE rollback_status END,
           last_error_code = CASE WHEN $5 THEN NULL ELSE 'dns_ownership_lost' END,
           ownership_lost_at = CASE WHEN $5 THEN NULL ELSE now() END,
           last_checked_at = now(), check_count = check_count + 1,
           version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 AND version = $3 AND challenge_value = $4
           AND removed_at IS NULL AND dns_status = 'verified'
         ${this.returning()}`,
        [workspace.id, domainId, expectedVersion, initial.challengeValue, present],
      );
      if (!updated.rowCount) throw new ConflictException("Domain request changed; reload and try again");
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_dns_rechecked", correlationId,
        { domainId, hostname: initial.hostname, ownershipPresent: present, rollbackRequired: updated.rows[0].rollbackStatus === "pending" });
      const direct = present ? [] : await this.notify(client, workspace.id, "domain.ownership_lost", updated.rows[0], operatorUserId);
      return { domain: this.publicDomain(updated.rows[0]), direct };
    }).then(async ({ domain, direct }) => {
      await this.notices?.deliver(workspace.id, direct, operatorUserId);
      return domain;
    });
  }

  /**
   * The sweep's ownership check: a verified domain whose TXT record disappeared falls back to the Wodana
   * address (routing off, rollback pending), and the owner and the domain operators are told.
   */
  async sweepOwnership(workspaceId: string) {
    const due = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => client.query<DomainRow>(
      `${this.select()} WHERE workspace_id = $1 AND removed_at IS NULL AND dns_status = 'verified'
         AND (last_checked_at IS NULL OR last_checked_at < now() - interval '6 hours')`, [workspaceId]));
    let lost = 0;
    for (const domain of due.rows) {
      const present = await this.ownershipRecordPresent(domain).catch(() => null);
      if (present === null) continue;
      const direct = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
        const updated = await client.query<DomainRow>(
          `UPDATE workspace_domains SET
             dns_status = CASE WHEN $4 THEN 'verified' ELSE 'failed' END,
             dns_verified_at = CASE WHEN $4 THEN now() ELSE dns_verified_at END,
             routing_status = CASE WHEN NOT $4 AND routing_status IN ('active', 'pending') THEN 'failed' ELSE routing_status END,
             rollback_status = CASE WHEN NOT $4 AND (routing_status IN ('active', 'pending') OR certificate_status IN ('pending', 'issued')) THEN 'pending' ELSE rollback_status END,
             last_error_code = CASE WHEN $4 THEN NULL ELSE 'dns_ownership_lost' END,
             ownership_lost_at = CASE WHEN $4 THEN NULL ELSE now() END,
             last_checked_at = now(), check_count = check_count + 1, version = version + 1, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 AND version = $3 AND dns_status = 'verified' ${this.returning()}`,
          [workspaceId, domain.id, domain.version, present]);
        if (!updated.rowCount || present) return [] as string[];
        lost += 1;
        await this.audit(client, null, workspaceId, "tenant.domain_ownership_lost", undefined,
          { workspaceId, domainId: domain.id, hostname: domain.hostname });
        return this.notify(client, workspaceId, "domain.ownership_lost", updated.rows[0], null);
      });
      await this.notices?.deliver(workspaceId, direct, null);
    }
    return { checked: due.rowCount ?? 0, lost };
  }

  /** Records the certificate the edge issued for a verified domain (certificate_issued). */
  async recordCertificate(externalTenantId: string, domainId: string, expectedVersion: number, expiresAt: string,
    operatorUserId: string, correlationId?: string) {
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) throw new BadRequestException("Enter a future certificate expiry.");
    return this.change(externalTenantId, domainId, expectedVersion, operatorUserId, async (client, workspaceId, domain) => {
      if (domain.dnsStatus !== "verified") throw new ConflictException("Verify DNS ownership before recording a certificate");
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET certificate_status = 'issued', certificate_expires_at = $3,
           last_error_code = NULL, version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 ${this.returning()}`, [workspaceId, domainId, expiry]);
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_certificate_recorded", correlationId,
        { domainId, hostname: domain.hostname, expiresAt: expiry.toISOString() });
      return { row: updated.rows[0], direct: [] };
    });
  }

  /** Routes sign-in to the custom domain (live). Needs verified ownership and a current certificate. */
  async activate(externalTenantId: string, domainId: string, expectedVersion: number, operatorUserId: string, correlationId?: string) {
    return this.change(externalTenantId, domainId, expectedVersion, operatorUserId, async (client, workspaceId, domain) => {
      if (domain.dnsStatus !== "verified" || domain.certificateStatus !== "issued"
        || !domain.certificateExpiresAt || domain.certificateExpiresAt <= new Date()) {
        throw new ConflictException("A verified domain with a current certificate is required to go live");
      }
      if (domain.rollbackStatus === "pending" || domain.rollbackStatus === "failed") {
        throw new ConflictException("Finish the rollback before going live again");
      }
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET routing_status = 'active', routing_activated_at = now(), rollback_status = 'none',
           version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 ${this.returning()}`, [workspaceId, domainId]);
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_live", correlationId, { domainId, hostname: domain.hostname });
      return { row: updated.rows[0], direct: await this.notify(client, workspaceId, "domain.live", updated.rows[0], operatorUserId) };
    });
  }

  /** Confirms routing and the certificate were taken down after a failure, so the domain can be verified again. */
  async completeRollback(externalTenantId: string, domainId: string, expectedVersion: number, operatorUserId: string, correlationId?: string) {
    return this.change(externalTenantId, domainId, expectedVersion, operatorUserId, async (client, workspaceId, domain) => {
      if (domain.rollbackStatus !== "pending" && domain.rollbackStatus !== "failed") {
        throw new ConflictException("This domain has no rollback to finish");
      }
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET routing_status = 'not_requested', routing_activated_at = NULL,
           certificate_status = CASE WHEN certificate_status IN ('pending', 'issued') THEN 'not_requested' ELSE certificate_status END,
           certificate_expires_at = NULL, rollback_status = 'completed', version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 ${this.returning()}`, [workspaceId, domainId]);
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_rollback_completed", correlationId,
        { domainId, hostname: domain.hostname });
      return { row: updated.rows[0], direct: [] };
    });
  }

  private async change(externalTenantId: string, domainId: string, expectedVersion: number, operatorUserId: string,
    work: (client: PoolClient, workspaceId: string, domain: DomainRow) => Promise<{ row: DomainRow; direct: string[] }>) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    const outcome = await this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const found = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspace.id, domainId]);
      if (!found.rowCount) throw new NotFoundException("Domain request not found");
      const domain = found.rows[0];
      if (domain.removedAt) throw new GoneException("Domain request was removed");
      if (domain.version !== expectedVersion) throw new ConflictException("Domain request changed; reload and try again");
      return work(client, workspace.id, domain);
    });
    await this.notices?.deliver(workspace.id, outcome.direct, operatorUserId);
    return this.publicDomain(outcome.row);
  }

  private notify(client: PoolClient, workspaceId: string, event: "domain.ownership_lost" | "domain.live", domain: DomainRow,
    actorUserId: string | null): Promise<string[]> {
    if (!this.notices) return Promise.resolve([]);
    return this.notices.queue(client, { workspaceId, event, sourceType: "domain", sourceId: domain.id, actorUserId,
      domain: domain.hostname });
  }


  async rotateChallenge(externalTenantId: string, domainId: string, expectedVersion: number,
    operatorUserId: string, correlationId?: string) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    return this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const found = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspace.id, domainId]);
      if (!found.rowCount) throw new NotFoundException("Domain request not found");
      const domain = found.rows[0];
      if (domain.removedAt) throw new GoneException("Domain request was removed");
      if (domain.version !== expectedVersion) throw new ConflictException("Domain request changed; reload and try again");
      if (domain.dnsStatus === "verified") throw new ConflictException("DNS ownership is already verified");
      if (domain.rollbackStatus === "pending" || domain.rollbackStatus === "failed"
        || domain.routingStatus === "active" || domain.routingStatus === "pending"
        || domain.certificateStatus === "pending" || domain.certificateStatus === "issued") {
        throw new ConflictException("Finish certificate and routing rollback before rotating the DNS challenge");
      }
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET challenge_value = $3, challenge_expires_at = now() + interval '48 hours',
           dns_status = 'pending', dns_verified_at = NULL, certificate_status = 'not_requested',
           routing_status = 'not_requested', rollback_status = 'none', last_error_code = NULL,
           version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 ${this.returning()}`,
        [workspace.id, domainId, randomBytes(32).toString("base64url")],
      );
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_challenge_rotated", correlationId,
        { domainId, hostname: domain.hostname });
      return this.publicDomain(updated.rows[0]);
    });
  }

  async remove(externalTenantId: string, domainId: string, expectedVersion: number,
    operatorUserId: string, correlationId?: string) {
    const workspace = await this.workspace(externalTenantId, operatorUserId);
    return this.database.tenantTransaction(workspace.id, operatorUserId, async (client) => {
      const found = await client.query<DomainRow>(`${this.select()} WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspace.id, domainId]);
      if (!found.rowCount) throw new NotFoundException("Domain request not found");
      const domain = found.rows[0];
      if (domain.version !== expectedVersion) throw new ConflictException("Domain request changed; reload and try again");
      if (domain.removedAt) return this.publicDomain(domain);
      if (domain.routingStatus === "active" || domain.routingStatus === "pending"
        || domain.certificateStatus === "pending" || domain.certificateStatus === "issued"
        || domain.rollbackStatus === "pending" || domain.rollbackStatus === "failed") {
        throw new ConflictException("Routing and certificates must be rolled back before this domain can be released");
      }
      const updated = await client.query<DomainRow>(
        `UPDATE workspace_domains SET removed_at = now(), rollback_status = 'completed',
           version = version + 1, updated_at = now() WHERE id = $1 ${this.returning()}`, [domainId],
      );
      await this.audit(client, operatorUserId, externalTenantId, "tenant.domain_removed", correlationId,
        { domainId, hostname: domain.hostname });
      return this.publicDomain(updated.rows[0]);
    });
  }

  private async workspace(externalTenantId: string, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, externalTenantId).catch(() => {
      throw new NotFoundException("Customer organization not found");
    });
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const found = await client.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM workspaces WHERE id = $1`, [registry.workspaceId],
      );
      if (!found.rowCount) throw new NotFoundException("Customer organization not found");
      return found.rows[0];
    });
  }

  private async ownershipRecordPresent(domain: DomainRow): Promise<boolean> {
    const challenge = domainDnsChallenge(domain.hostname, domain.challengeValue);
    let records: string[][];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      records = await Promise.race([
        this.lookupTxt(challenge.name),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("DNS lookup timed out")), 5_000); }),
      ]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN") records = [];
      else throw new ServiceUnavailableException("DNS verification is temporarily unavailable. Try again.");
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return txtAnswerMatches(records, challenge.value);
  }

  private select() {
    return `SELECT id, workspace_id AS "workspaceId", hostname, request_key AS "requestKey",
      challenge_value AS "challengeValue", challenge_expires_at AS "challengeExpiresAt",
      dns_status AS "dnsStatus", dns_verified_at AS "dnsVerifiedAt",
      certificate_status AS "certificateStatus", certificate_expires_at AS "certificateExpiresAt",
      routing_status AS "routingStatus", routing_activated_at AS "routingActivatedAt",
      rollback_status AS "rollbackStatus", last_error_code AS "lastErrorCode", version,
      removed_at AS "removedAt", last_checked_at AS "lastCheckedAt", check_count AS "checkCount",
      ownership_lost_at AS "ownershipLostAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM workspace_domains`;
  }

  private insert() {
    return `INSERT INTO workspace_domains
      (workspace_id, hostname, request_key, challenge_value, challenge_expires_at, requested_by)`;
  }

  private returning() { return `RETURNING id, workspace_id AS "workspaceId", hostname, request_key AS "requestKey",
    challenge_value AS "challengeValue", challenge_expires_at AS "challengeExpiresAt",
    dns_status AS "dnsStatus", dns_verified_at AS "dnsVerifiedAt",
    certificate_status AS "certificateStatus", certificate_expires_at AS "certificateExpiresAt",
    routing_status AS "routingStatus", routing_activated_at AS "routingActivatedAt",
    rollback_status AS "rollbackStatus", last_error_code AS "lastErrorCode", version,
    removed_at AS "removedAt", last_checked_at AS "lastCheckedAt", check_count AS "checkCount",
    ownership_lost_at AS "ownershipLostAt", created_at AS "createdAt", updated_at AS "updatedAt"`; }

  private publicDomain(row: DomainRow) {
    const now = Date.now();
    const ownershipFresh = row.dnsStatus === "verified" && row.dnsVerifiedAt !== null
      && row.dnsVerifiedAt.getTime() > now - 7 * 24 * 60 * 60 * 1000;
    const certificateCurrent = row.certificateStatus === "issued" && row.certificateExpiresAt !== null
      && row.certificateExpiresAt.getTime() > now;
    const isUsable = row.routingStatus === "active" && row.rollbackStatus === "none"
      && ownershipFresh && certificateCurrent && !row.removedAt;
    return {
      id: row.id, hostname: row.hostname, version: row.version,
      state: domainState(row, new Date(now)),
      isUsable,
      issues: [
        ...(row.dnsStatus === "failed" ? ["DNS ownership record is missing"] : []),
        ...(row.dnsStatus === "verified" && !ownershipFresh ? ["DNS ownership needs rechecking"] : []),
        ...(row.certificateStatus === "issued" && !certificateCurrent ? ["Certificate expired"] : []),
        ...(row.rollbackStatus === "pending" ? ["Routing rollback is pending"] : []),
      ],
      dns: { status: row.dnsStatus === "pending" && row.challengeExpiresAt <= new Date() ? "expired" : row.dnsStatus,
        record: domainDnsChallenge(row.hostname, row.challengeValue), expiresAt: row.challengeExpiresAt,
        verifiedAt: row.dnsVerifiedAt },
      certificate: { status: row.certificateStatus, expiresAt: row.certificateExpiresAt },
      routing: { status: row.routingStatus, activatedAt: row.routingActivatedAt },
      rollback: { status: row.rollbackStatus },
      lastCheckedAt: row.lastCheckedAt, checkCount: row.checkCount, ownershipLostAt: row.ownershipLostAt,
      removedAt: row.removedAt, updatedAt: row.updatedAt,
    };
  }

  private audit(client: PoolClient, actorId: string | null, externalTenantId: string, action: string,
    suppliedCorrelationId: string | undefined, details: Record<string, unknown>) {
    const correlationId = suppliedCorrelationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedCorrelationId)
      ? suppliedCorrelationId : randomUUID();
    return client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'tenant', $3, $4, $5)`, [actorId, action, externalTenantId, correlationId, details],
    );
  }
}
