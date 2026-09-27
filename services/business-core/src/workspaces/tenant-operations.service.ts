import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import type {
  CaptureAccountUsageSnapshotDto,
  CreateTenantOperationPlanDto,
  DecideTenantOperationDto,
  RecordAccountBillingDocumentEventDto,
  UpdateAccountCollectionStateDto,
  UpdateAccountContractDto,
  UpdateOrganizationBillingAllocationDto,
  UpdateTenantDataPolicyDto,
  UpdateTenantEntitlementsDto,
  UpdatePlatformCapabilityDto,
} from "./dto/tenant-operations.dto";
import {
  canonicalHash,
  operationPlan,
  planAccountContract,
  planBillingAllocation,
  planCommercialEntitlement,
  validateBillingDocumentEvent,
  validateCollectionState,
  type BillingDocumentStatus,
  type TenantUsageSnapshot,
} from "./tenant-operations.domain";
import { resolveTenantRegistry } from "../control-plane/tenant-registry";

type Registry = { externalTenantId: string; workspaceId: string };
type ConfigurationCloneSnapshot = {
  setup: Record<string, unknown> | null;
  terminology: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  entitlements: Record<string, unknown> | null;
  dataPolicy: Record<string, unknown> | null;
};

const EXPORT_EXCLUDED_TABLES = new Set([
  "auth_mfa_challenges", "client_portal_challenges", "client_portal_sessions", "idempotency_keys",
  "device_endpoints", "integration_connections", "outbox_events", "sync_cursors", "tenant_data_exports",
  "tenant_operation_runs", "tenant_provisioning_drafts", "tenant_provisioning_requests", "tenant_support_sessions",
  "webhook_inbox", "workspace_domains", "workspace_invitation_delivery_commands",
]);
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

@Injectable()
export class TenantOperationsService {
  constructor(
    private readonly database: DatabaseService,
    @Optional() private readonly storage?: BrandAssetStorageService,
  ) {}

  async overview(externalTenantId: string, operatorUserId: string) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, registry.workspaceId, async (client) => {
      const organization = await client.query(`SELECT id,name,slug,status,version FROM workspaces WHERE id=$1`, [registry.workspaceId]);
      const entitlement = await client.query(`SELECT plan_code AS "planCode",plan_version AS "planVersion",status,modules,limits,
          sold_modules AS "soldModules",sold_limits AS "soldLimits",custom_override AS "customOverride",
          effective_at AS "effectiveAt",effective_until AS "effectiveUntil",reason,version,source
          FROM effective_workspace_entitlements WHERE workspace_id=$1`, [registry.workspaceId]);
      const entitlementHistory = await client.query(`SELECT allocation.version,allocation.status,allocation.modules,allocation.limits,
          allocation.effective_from AS "effectiveFrom",allocation.effective_until AS "effectiveUntil",allocation.reason,
          allocation.created_at AS "createdAt",account.plan_code AS "planCode",account.plan_version AS "planVersion",
          account.sold_modules AS "soldModules",account.limits AS "soldLimits",account.custom_override AS "customOverride"
          FROM organization_entitlement_allocations allocation
          JOIN account_entitlement_versions account ON account.id=allocation.account_entitlement_id
          WHERE allocation.workspace_id=$1 ORDER BY allocation.version DESC LIMIT 20`, [registry.workspaceId]);
      const policy = await client.query(`SELECT storage_quota_bytes::text AS "storageQuotaBytes",retention_days AS "retentionDays",
          legal_hold AS "legalHold",scan_requirement AS "scanRequirement",scanner_status AS "scannerStatus",
          export_before_erasure AS "exportBeforeErasure",version,updated_at AS "updatedAt"
          FROM workspace_data_policies WHERE workspace_id=$1`, [registry.workspaceId]);
      const support = await client.query(`SELECT id,access_level AS "accessLevel",status,reason,requested_by AS "requestedBy",
          approved_by AS "approvedBy",requested_at AS "requestedAt",approved_at AS "approvedAt",
          starts_at AS "startsAt",expires_at AS "expiresAt",ended_at AS "endedAt",version
          FROM tenant_support_sessions WHERE workspace_id=$1 ORDER BY requested_at DESC LIMIT 20`, [registry.workspaceId]);
      const operations = await client.query(`SELECT run.id,run.operation_type AS "operationType",run.phase,run.status,
          run.target_workspace_id AS "targetWorkspaceId",target.external_tenant_id AS "targetExternalTenantId",
          run.reason,run.plan,run.result,run.rollback_of AS "rollbackOf",run.requested_by AS "requestedBy",
          run.approved_by AS "approvedBy",run.version,run.created_at AS "createdAt",
          run.started_at AS "startedAt",run.completed_at AS "completedAt"
          FROM tenant_operation_runs run
          LEFT JOIN tenant_provisioning_requests target ON target.workspace_id=run.target_workspace_id
          WHERE run.workspace_id=$1 ORDER BY run.created_at DESC,run.id DESC LIMIT 20`, [registry.workspaceId]);
      const usageValue = await this.usage(client, registry.workspaceId);
      const adoption = await client.query(`SELECT count(*)::int AS "eventCount",count(DISTINCT actor_user_id)::int AS "activeActors",
          max(occurred_at) AS "lastActivityAt"
          FROM audit_events WHERE workspace_id=$1 AND occurred_at>=now()-interval '30 days'`, [registry.workspaceId]);
      const policyValue = policy.rows[0] ?? null;
      return {
        workspaceId: registry.workspaceId,
        externalTenantId: registry.externalTenantId,
        excludedSystemTables: [...EXPORT_EXCLUDED_TABLES].sort(),
        organization: organization.rows[0],
        entitlements: entitlement.rows[0] ?? { status: "not_configured" },
        entitlementHistory: entitlementHistory.rows,
        dataPolicy: policyValue ?? { status: "not_configured", scannerStatus: "baseline" },
        usage: {
          ...usageValue,
          storageQuotaBytes: policyValue?.storageQuotaBytes ?? null,
          storagePercent: policyValue?.storageQuotaBytes
            ? Math.min(100, Math.round((usageValue.knownFileBytes / Number(policyValue.storageQuotaBytes)) * 10000) / 100)
            : null,
          coverage: "managed_objects_and_known_legacy",
        },
        adoption: { windowDays: 30, ...adoption.rows[0] },
        supportSessions: support.rows.map((row: Record<string, unknown>) => {
          const projected = this.expireProjection(row);
          return {
            ...projected,
            canApprove: projected.status === "requested" && projected.requestedBy !== operatorUserId,
            canRevoke: projected.status === "active",
          };
        }),
        operations: operations.rows.map((operation: Record<string, unknown>) => ({
          ...operation,
          canApprove: operation.status === "planned" && operation.requestedBy !== operatorUserId
            && operation.operationType !== "erasure" && (operation.plan as { executable?: boolean } | null)?.executable === true,
        })),
        observedAt: new Date().toISOString(),
      };
    });
  }

  async updateEntitlements(externalTenantId: string, input: UpdateTenantEntitlementsDto, operatorUserId: string, correlationId?: string) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      await client.query(`SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, [registry.workspaceId]);
      const current = await client.query(`SELECT * FROM effective_workspace_entitlements WHERE workspace_id=$1`, [registry.workspaceId]);
      const legacy = await client.query(`SELECT * FROM workspace_entitlement_sets WHERE workspace_id=$1 FOR UPDATE`, [registry.workspaceId]);
      const latestAllocation = await client.query<{ version: number }>(
        `SELECT version FROM organization_entitlement_allocations WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1`,
        [registry.workspaceId],
      );
      const version = Number(latestAllocation.rows[0]?.version ?? legacy.rows[0]?.version ?? 0);
      if (version !== input.expectedVersion) throw new ConflictException("Entitlements changed. Refresh and try again.");
      const commercial = await client.query<{
        accountId: string; contractStatus: string; planCode: string; planVersion: number;
        seatLimit: number; projectLimit: number; configuration: Record<string, unknown> | null;
      }>(`SELECT linked.account_id AS "accountId",contract.status AS "contractStatus",
          contract.plan_code AS "planCode",contract.plan_version AS "planVersion",
          contract.seat_limit AS "seatLimit",contract.project_limit AS "projectLimit",profile.configuration
          FROM customer_account_organizations linked
          JOIN customer_account_contracts contract ON contract.account_id=linked.account_id
          LEFT JOIN tenant_setup_profiles profile ON profile.kind='plan'
            AND profile.code=contract.plan_code AND profile.version=contract.plan_version
          WHERE linked.workspace_id=$1 FOR UPDATE OF contract`, [registry.workspaceId]);
      if (!commercial.rowCount) throw new ConflictException("The organization has no account contract to allocate.");
      const contract = commercial.rows[0];
      if (contract.contractStatus === "expired") throw new ConflictException("The account contract is expired.");
      if (contract.planCode !== input.planCode || contract.planVersion !== input.planVersion) {
        throw new ConflictException("The requested plan does not match the account contract.");
      }
      if (!contract.configuration) throw new ConflictException("The contracted plan version is not published.");
      let planned: ReturnType<typeof planCommercialEntitlement>;
      try {
        planned = planCommercialEntitlement({
          requestedModules: input.modules,
          requestedLimits: input.limits,
          planConfiguration: contract.configuration,
          contract: { seatLimit: contract.seatLimit, projectLimit: contract.projectLimit },
          status: input.status,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil,
        });
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "The entitlement allocation is invalid.");
      }
      const accountVersion = await client.query<{ version: number }>(
        `SELECT COALESCE(max(version),0)::int+1 AS version FROM account_entitlement_versions WHERE account_id=$1`,
        [contract.accountId],
      );
      const accountEntitlement = await client.query<{ id: string }>(
        `INSERT INTO account_entitlement_versions
          (account_id,version,plan_code,plan_version,status,sold_modules,limits,custom_override,
           effective_from,effective_until,reason,created_by)
         VALUES($1,$2,$3,$4,'active',$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
         RETURNING id`,
        [contract.accountId, accountVersion.rows[0].version, input.planCode, input.planVersion,
          JSON.stringify(planned.soldModules), JSON.stringify(planned.soldLimits), planned.customOverride,
          planned.effectiveFrom, planned.effectiveUntil, input.reason, operatorUserId],
      );
      const allocationVersion = version + 1;
      const persistedStatus = input.status === "scheduled" ? "active" : input.status;
      await client.query(
        `INSERT INTO organization_entitlement_allocations
          (workspace_id,account_entitlement_id,version,status,modules,limits,effective_from,effective_until,reason,created_by)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)`,
        [registry.workspaceId, accountEntitlement.rows[0].id, allocationVersion, persistedStatus,
          JSON.stringify(planned.allocationModules), JSON.stringify(planned.allocationLimits),
          planned.effectiveFrom, planned.effectiveUntil, input.reason, operatorUserId],
      );
      await client.query(
        `INSERT INTO workspace_entitlement_sets
          (workspace_id,plan_code,plan_version,status,modules,limits,effective_at,effective_until,reason,version,updated_by)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
         ON CONFLICT(workspace_id) DO UPDATE SET plan_code=excluded.plan_code,plan_version=excluded.plan_version,
           status=excluded.status,modules=excluded.modules,limits=excluded.limits,reason=excluded.reason,
           effective_at=excluded.effective_at,effective_until=excluded.effective_until,version=excluded.version,
           updated_by=excluded.updated_by,updated_at=now()`,
        [registry.workspaceId, input.planCode, input.planVersion, input.status,
          JSON.stringify(planned.allocationModules), JSON.stringify(planned.allocationLimits), planned.effectiveFrom,
          planned.effectiveUntil, input.reason, allocationVersion, operatorUserId],
      );
      const saved = {
        planCode: input.planCode,
        planVersion: input.planVersion,
        status: input.status,
        modules: planned.allocationModules,
        limits: planned.allocationLimits,
        soldModules: planned.soldModules,
        soldLimits: planned.soldLimits,
        customOverride: planned.customOverride,
        effectiveAt: planned.effectiveFrom,
        effectiveUntil: planned.effectiveUntil,
        reason: input.reason,
        version: allocationVersion,
      };
      await this.audit(client, registry, operatorUserId, "tenant.entitlements_updated", "workspace_entitlement", registry.workspaceId,
        current.rows[0] ?? null, saved, correlationId);
      return saved;
    });
  }

  async entitlementCatalog() {
    const [plans, capabilities] = await Promise.all([
      this.database.query<{ code: string; version: number; configuration: Record<string, unknown>; publishedAt: Date }>(
        `SELECT code,version,configuration,published_at AS "publishedAt" FROM tenant_setup_profiles
         WHERE kind='plan' ORDER BY code,version DESC`,
      ),
      this.database.query(`SELECT code,module,release_state AS "releaseState",reason,version,
        updated_at AS "updatedAt" FROM platform_capability_flags ORDER BY module,code`),
    ]);
    return { plans: plans.rows, capabilityFlags: capabilities.rows, observedAt: new Date().toISOString() };
  }

  async billingOverview(externalTenantId: string, operatorUserId: string) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const account = await client.query(`SELECT account.id,account.display_name AS "displayName",account.status,
          linked.is_default AS "isDefaultOrganization"
        FROM customer_account_organizations linked
        JOIN customer_accounts account ON account.id=linked.account_id
        WHERE linked.workspace_id=$1`, [registry.workspaceId]);
      if (!account.rowCount) throw new ConflictException("The organization is not linked to a customer account.");
      const accountId = account.rows[0].id as string;
      const [contract, contractHistory, allocation, allocationHistory, organizations, collection, collectionHistory,
        documents, documentEvents, usageSnapshots] = await Promise.all([
        client.query(`SELECT id,version,status,plan_code AS "planCode",plan_version AS "planVersion",currency,
            billing_cycle AS "billingCycle",recurring_amount::text AS "recurringAmount",seat_limit AS "seatLimit",
            project_limit AS "projectLimit",contract_reference AS "contractReference",signed_at AS "signedAt",
            trial_ends_at AS "trialEndsAt",term_starts_at AS "termStartsAt",renews_at AS "renewsAt",ends_at AS "endsAt",
            terms,legal_entity_reference AS "legalEntityReference",tax_validation_state AS "taxValidationState",
            effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",reason,created_at AS "createdAt"
          FROM effective_account_contracts WHERE account_id=$1`, [accountId]),
        client.query(`SELECT id,version,status,plan_code AS "planCode",plan_version AS "planVersion",currency,
            billing_cycle AS "billingCycle",recurring_amount::text AS "recurringAmount",seat_limit AS "seatLimit",
            project_limit AS "projectLimit",effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",
            reason,created_at AS "createdAt"
          FROM account_contract_versions WHERE account_id=$1 ORDER BY version DESC LIMIT 20`, [accountId]),
        client.query(`SELECT id,account_contract_version_id AS "accountContractVersionId",version,status,
            allocated_amount::text AS "allocatedAmount",seat_limit AS "seatLimit",project_limit AS "projectLimit",
            effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",reason,created_at AS "createdAt"
          FROM effective_organization_billing_allocations WHERE workspace_id=$1`, [registry.workspaceId]),
        client.query(`SELECT id,account_contract_version_id AS "accountContractVersionId",version,status,
            allocated_amount::text AS "allocatedAmount",seat_limit AS "seatLimit",project_limit AS "projectLimit",
            effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",reason,created_at AS "createdAt"
          FROM organization_billing_allocation_versions WHERE workspace_id=$1 ORDER BY version DESC LIMIT 20`, [registry.workspaceId]),
        client.query(`SELECT linked.workspace_id AS "workspaceId",workspace.name,workspace.slug,allocation.version,
            allocation.status,allocation.allocated_amount::text AS "allocatedAmount",allocation.seat_limit AS "seatLimit",
            allocation.project_limit AS "projectLimit",allocation.effective_from AS "effectiveFrom",
            allocation.effective_until AS "effectiveUntil"
          FROM customer_account_organizations linked
          JOIN workspaces workspace ON workspace.id=linked.workspace_id
          LEFT JOIN effective_organization_billing_allocations allocation ON allocation.workspace_id=linked.workspace_id
          WHERE linked.account_id=$1 ORDER BY linked.is_default DESC,workspace.name`, [accountId]),
        client.query(`SELECT id,version,status,overdue_amount::text AS "overdueAmount",currency,
            effective_at AS "effectiveAt",next_review_at AS "nextReviewAt",reason,created_at AS "createdAt"
          FROM account_collection_state_versions WHERE account_id=$1 ORDER BY version DESC LIMIT 1`, [accountId]),
        client.query(`SELECT id,version,status,overdue_amount::text AS "overdueAmount",currency,
            effective_at AS "effectiveAt",next_review_at AS "nextReviewAt",reason,created_at AS "createdAt"
          FROM account_collection_state_versions WHERE account_id=$1 ORDER BY version DESC LIMIT 20`, [accountId]),
        client.query(`SELECT id,document_type AS "documentType",provider,external_reference AS "externalReference",
            document_number AS "documentNumber",status,currency,total_amount::text AS "totalAmount",
            balance_amount::text AS "balanceAmount",issued_at AS "issuedAt",due_at AS "dueAt",settled_at AS "settledAt",
            legal_entity_reference AS "legalEntityReference",tax_validation_state AS "taxValidationState",
            metadata,version,created_at AS "createdAt",updated_at AS "updatedAt"
          FROM account_billing_documents WHERE account_id=$1
          ORDER BY COALESCE(due_at,issued_at,created_at) DESC,id DESC LIMIT 50`, [accountId]),
        client.query(`SELECT event.id,event.document_id AS "documentId",event.event_type AS "eventType",
            event.previous_status AS "previousStatus",event.status,event.payload,event.occurred_at AS "occurredAt",
            event.recorded_at AS "recordedAt"
          FROM account_billing_document_events event WHERE event.account_id=$1
          ORDER BY event.occurred_at DESC,event.recorded_at DESC LIMIT 100`, [accountId]),
        client.query(`SELECT id,period_start AS "periodStart",period_end AS "periodEnd",captured_at AS "capturedAt",
            source,totals,organization_usage AS "organizationUsage"
          FROM account_usage_snapshots WHERE account_id=$1 ORDER BY period_end DESC,captured_at DESC LIMIT 12`, [accountId]),
      ]);
      return {
        account: account.rows[0],
        contract: contract.rows[0] ?? { status: "not_configured", taxValidationState: "unverified" },
        contractHistory: contractHistory.rows,
        organizationAllocation: allocation.rows[0] ?? { status: "not_configured" },
        organizationAllocationHistory: allocationHistory.rows,
        organizations: organizations.rows,
        collection: collection.rows[0] ?? { status: "not_configured" },
        collectionHistory: collectionHistory.rows,
        documents: documents.rows,
        documentEvents: documentEvents.rows,
        usageSnapshots: usageSnapshots.rows,
        authority: "account_contract",
        taxCompliance: "unverified",
        observedAt: new Date().toISOString(),
      };
    });
  }

  async updateAccountContract(
    externalTenantId: string,
    input: UpdateAccountContractDto,
    operatorUserId: string,
    correlationId?: string,
  ) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const linked = await client.query<{ accountId: string }>(`SELECT account_id AS "accountId"
        FROM customer_account_organizations WHERE workspace_id=$1`, [registry.workspaceId]);
      if (!linked.rowCount) throw new ConflictException("The organization is not linked to a customer account.");
      const accountId = linked.rows[0].accountId;
      await client.query(`SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE`, [accountId]);
      const current = await client.query<{ version: number }>(`SELECT * FROM account_contract_versions
        WHERE account_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE`, [accountId]);
      const currentVersion = Number(current.rows[0]?.version ?? 0);
      if (currentVersion !== input.expectedVersion) throw new ConflictException("The account contract changed. Refresh and try again.");
      const profile = await client.query(`SELECT 1 FROM tenant_setup_profiles
        WHERE kind='plan' AND code=$1 AND version=$2`, [input.planCode, input.planVersion]);
      if (!profile.rowCount) throw new ConflictException("Choose a published plan version.");
      let planned: ReturnType<typeof planAccountContract>;
      try {
        planned = planAccountContract(input);
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "The account contract is invalid.");
      }
      const allocations = await client.query<{ amount: string; seats: number; projects: number }>(`SELECT
          COALESCE(sum(allocated_amount),0)::text AS amount,COALESCE(sum(seat_limit),0)::int AS seats,
          COALESCE(sum(project_limit),0)::int AS projects
        FROM effective_organization_billing_allocations allocation
        JOIN customer_account_organizations linked ON linked.workspace_id=allocation.workspace_id
        WHERE linked.account_id=$1 AND allocation.status IN ('scheduled','active','suspended')`, [accountId]);
      const allocated = allocations.rows[0];
      if (Number(allocated.amount) > planned.recurringAmount || allocated.seats > planned.seatLimit
        || allocated.projects > planned.projectLimit) {
        throw new ConflictException("The contract cannot be lower than its current organization allocations.");
      }
      const version = currentVersion + 1;
      const saved = await client.query(`INSERT INTO account_contract_versions
          (account_id,version,status,plan_code,plan_version,currency,billing_cycle,recurring_amount,
           seat_limit,project_limit,contract_reference,signed_at,trial_ends_at,term_starts_at,renews_at,ends_at,
           terms,legal_entity_reference,tax_validation_state,effective_from,effective_until,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'unverified',$19,$20,$21,$22)
        RETURNING id,version,status,plan_code AS "planCode",plan_version AS "planVersion",currency,
          billing_cycle AS "billingCycle",recurring_amount::text AS "recurringAmount",seat_limit AS "seatLimit",
          project_limit AS "projectLimit",contract_reference AS "contractReference",signed_at AS "signedAt",
          trial_ends_at AS "trialEndsAt",term_starts_at AS "termStartsAt",renews_at AS "renewsAt",ends_at AS "endsAt",
          terms,legal_entity_reference AS "legalEntityReference",tax_validation_state AS "taxValidationState",
          effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",reason,created_at AS "createdAt"`,
      [accountId, version, planned.status, planned.planCode, planned.planVersion, planned.currency, planned.billingCycle,
        planned.recurringAmount, planned.seatLimit, planned.projectLimit, planned.contractReference, planned.signedAt,
        planned.trialEndsAt, planned.termStartsAt, planned.renewsAt, planned.endsAt, JSON.stringify(planned.terms),
        planned.legalEntityReference, planned.effectiveFrom, planned.effectiveUntil, input.reason, operatorUserId]);
      await client.query(`INSERT INTO customer_account_contracts
          (account_id,status,plan_code,plan_version,currency,billing_cycle,seat_limit,project_limit,
           contract_reference,signed_at,trial_ends_at,version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(account_id) DO UPDATE SET status=excluded.status,plan_code=excluded.plan_code,
          plan_version=excluded.plan_version,currency=excluded.currency,billing_cycle=excluded.billing_cycle,
          seat_limit=excluded.seat_limit,project_limit=excluded.project_limit,
          contract_reference=excluded.contract_reference,signed_at=excluded.signed_at,
          trial_ends_at=excluded.trial_ends_at,version=excluded.version,updated_at=now()`,
      [accountId, planned.status, planned.planCode, planned.planVersion, planned.currency, planned.billingCycle,
        planned.seatLimit, planned.projectLimit, planned.contractReference, planned.signedAt, planned.trialEndsAt, version]);
      await client.query(`UPDATE workspace_subscriptions subscription SET
          plan_code=CASE WHEN $2 IN ('starter','pro','enterprise') THEN $2 ELSE subscription.plan_code END,
          status=CASE $3 WHEN 'trial_uncontracted' THEN 'trial' WHEN 'contracted' THEN 'active' ELSE 'cancelled' END,
          billing_cycle=$4,currency=$5,renews_at=$6,updated_by=$7,version=version+1,updated_at=now()
        FROM customer_account_organizations linked
        WHERE linked.account_id=$1 AND subscription.workspace_id=linked.workspace_id`,
      [accountId, planned.planCode, planned.status, planned.billingCycle, planned.currency, planned.renewsAt, operatorUserId]);
      await this.audit(client, registry, operatorUserId, "account.contract_versioned", "account_contract", accountId,
        current.rows[0] ?? null, saved.rows[0], correlationId);
      return saved.rows[0];
    });
  }

  async updateBillingAllocation(
    externalTenantId: string,
    input: UpdateOrganizationBillingAllocationDto,
    operatorUserId: string,
    correlationId?: string,
  ) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const contract = await client.query<{ accountId: string; id: string; recurringAmount: string; seatLimit: number;
        projectLimit: number; planCode: string; currency: string; billingCycle: string; renewsAt: Date | null }>(
        `SELECT linked.account_id AS "accountId",contract.id,contract.recurring_amount::text AS "recurringAmount",
          contract.seat_limit AS "seatLimit",contract.project_limit AS "projectLimit",contract.plan_code AS "planCode",
          contract.currency,contract.billing_cycle AS "billingCycle",contract.renews_at AS "renewsAt"
        FROM customer_account_organizations linked
        JOIN effective_account_contracts contract ON contract.account_id=linked.account_id
        WHERE linked.workspace_id=$1`, [registry.workspaceId]);
      if (!contract.rowCount) throw new ConflictException("Configure the account contract before allocating an organization.");
      await client.query(`SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE`, [contract.rows[0].accountId]);
      const current = await client.query<{ version: number }>(`SELECT * FROM organization_billing_allocation_versions
        WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE`, [registry.workspaceId]);
      const currentVersion = Number(current.rows[0]?.version ?? 0);
      if (currentVersion !== input.expectedVersion) throw new ConflictException("The organization allocation changed. Refresh and try again.");
      const elsewhere = await client.query<{ amount: string; seats: number; projects: number }>(`SELECT
          COALESCE(sum(allocation.allocated_amount),0)::text AS amount,
          COALESCE(sum(allocation.seat_limit),0)::int AS seats,
          COALESCE(sum(allocation.project_limit),0)::int AS projects
        FROM effective_organization_billing_allocations allocation
        JOIN customer_account_organizations linked ON linked.workspace_id=allocation.workspace_id
        WHERE linked.account_id=$1 AND allocation.workspace_id<>$2
          AND allocation.status IN ('scheduled','active','suspended')`, [contract.rows[0].accountId, registry.workspaceId]);
      const usage = await this.usage(client, registry.workspaceId);
      let planned: ReturnType<typeof planBillingAllocation>;
      try {
        planned = planBillingAllocation({ ...input,
          contract: { recurringAmount: Number(contract.rows[0].recurringAmount), seatLimit: contract.rows[0].seatLimit,
            projectLimit: contract.rows[0].projectLimit },
          allocatedElsewhere: { recurringAmount: Number(elsewhere.rows[0].amount), seatLimit: elsewhere.rows[0].seats,
            projectLimit: elsewhere.rows[0].projects },
          currentUsage: { seats: usage.members + usage.pendingInvitations, projects: usage.projects },
        });
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "The organization allocation is invalid.");
      }
      const saved = await client.query(`INSERT INTO organization_billing_allocation_versions
          (workspace_id,account_contract_version_id,version,status,allocated_amount,seat_limit,project_limit,
           effective_from,effective_until,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id,account_contract_version_id AS "accountContractVersionId",version,status,
          allocated_amount::text AS "allocatedAmount",seat_limit AS "seatLimit",project_limit AS "projectLimit",
          effective_from AS "effectiveFrom",effective_until AS "effectiveUntil",reason,created_at AS "createdAt"`,
      [registry.workspaceId, contract.rows[0].id, currentVersion + 1, planned.status, planned.allocatedAmount,
        planned.seatLimit, planned.projectLimit, planned.effectiveFrom, planned.effectiveUntil, input.reason, operatorUserId]);
      await client.query(`UPDATE workspace_subscriptions SET
          amount=$1,seat_limit=$2,project_limit=$3,
          plan_code=CASE WHEN $4 IN ('starter','pro','enterprise') THEN $4 ELSE plan_code END,
          currency=$5,billing_cycle=$6,renews_at=$7,
          status=CASE $8 WHEN 'ended' THEN 'cancelled' WHEN 'suspended' THEN 'past_due' ELSE 'active' END,
          updated_by=$9,version=version+1,updated_at=now() WHERE workspace_id=$10`,
      [planned.allocatedAmount, planned.seatLimit, planned.projectLimit, contract.rows[0].planCode,
        contract.rows[0].currency, contract.rows[0].billingCycle, contract.rows[0].renewsAt,
        planned.status, operatorUserId, registry.workspaceId]);
      await this.audit(client, registry, operatorUserId, "organization.billing_allocation_versioned",
        "organization_billing_allocation", registry.workspaceId, current.rows[0] ?? null, saved.rows[0], correlationId);
      return saved.rows[0];
    });
  }

  async recordBillingDocumentEvent(
    externalTenantId: string,
    input: RecordAccountBillingDocumentEventDto,
    idempotencyKey: string,
    operatorUserId: string,
    correlationId?: string,
  ) {
    const registry = await this.registry(externalTenantId);
    const requestHash = canonicalHash(input);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const linked = await client.query<{ accountId: string }>(`SELECT account_id AS "accountId"
        FROM customer_account_organizations WHERE workspace_id=$1`, [registry.workspaceId]);
      if (!linked.rowCount) throw new ConflictException("The organization is not linked to a customer account.");
      const accountId = linked.rows[0].accountId;
      const replay = await client.query<{ requestHash: string; documentId: string }>(`SELECT request_hash AS "requestHash",
          document_id AS "documentId" FROM account_billing_document_events
        WHERE account_id=$1 AND idempotency_key=$2`, [accountId, idempotencyKey]);
      if (replay.rowCount) {
        if (replay.rows[0].requestHash !== requestHash) throw new ConflictException("Idempotency key was reused with another billing event.");
        const document = await client.query(`SELECT id,document_type AS "documentType",provider,
            external_reference AS "externalReference",document_number AS "documentNumber",status,currency,
            total_amount::text AS "totalAmount",balance_amount::text AS "balanceAmount",issued_at AS "issuedAt",
            due_at AS "dueAt",settled_at AS "settledAt",tax_validation_state AS "taxValidationState",version
          FROM account_billing_documents WHERE id=$1`, [replay.rows[0].documentId]);
        return { ...document.rows[0], replayed: true };
      }
      const current = await client.query<{ id: string; status: BillingDocumentStatus; currency: string;
        totalAmount: string; balanceAmount: string; version: number }>(`SELECT id,status,currency,
          total_amount::text AS "totalAmount",balance_amount::text AS "balanceAmount",version
        FROM account_billing_documents WHERE account_id=$1 AND document_type=$2 AND provider=$3 AND external_reference=$4
        FOR UPDATE`, [accountId, input.documentType, input.provider, input.externalReference]);
      let planned: ReturnType<typeof validateBillingDocumentEvent>;
      try {
        planned = validateBillingDocumentEvent({ ...input, previousStatus: current.rows[0]?.status ?? null });
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "The billing document event is invalid.");
      }
      if (current.rowCount && input.eventType !== "corrected"
        && (Number(current.rows[0].totalAmount) !== input.totalAmount || current.rows[0].currency !== planned.currency)) {
        throw new ConflictException("Only a corrected event can change a billing document amount or currency.");
      }
      const document = current.rowCount
        ? await client.query(`UPDATE account_billing_documents SET document_number=COALESCE($2,document_number),
            status=$3,currency=$4,total_amount=$5,balance_amount=$6,issued_at=COALESCE($7,issued_at),
            due_at=$8,settled_at=$9,legal_entity_reference=COALESCE($10,legal_entity_reference),
            metadata=metadata || $11::jsonb,version=version+1 WHERE id=$1
          RETURNING id,document_type AS "documentType",provider,external_reference AS "externalReference",
            document_number AS "documentNumber",status,currency,total_amount::text AS "totalAmount",
            balance_amount::text AS "balanceAmount",issued_at AS "issuedAt",due_at AS "dueAt",settled_at AS "settledAt",
            legal_entity_reference AS "legalEntityReference",tax_validation_state AS "taxValidationState",metadata,version`,
        [current.rows[0].id, input.documentNumber ?? null, planned.status, planned.currency, input.totalAmount,
          input.balanceAmount, input.issuedAt ?? null, input.dueAt ?? null, input.settledAt ?? null,
          input.legalEntityReference ?? null, JSON.stringify(input.metadata ?? {})])
        : await client.query(`INSERT INTO account_billing_documents
            (account_id,document_type,provider,external_reference,document_number,status,currency,total_amount,
             balance_amount,issued_at,due_at,settled_at,legal_entity_reference,tax_validation_state,metadata)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'unverified',$14::jsonb)
          RETURNING id,document_type AS "documentType",provider,external_reference AS "externalReference",
            document_number AS "documentNumber",status,currency,total_amount::text AS "totalAmount",
            balance_amount::text AS "balanceAmount",issued_at AS "issuedAt",due_at AS "dueAt",settled_at AS "settledAt",
            legal_entity_reference AS "legalEntityReference",tax_validation_state AS "taxValidationState",metadata,version`,
        [accountId, input.documentType, input.provider, input.externalReference, input.documentNumber ?? null,
          planned.status, planned.currency, input.totalAmount, input.balanceAmount, input.issuedAt ?? null,
          input.dueAt ?? null, input.settledAt ?? null, input.legalEntityReference ?? null, JSON.stringify(input.metadata ?? {})]);
      await client.query(`INSERT INTO account_billing_document_events
          (account_id,document_id,idempotency_key,request_hash,event_type,previous_status,status,payload,
           occurred_at,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [accountId, document.rows[0].id,
        idempotencyKey, requestHash, input.eventType, current.rows[0]?.status ?? null, planned.status,
        JSON.stringify({ ...input, taxValidationState: "unverified" }), input.occurredAt, operatorUserId]);
      await this.operatorAudit(client, operatorUserId, "account.billing_document_recorded", externalTenantId,
        this.correlation(correlationId), { accountId, documentId: document.rows[0].id, eventType: input.eventType,
          status: planned.status });
      return { ...document.rows[0], replayed: false };
    });
  }

  async updateCollectionState(
    externalTenantId: string,
    input: UpdateAccountCollectionStateDto,
    operatorUserId: string,
    correlationId?: string,
  ) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const linked = await client.query<{ accountId: string }>(`SELECT account_id AS "accountId"
        FROM customer_account_organizations WHERE workspace_id=$1`, [registry.workspaceId]);
      if (!linked.rowCount) throw new ConflictException("The organization is not linked to a customer account.");
      const accountId = linked.rows[0].accountId;
      await client.query(`SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE`, [accountId]);
      const current = await client.query<{ version: number }>(`SELECT * FROM account_collection_state_versions
        WHERE account_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE`, [accountId]);
      const currentVersion = Number(current.rows[0]?.version ?? 0);
      if (currentVersion !== input.expectedVersion) throw new ConflictException("Collection state changed. Refresh and try again.");
      let planned: ReturnType<typeof validateCollectionState>;
      try {
        planned = validateCollectionState(input);
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "The collection state is invalid.");
      }
      const saved = await client.query(`INSERT INTO account_collection_state_versions
          (account_id,version,status,overdue_amount,currency,effective_at,next_review_at,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id,version,status,overdue_amount::text AS "overdueAmount",currency,
          effective_at AS "effectiveAt",next_review_at AS "nextReviewAt",reason,created_at AS "createdAt"`,
      [accountId, currentVersion + 1, planned.status, planned.overdueAmount, planned.currency,
        planned.effectiveAt, planned.nextReviewAt, input.reason, operatorUserId]);
      await client.query(`UPDATE workspace_subscriptions subscription SET status=CASE
          WHEN $2 IN ('current','grace') THEN 'active' WHEN $2='closed' THEN 'cancelled' ELSE 'past_due' END,
          updated_by=$3,version=version+1,updated_at=now()
        FROM customer_account_organizations linked
        WHERE linked.account_id=$1 AND subscription.workspace_id=linked.workspace_id`,
      [accountId, planned.status, operatorUserId]);
      await this.audit(client, registry, operatorUserId, "account.collection_state_versioned", "account_collection",
        accountId, current.rows[0] ?? null, saved.rows[0], correlationId);
      return saved.rows[0];
    });
  }

  async captureUsageSnapshot(
    externalTenantId: string,
    input: CaptureAccountUsageSnapshotDto,
    operatorUserId: string,
  ) {
    const registry = await this.registry(externalTenantId);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (periodEnd <= periodStart) throw new ConflictException("Usage period end must be after its start.");
    const account = await this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const result = await client.query<{ accountId: string; workspaceId: string; name: string }>(`SELECT
          linked.account_id AS "accountId",linked.workspace_id AS "workspaceId",workspace.name
        FROM customer_account_organizations source
        JOIN customer_account_organizations linked ON linked.account_id=source.account_id
        JOIN workspaces workspace ON workspace.id=linked.workspace_id
        WHERE source.workspace_id=$1 ORDER BY linked.is_default DESC,workspace.name`, [registry.workspaceId]);
      if (!result.rowCount) throw new ConflictException("The organization is not linked to a customer account.");
      return { accountId: result.rows[0].accountId, organizations: result.rows };
    });
    const organizationUsage = await Promise.all(account.organizations.map(async (organization) => ({
      workspaceId: organization.workspaceId,
      name: organization.name,
      ...await this.database.tenantTransaction(organization.workspaceId, operatorUserId,
        (client) => this.usage(client, organization.workspaceId)),
    })));
    const totals = organizationUsage.reduce((sum, usage) => ({
      members: sum.members + usage.members,
      pendingInvitations: sum.pendingInvitations + usage.pendingInvitations,
      projects: sum.projects + usage.projects,
      knownFileBytes: sum.knownFileBytes + usage.knownFileBytes,
      knownFileCount: sum.knownFileCount + usage.knownFileCount,
    }), { members: 0, pendingInvitations: 0, projects: 0, knownFileBytes: 0, knownFileCount: 0 });
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const saved = await client.query(`INSERT INTO account_usage_snapshots
          (account_id,period_start,period_end,source,totals,organization_usage,created_by)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
        RETURNING id,period_start AS "periodStart",period_end AS "periodEnd",captured_at AS "capturedAt",
          source,totals,organization_usage AS "organizationUsage"`, [account.accountId, periodStart, periodEnd,
        input.source, JSON.stringify(totals), JSON.stringify(organizationUsage), operatorUserId]);
      return saved.rows[0];
    });
  }

  async updatePlatformCapability(input: UpdatePlatformCapabilityDto, operatorUserId: string, correlationId?: string) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const current = await client.query(`SELECT * FROM platform_capability_flags WHERE code=$1 FOR UPDATE`, [input.code]);
      const version = Number(current.rows[0]?.version ?? 0);
      if (version !== input.expectedVersion) throw new ConflictException("Capability changed. Refresh and try again.");
      const saved = await client.query(
        `INSERT INTO platform_capability_flags(code,module,release_state,reason,updated_by)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(code) DO UPDATE SET module=excluded.module,release_state=excluded.release_state,
           reason=excluded.reason,version=platform_capability_flags.version+1,updated_by=excluded.updated_by
         RETURNING code,module,release_state AS "releaseState",reason,version,updated_at AS "updatedAt"`,
        [input.code, input.module, input.releaseState, input.reason, operatorUserId],
      );
      const correlation = this.correlation(correlationId);
      await client.query(`INSERT INTO platform_operator_audit
        (actor_user_id,action,target_type,target_id,correlation_id,details)
        VALUES($1,'platform.capability_updated','capability',$2,$3,$4::jsonb)`,
      [operatorUserId, input.code, correlation, JSON.stringify({ before: current.rows[0] ?? null, after: saved.rows[0] })]);
      return saved.rows[0];
    });
  }

  async updateDataPolicy(externalTenantId: string, input: UpdateTenantDataPolicyDto, operatorUserId: string, correlationId?: string) {
    const registry = await this.registry(externalTenantId);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const current = await client.query(`SELECT * FROM workspace_data_policies WHERE workspace_id=$1 FOR UPDATE`, [registry.workspaceId]);
      const version = Number(current.rows[0]?.version ?? 0);
      if (version !== input.expectedVersion) throw new ConflictException("Data policy changed. Refresh and try again.");
      const usage = await this.usage(client, registry.workspaceId);
      if (input.storageQuotaBytes < usage.knownFileBytes) {
        throw new ConflictException({ message: "Storage quota cannot be lower than known file usage", knownFileBytes: usage.knownFileBytes });
      }
      const saved = await client.query(
        `INSERT INTO workspace_data_policies
          (workspace_id,storage_quota_bytes,retention_days,legal_hold,scan_requirement,scanner_status,export_before_erasure,updated_by)
         VALUES($1,$2,$3,$4,$5,'baseline',$6,$7)
         ON CONFLICT(workspace_id) DO UPDATE SET storage_quota_bytes=excluded.storage_quota_bytes,
           retention_days=excluded.retention_days,legal_hold=excluded.legal_hold,
           scan_requirement=excluded.scan_requirement,export_before_erasure=excluded.export_before_erasure,
           version=workspace_data_policies.version+1,updated_by=excluded.updated_by,updated_at=now()
         RETURNING storage_quota_bytes::text AS "storageQuotaBytes",retention_days AS "retentionDays",
           legal_hold AS "legalHold",scan_requirement AS "scanRequirement",scanner_status AS "scannerStatus",
           export_before_erasure AS "exportBeforeErasure",version,updated_at AS "updatedAt"`,
        [registry.workspaceId, input.storageQuotaBytes, input.retentionDays, input.legalHold,
          input.scanRequirement, input.exportBeforeErasure, operatorUserId],
      );
      await this.audit(client, registry, operatorUserId, "tenant.data_policy_updated", "workspace_data_policy", registry.workspaceId,
        current.rows[0] ?? null, saved.rows[0], correlationId);
      return saved.rows[0];
    });
  }

  async plan(externalTenantId: string, input: CreateTenantOperationPlanDto, idempotencyKey: string, operatorUserId: string, correlationId?: string) {
    const source = await this.registry(externalTenantId);
    const rollbackSource = input.rollbackOf
      ? await this.database.tenantTransaction(source.workspaceId, operatorUserId, async (client) => {
        const found = await client.query<{ targetWorkspaceId: string; result: { before?: ConfigurationCloneSnapshot } | null }>(
          `SELECT target_workspace_id AS "targetWorkspaceId",result FROM tenant_operation_runs
           WHERE workspace_id=$1 AND id=$2 AND operation_type='clone' AND phase='apply' AND status='succeeded'`,
          [source.workspaceId, input.rollbackOf],
        );
        if (!found.rowCount || !found.rows[0].result?.before) {
          throw new ConflictException("Choose a completed configuration clone with rollback evidence.");
        }
        return found.rows[0];
      }) : null;
    const target = rollbackSource
      ? await this.registryByWorkspace(rollbackSource.targetWorkspaceId)
      : input.operationType === "clone" && input.targetExternalTenantId
        ? await this.registry(input.targetExternalTenantId) : null;
    if (input.targetExternalTenantId && target?.externalTenantId !== input.targetExternalTenantId) {
      throw new ConflictException("The rollback target does not match the completed clone.");
    }
    if (target?.workspaceId === source.workspaceId) throw new ConflictException("Choose another organization as the clone target.");
    const [sourceState, targetState] = await Promise.all([
      this.snapshot(source.workspaceId),
      target ? this.snapshot(target.workspaceId) : Promise.resolve(null),
    ]);
    return this.database.tenantTransaction(source.workspaceId, operatorUserId, async (client) => {
      const existing = await client.query(`SELECT request_hash AS "requestHash",id,operation_type AS "operationType",phase,status,
        target_workspace_id AS "targetWorkspaceId",reason,plan,result,rollback_of AS "rollbackOf",version,created_at AS "createdAt"
        FROM tenant_operation_runs WHERE workspace_id=$1 AND idempotency_key=$2`, [source.workspaceId, idempotencyKey]);
      const requestHash = canonicalHash({ input, source: source.workspaceId, target: target?.workspaceId ?? null });
      if (existing.rowCount) {
        if (existing.rows[0].requestHash !== requestHash) throw new ConflictException("Idempotency key was already used for another operation.");
        const { requestHash: _requestHash, ...replay } = existing.rows[0];
        return replay;
      }
      const completedExport = await client.query(`SELECT 1 FROM tenant_operation_runs WHERE workspace_id=$1
        AND operation_type='export' AND phase='apply' AND status='succeeded' LIMIT 1`, [source.workspaceId]);
      const plan = operationPlan({
        type: input.operationType,
        source: sourceState.usage,
        target: targetState?.usage,
        legalHold: sourceState.legalHold,
        exportBeforeErasure: sourceState.exportBeforeErasure,
        hasCompletedExport: Boolean(completedExport.rowCount),
      });
      if (input.rollbackOf) {
        plan.note = "Dry-run only. Approval restores the target configuration captured before the selected clone; operational records are not changed.";
      }
      const created = await client.query(
        `INSERT INTO tenant_operation_runs
          (workspace_id,target_workspace_id,operation_type,phase,status,idempotency_key,request_hash,reason,plan,rollback_of,requested_by)
         VALUES($1,$2,$3,'dry_run',$4,$5,$6,$7,$8::jsonb,$9,$10)
         RETURNING id,operation_type AS "operationType",phase,status,target_workspace_id AS "targetWorkspaceId",
           reason,plan,result,rollback_of AS "rollbackOf",version,created_at AS "createdAt"`,
        [source.workspaceId, target?.workspaceId ?? null, input.operationType,
          plan.executable ? "planned" : "blocked", idempotencyKey, requestHash, input.reason,
          JSON.stringify(plan), input.rollbackOf ?? null, operatorUserId],
      );
      const correlation = this.correlation(correlationId);
      await this.operatorAudit(client, operatorUserId, "tenant.operation_planned", externalTenantId, correlation,
        { workspaceId: source.workspaceId, operationId: created.rows[0].id, operationType: input.operationType,
          targetWorkspaceId: target?.workspaceId ?? null, executable: plan.executable });
      return created.rows[0];
    });
  }

  async decideOperation(
    externalTenantId: string,
    operationId: string,
    input: DecideTenantOperationDto,
    operatorUserId: string,
    correlationId?: string,
  ) {
    const source = await this.registry(externalTenantId);
    const correlation = this.correlation(correlationId);
    const selected = await this.database.tenantTransaction(source.workspaceId, operatorUserId, async (client) => {
      const found = await client.query<{
        id: string; operationType: "clone" | "export" | "erasure"; status: string; phase: string;
        targetWorkspaceId: string | null; requestedBy: string; rollbackOf: string | null;
        plan: { executable?: boolean }; version: number;
      }>(`SELECT id,operation_type AS "operationType",status,phase,target_workspace_id AS "targetWorkspaceId",
          requested_by AS "requestedBy",rollback_of AS "rollbackOf",plan,version
          FROM tenant_operation_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [source.workspaceId, operationId]);
      if (!found.rowCount) throw new NotFoundException("Tenant operation was not found");
      const operation = found.rows[0];
      if (operation.version !== input.expectedVersion || operation.status !== "planned" || operation.phase !== "dry_run") {
        throw new ConflictException("Tenant operation changed. Refresh and try again.");
      }
      if (input.decision === "cancel") {
        const cancelled = await client.query(`UPDATE tenant_operation_runs SET status='cancelled',completed_at=now(),version=version+1
          WHERE workspace_id=$1 AND id=$2 RETURNING id,operation_type AS "operationType",phase,status,plan,result,version`,
        [source.workspaceId, operationId]);
        await this.operatorAudit(client, operatorUserId, "tenant.operation_cancelled", externalTenantId, correlation,
          { workspaceId: source.workspaceId, operationId, reason: input.reason });
        return { state: "cancelled" as const, operation: cancelled.rows[0] };
      }
      if (operation.requestedBy === operatorUserId) {
        throw new ConflictException("A second operator must approve a tenant operation.");
      }
      if (operation.operationType === "erasure") {
        throw new ConflictException("Erasure needs the retention-safe data-rights worker before approval.");
      }
      if (operation.plan?.executable !== true || (operation.operationType === "clone" && !operation.targetWorkspaceId)) {
        throw new ConflictException("Resolve the dry-run blockers before approval.");
      }
      await client.query(`UPDATE tenant_operation_runs SET phase=$3,status='running',approved_by=$4,started_at=now(),version=version+1
        WHERE workspace_id=$1 AND id=$2`, [source.workspaceId, operationId, operation.rollbackOf ? "rollback" : "apply", operatorUserId]);
      return { state: "apply" as const, operation };
    });
    if (selected.state === "cancelled") return selected.operation;

    const operation = selected.operation;
    try {
      if (operation.operationType === "export") {
        return await this.executeExport(source, operation.id, operatorUserId, input.reason, correlation);
      }
      const target = await this.registryByWorkspace(operation.targetWorkspaceId!);
      const targetState = await this.snapshot(target.workspaceId);
      if (targetState.usage.projects > 0 || targetState.usage.members > 1 || targetState.usage.knownFileCount > 0) {
        throw new ConflictException("The target changed after the dry run and is no longer empty.");
      }
      const before = await this.configurationSnapshot(target.workspaceId);
      let desired: ConfigurationCloneSnapshot;
      if (operation.rollbackOf) {
        const original = await this.database.tenantTransaction(source.workspaceId, operatorUserId, (client) => client.query<{
          result: { before?: ConfigurationCloneSnapshot } | null;
        }>(`SELECT result FROM tenant_operation_runs WHERE workspace_id=$1 AND id=$2 AND status='succeeded'`,
        [source.workspaceId, operation.rollbackOf!]));
        if (!original.rowCount || !original.rows[0].result?.before) throw new ConflictException("Rollback evidence is unavailable.");
        desired = original.rows[0].result.before;
      } else {
        desired = await this.configurationSnapshot(source.workspaceId);
      }
      await this.applyConfiguration(target, desired, before, operatorUserId, operationId, correlation);
      const after = await this.configurationSnapshot(target.workspaceId);
      return await this.database.tenantTransaction(source.workspaceId, operatorUserId, async (client) => {
        const saved = await client.query(`UPDATE tenant_operation_runs SET status='succeeded',completed_at=now(),
          result=$3::jsonb,version=version+1 WHERE workspace_id=$1 AND id=$2
          RETURNING id,operation_type AS "operationType",phase,status,target_workspace_id AS "targetWorkspaceId",
            reason,plan,result,rollback_of AS "rollbackOf",approved_by AS "approvedBy",version,
            created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt"`,
        [source.workspaceId, operationId, JSON.stringify({ before, after })]);
        await this.operatorAudit(client, operatorUserId, operation.rollbackOf ? "tenant.clone_rolled_back" : "tenant.clone_applied",
          externalTenantId, correlation, { workspaceId: source.workspaceId, targetWorkspaceId: target.workspaceId, operationId, reason: input.reason });
        return saved.rows[0];
      });
    } catch (error) {
      await this.database.tenantTransaction(source.workspaceId, operatorUserId, (client) => client.query(
        `UPDATE tenant_operation_runs SET status='failed',completed_at=now(),result=$3::jsonb,version=version+1
         WHERE workspace_id=$1 AND id=$2`, [source.workspaceId, operationId, JSON.stringify({ code: "apply_failed" })],
      ));
      throw error;
    }
  }

  async readExport(externalTenantId: string, exportId: string, operatorUserId: string) {
    if (!this.storage) throw new ConflictException("Tenant export storage is not configured.");
    const registry = await this.registry(externalTenantId);
    const record = await this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const found = await client.query<{ objectKey: string; sha256: string; status: string; expiresAt: Date }>(
        `SELECT object_key AS "objectKey",sha256,status,expires_at AS "expiresAt"
         FROM tenant_data_exports WHERE workspace_id=$1 AND id=$2`, [registry.workspaceId, exportId],
      );
      if (!found.rowCount || found.rows[0].status !== "verified") throw new NotFoundException("Tenant export was not found");
      if (new Date(found.rows[0].expiresAt).getTime() <= Date.now()) throw new ConflictException("Tenant export has expired.");
      return found.rows[0];
    });
    const stored = await this.storage.read(record.objectKey);
    const digest = createHash("sha256").update(stored.body).digest("hex");
    if (digest !== record.sha256) throw new ConflictException("Tenant export checksum verification failed.");
    await this.database.tenantTransaction(registry.workspaceId, operatorUserId, (client) => client.query(
      `UPDATE tenant_data_exports SET downloaded_at=now() WHERE workspace_id=$1 AND id=$2`,
      [registry.workspaceId, exportId],
    ));
    return { body: stored.body, fileName: `${registry.externalTenantId}-export-${exportId}.json`, sha256: digest };
  }

  private async executeExport(registry: Registry, operationId: string, operatorUserId: string, reason: string, correlationId: string) {
    if (!this.storage) throw new ConflictException("Tenant export storage is not configured.");
    const payload = await this.exportPayload(registry, operationId);
    const body = Buffer.from(JSON.stringify(payload));
    const objectKey = `tenant-exports/${registry.workspaceId}/${operationId}/export.json`;
    const stored = await this.storage.putSystemArtifact(objectKey, body, "application/json");
    try {
      return await this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
        const artifact = await client.query<{ id: string }>(
          `INSERT INTO tenant_data_exports
            (workspace_id,operation_id,object_key,sha256,byte_size,table_count,record_count,file_count,file_bytes,created_by,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '7 days') RETURNING id`,
          [registry.workspaceId, operationId, objectKey, stored.sha256, stored.byteSize,
            payload.tables.length, payload.recordCount, payload.objectManifest.length, payload.objectBytes, operatorUserId],
        );
        const result = {
          exportId: artifact.rows[0].id, objectKey, sha256: stored.sha256, byteSize: stored.byteSize,
          tableCount: payload.tables.length, recordCount: payload.recordCount,
          fileCount: payload.objectManifest.length, fileBytes: payload.objectBytes,
          expiresInDays: 7, scope: payload.scope,
        };
        const saved = await client.query(`UPDATE tenant_operation_runs SET status='succeeded',completed_at=now(),
          result=$3::jsonb,version=version+1 WHERE workspace_id=$1 AND id=$2
          RETURNING id,operation_type AS "operationType",phase,status,reason,plan,result,
            approved_by AS "approvedBy",version,created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt"`,
        [registry.workspaceId, operationId, JSON.stringify(result)]);
        await this.operatorAudit(client, operatorUserId, "tenant.export_verified", registry.externalTenantId, correlationId,
          { workspaceId: registry.workspaceId, operationId, exportId: artifact.rows[0].id,
            sha256: stored.sha256, byteSize: stored.byteSize, reason });
        return saved.rows[0];
      });
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  private async exportPayload(registry: Registry, operationId: string) {
    return this.database.tenantTransaction(registry.workspaceId, registry.workspaceId, async (client) => {
      const discovered = await client.query<{ tableName: string }>(
        `SELECT DISTINCT columns.table_name AS "tableName"
         FROM information_schema.columns columns
         JOIN information_schema.tables tables ON tables.table_schema=columns.table_schema
           AND tables.table_name=columns.table_name AND tables.table_type='BASE TABLE'
         WHERE columns.table_schema='public' AND columns.column_name='workspace_id'
         ORDER BY columns.table_name`,
      );
      const tables: Array<{ name: string; rows: unknown[] }> = [];
      let recordCount = 0;
      for (const { tableName } of discovered.rows) {
        if (!SAFE_IDENTIFIER.test(tableName) || EXPORT_EXCLUDED_TABLES.has(tableName)) continue;
        const records = await client.query<{ rows: unknown[] }>(
          `SELECT COALESCE(jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text),'[]'::jsonb) AS rows
           FROM ${tableName} source WHERE workspace_id=$1`, [registry.workspaceId],
        );
        const rows = records.rows[0]?.rows ?? [];
        recordCount += rows.length;
        tables.push({ name: tableName, rows });
      }
      const identity = await client.query(
        `SELECT app_user.id,app_user.primary_email AS "primaryEmail",app_user.display_name AS "displayName",
          app_user.preferred_locale AS "preferredLocale",app_user.preferred_timezone AS "preferredTimezone",app_user.status
         FROM users app_user JOIN workspace_memberships membership ON membership.user_id=app_user.id
         WHERE membership.workspace_id=$1 ORDER BY app_user.id`, [registry.workspaceId],
      );
      const workspace = await client.query(
        `SELECT id,name,slug,status,default_currency AS "defaultCurrency",default_locale AS "defaultLocale",
          default_timezone AS "defaultTimezone",unit_system AS "measurementSystem",week_starts_on AS "weekStart",
          created_at AS "createdAt",updated_at AS "updatedAt" FROM workspaces WHERE id=$1`, [registry.workspaceId],
      );
      const objects = await client.query<{ objectKey: string; byteSize: string; sha256: string | null; source: string }>(
        `WITH objects AS (
           SELECT object_key,byte_size::bigint AS byte_size,sha256::text,'managed'::text AS source
             FROM workspace_stored_objects WHERE workspace_id=$1 AND status='active' AND removed_at IS NULL
           UNION ALL SELECT object_key,COALESCE(byte_size,expected_byte_size)::bigint,NULL,'brand'
             FROM workspace_brand_assets WHERE workspace_id=$1 AND status='active'
           UNION ALL SELECT object_key,byte_size::bigint,sha256::text,'pre_project'
             FROM pre_project_brief_assets WHERE workspace_id=$1
           UNION ALL SELECT preview_key,0::bigint,NULL,'pre_project_preview'
             FROM pre_project_brief_assets WHERE workspace_id=$1 AND preview_key IS NOT NULL
           UNION ALL SELECT object_key,byte_size::bigint,sha256::text,'catalog'
             FROM workspace_catalog_assets WHERE workspace_id=$1 AND status='active'
           UNION ALL SELECT preview_key,0::bigint,NULL,'catalog_preview'
             FROM workspace_catalog_assets WHERE workspace_id=$1 AND status='active' AND preview_key IS NOT NULL
           UNION ALL SELECT object_key,byte_size::bigint,sha256::text,'hrms'
             FROM hrms_captures WHERE workspace_id=$1 AND object_key IS NOT NULL
         ) SELECT DISTINCT ON (object_key) object_key AS "objectKey",byte_size::text AS "byteSize",sha256,source
           FROM objects WHERE object_key IS NOT NULL ORDER BY object_key,source`, [registry.workspaceId],
      );
      const objectManifest = objects.rows.map((object) => ({ ...object, byteSize: Number(object.byteSize) }));
      return {
        schemaVersion: 1,
        scope: "tenant_records_and_object_manifest",
        generatedAt: new Date().toISOString(),
        operationId,
        externalTenantId: registry.externalTenantId,
        workspace: workspace.rows[0],
        identities: identity.rows,
        tables,
        recordCount: recordCount + (identity.rowCount ?? 0) + (workspace.rowCount ?? 0),
        objectManifest,
        objectBytes: objectManifest.reduce((total, object) => total + object.byteSize, 0),
      };
    });
  }

  private async configurationSnapshot(workspaceId: string): Promise<ConfigurationCloneSnapshot> {
    return this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      const setup = await client.query(`SELECT region_code AS "regionCode",region_version AS "regionVersion",
        firm_kit_code AS "firmKitCode",firm_kit_version AS "firmKitVersion",plan_code AS "planCode",
        plan_version AS "planVersion",configuration_snapshot AS "configurationSnapshot"
        FROM workspace_setup_versions WHERE workspace_id=$1`, [workspaceId]);
      const terminology = await client.query(`SELECT key,visible_name AS "visibleName",
        visible_name_plural AS "visibleNamePlural",version FROM workspace_terminology
        WHERE workspace_id=$1 ORDER BY key`, [workspaceId]);
      const workflows = await client.query(`SELECT code,name,description,status,is_default AS "isDefault",version,stages
        FROM project_workflow_templates WHERE workspace_id=$1 ORDER BY code`, [workspaceId]);
      const entitlements = await client.query(`SELECT plan_code AS "planCode",plan_version AS "planVersion",
        status,modules,limits,reason,version FROM effective_workspace_entitlements WHERE workspace_id=$1`, [workspaceId]);
      const dataPolicy = await client.query(`SELECT storage_quota_bytes::text AS "storageQuotaBytes",
        retention_days AS "retentionDays",legal_hold AS "legalHold",scan_requirement AS "scanRequirement",
        scanner_status AS "scannerStatus",export_before_erasure AS "exportBeforeErasure",version
        FROM workspace_data_policies WHERE workspace_id=$1`, [workspaceId]);
      return {
        setup: setup.rows[0] ?? null,
        terminology: terminology.rows,
        workflows: workflows.rows,
        entitlements: entitlements.rows[0] ?? null,
        dataPolicy: dataPolicy.rows[0] ?? null,
      };
    });
  }

  private async applyConfiguration(
    target: Registry,
    desired: ConfigurationCloneSnapshot,
    before: ConfigurationCloneSnapshot,
    operatorUserId: string,
    operationId: string,
    correlationId: string,
  ) {
    return this.database.tenantTransaction(target.workspaceId, operatorUserId, async (client) => {
      if (desired.setup) {
        await client.query(`INSERT INTO workspace_setup_versions
          (workspace_id,region_code,region_version,firm_kit_code,firm_kit_version,plan_code,plan_version,configuration_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
          ON CONFLICT(workspace_id) DO UPDATE SET region_code=excluded.region_code,region_version=excluded.region_version,
            firm_kit_code=excluded.firm_kit_code,firm_kit_version=excluded.firm_kit_version,
            plan_code=excluded.plan_code,plan_version=excluded.plan_version,configuration_snapshot=excluded.configuration_snapshot`,
        [target.workspaceId, desired.setup.regionCode, desired.setup.regionVersion, desired.setup.firmKitCode,
          desired.setup.firmKitVersion, desired.setup.planCode, desired.setup.planVersion,
          JSON.stringify(desired.setup.configurationSnapshot ?? {})]);
      } else {
        await client.query(`DELETE FROM workspace_setup_versions WHERE workspace_id=$1`, [target.workspaceId]);
      }
      await client.query(`DELETE FROM workspace_terminology WHERE workspace_id=$1`, [target.workspaceId]);
      for (const term of desired.terminology) {
        await client.query(`INSERT INTO workspace_terminology
          (workspace_id,key,visible_name,visible_name_plural,version,updated_by)
          VALUES($1,$2,$3,$4,$5,$6)`, [target.workspaceId, term.key, term.visibleName,
          term.visibleNamePlural, term.version, operatorUserId]);
      }
      await client.query(`DELETE FROM project_workflow_templates WHERE workspace_id=$1`, [target.workspaceId]);
      for (const workflow of desired.workflows) {
        await client.query(`INSERT INTO project_workflow_templates
          (workspace_id,code,name,description,status,is_default,version,stages,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)`, [target.workspaceId, workflow.code,
          workflow.name, workflow.description, workflow.status, workflow.isDefault, workflow.version,
          JSON.stringify(workflow.stages), operatorUserId]);
      }
      if (desired.entitlements) {
        await client.query(`INSERT INTO workspace_entitlement_sets
          (workspace_id,plan_code,plan_version,status,modules,limits,reason,version,updated_by)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
          ON CONFLICT(workspace_id) DO UPDATE SET plan_code=excluded.plan_code,plan_version=excluded.plan_version,
            status=excluded.status,modules=excluded.modules,limits=excluded.limits,reason=excluded.reason,
            version=excluded.version,updated_by=excluded.updated_by,updated_at=now()`, [target.workspaceId,
          desired.entitlements.planCode, desired.entitlements.planVersion, desired.entitlements.status,
          JSON.stringify(desired.entitlements.modules), JSON.stringify(desired.entitlements.limits),
          desired.entitlements.reason, desired.entitlements.version, operatorUserId]);
      } else {
        await client.query(`DELETE FROM workspace_entitlement_sets WHERE workspace_id=$1`, [target.workspaceId]);
      }
      if (desired.dataPolicy) {
        await client.query(`INSERT INTO workspace_data_policies
          (workspace_id,storage_quota_bytes,retention_days,legal_hold,scan_requirement,scanner_status,
           export_before_erasure,version,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(workspace_id) DO UPDATE SET storage_quota_bytes=excluded.storage_quota_bytes,
            retention_days=excluded.retention_days,legal_hold=excluded.legal_hold,
            scan_requirement=excluded.scan_requirement,scanner_status=excluded.scanner_status,
            export_before_erasure=excluded.export_before_erasure,version=excluded.version,
            updated_by=excluded.updated_by,updated_at=now()`, [target.workspaceId,
          desired.dataPolicy.storageQuotaBytes, desired.dataPolicy.retentionDays, desired.dataPolicy.legalHold,
          desired.dataPolicy.scanRequirement, desired.dataPolicy.scannerStatus,
          desired.dataPolicy.exportBeforeErasure, desired.dataPolicy.version, operatorUserId]);
      } else {
        await client.query(`DELETE FROM workspace_data_policies WHERE workspace_id=$1`, [target.workspaceId]);
      }
      await client.query(`INSERT INTO audit_events
        (workspace_id,actor_user_id,source,action,entity_type,entity_id,before,after,correlation_id)
        VALUES($1,$2,'internal','tenant.configuration_cloned','tenant_operation',$3,$4::jsonb,$5::jsonb,$6)`,
      [target.workspaceId, operatorUserId, operationId, JSON.stringify(before), JSON.stringify(desired), correlationId]);
    });
  }

  private async snapshot(workspaceId: string) {
    return this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      const usage = await this.usage(client, workspaceId);
      const policy = await client.query<{ legalHold: boolean; exportBeforeErasure: boolean }>(
        `SELECT legal_hold AS "legalHold",export_before_erasure AS "exportBeforeErasure"
         FROM workspace_data_policies WHERE workspace_id=$1`, [workspaceId]);
      return { usage, legalHold: policy.rows[0]?.legalHold ?? false, exportBeforeErasure: policy.rows[0]?.exportBeforeErasure ?? true };
    });
  }

  private async usage(client: PoolClient, workspaceId: string): Promise<TenantUsageSnapshot> {
    const result = await client.query<{
      members: number; pendingInvitations: number; projects: number; knownFileBytes: string; knownFileCount: number;
    }>(`WITH managed AS (
      SELECT object_key,byte_size::bigint AS byte_size FROM workspace_stored_objects
      WHERE workspace_id=$1 AND removed_at IS NULL
        AND (status='active' OR (status='pending' AND reservation_expires_at>now()))
    ), legacy AS (
      SELECT object_key,COALESCE(byte_size,expected_byte_size)::bigint AS byte_size
        FROM workspace_brand_assets WHERE workspace_id=$1 AND status IN ('pending','active')
      UNION ALL SELECT object_key,byte_size::bigint FROM pre_project_brief_assets WHERE workspace_id=$1
      UNION ALL SELECT object_key,byte_size::bigint FROM workspace_catalog_assets WHERE workspace_id=$1 AND status='active'
      UNION ALL SELECT object_key,byte_size::bigint FROM hrms_captures WHERE workspace_id=$1 AND object_key IS NOT NULL
      UNION ALL SELECT 'projects/' || execution.workspace_id || '/' || execution.project_id || '/' || (attachment.value->>'id'),
        COALESCE((attachment.value->>'bytes')::bigint,0)
        FROM project_execution execution
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(execution.content->'files','[]'::jsonb)) AS attachment(value)
        WHERE execution.workspace_id=$1
    ), files AS (
      SELECT object_key,byte_size FROM managed
      UNION ALL
      SELECT legacy.object_key,legacy.byte_size FROM legacy
      WHERE NOT EXISTS (SELECT 1 FROM managed WHERE managed.object_key=legacy.object_key)
    ) SELECT
      (SELECT count(*)::int FROM workspace_memberships WHERE workspace_id=$1 AND status='active') AS members,
      (SELECT count(*)::int FROM workspace_invitations WHERE workspace_id=$1 AND status='pending' AND expires_at>now()) AS "pendingInvitations",
      (SELECT count(*)::int FROM delivery_projects WHERE workspace_id=$1) AS projects,
      COALESCE((SELECT sum(byte_size)::text FROM files),'0') AS "knownFileBytes",
      (SELECT count(*)::int FROM files) AS "knownFileCount"`, [workspaceId]);
    const row = result.rows[0];
    return { members: row.members, pendingInvitations: row.pendingInvitations, projects: row.projects,
      knownFileBytes: Number(row.knownFileBytes), knownFileCount: row.knownFileCount };
  }

  private registry(externalTenantId: string): Promise<Registry> {
    return resolveTenantRegistry(this.database, externalTenantId);
  }

  private async registryByWorkspace(workspaceId: string): Promise<Registry> {
    const found = await this.database.query<Registry>(`SELECT external_tenant_id AS "externalTenantId",workspace_id AS "workspaceId"
      FROM tenant_provisioning_requests WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1`, [workspaceId]);
    if (!found.rowCount) throw new NotFoundException("Target client was not found");
    return found.rows[0];
  }

  private expireProjection(row: Record<string, unknown>) {
    if (["requested", "active"].includes(String(row.status)) && new Date(String(row.expiresAt)).getTime() <= Date.now()) {
      return { ...row, status: "expired" };
    }
    return row;
  }

  private correlation(value?: string) {
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : randomUUID();
  }

  private async audit(client: PoolClient, registry: Registry, operatorUserId: string, action: string,
    entityType: string, entityId: string, before: unknown, after: unknown, correlationId?: string) {
    const correlation = this.correlation(correlationId);
    await client.query(`INSERT INTO audit_events
      (workspace_id,actor_user_id,source,action,entity_type,entity_id,before,after,correlation_id)
      VALUES($1,$2,'internal',$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [registry.workspaceId, operatorUserId, action, entityType, entityId,
      JSON.stringify(before), JSON.stringify(after), correlation]);
    await this.operatorAudit(client, operatorUserId, action, registry.externalTenantId, correlation,
      { workspaceId: registry.workspaceId, entityType, entityId });
  }

  private operatorAudit(client: PoolClient, actorUserId: string, action: string, targetId: string, correlationId: string,
    details: Record<string, unknown>) {
    return client.query(`INSERT INTO platform_operator_audit
      (actor_user_id,action,target_type,target_id,correlation_id,details)
      VALUES($1,$2,'tenant',$3,$4,$5::jsonb)`, [actorUserId, action, targetId, correlationId, JSON.stringify(details)]);
  }
}
