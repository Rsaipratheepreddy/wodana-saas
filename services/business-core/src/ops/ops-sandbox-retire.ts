import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatabaseService } from "../database/database.service";
import { OpsError } from "./ops-context";

/**
 * Retiring a sandbox (`sandbox --slug <slug> --retire`, ops-sandbox.ts) and bringing it back (`--restore`).
 *
 * Wodana deletes no organization (erasure is only a plan), so a sandbox that is no longer wanted is retired: it rests,
 * with everything it holds. This is the one path, and it is narrow: only the operator CLI's sandbox command calls it,
 * only for a sandbox the command made, and only after the caller checked that the command made every organization of
 * the sandbox's customer account (the first one and those added with --organization-of). In one transaction, so a run
 * that stops part-way changes nothing:
 *
 *  - each organization is archived (workspaces.status, archived_at): nobody signs in to it, its login address answers
 *    as an unknown one does, it leaves the organization switcher, and every scheduler and worker skips it (0308).
 *  - the email, WhatsApp, push and webhook notifications still waiting for it are suppressed (reason sandbox_retired)
 *    and its queued outbox events are marked handled, never published. In-app notices stay; open support sessions end.
 *  - it leaves Wodana's billing: its subscription is cancelled and an active billing allocation ends; the account's
 *    collection state is closed and the account archived, so Wodana Control records no usage snapshot, billing
 *    document, contract or allocation for it while it rests (tenant-operations.service.ts).
 *  - the audit: sandbox.retired in each organization and sandbox.account_retired (with the collection state's own
 *    account.collection_state_versioned) in the first, and a platform operator audit row for each; all marked via
 *    operator_cli.
 *
 * Restoring undoes exactly that: organizations and account active, the collection state and allocations back to the
 * versions before the retirement (new versions; history is never rewritten), each subscription back to the status it
 * had. Suppressed messages stay suppressed. An organization archived through Wodana Control's lifecycle (a final
 * decision) is never restored here. Without `apply`, the same checks and counts, and nothing is written.
 */

/** The suppression reason of a message waiting for a retired organization. */
export const SANDBOX_RETIRED = "sandbox_retired";
/** What a queued outbox event of a retired organization records instead of being published. */
const OUTBOX_NOTE = `suppressed: ${SANDBOX_RETIRED} (never published)`;
/** The reason on the billing versions the retirement writes; a restore reverts only versions with it. */
export const RETIRE_REASON = "Sandbox retired with the operator CLI: no billing, usage or invoices while it rests.";
const RESTORE_REASON = "Sandbox restored with the operator CLI: billing as it was before it was retired.";
const WAITING = ["pending", "scheduled", "processing"];

export type SandboxLifecycleAction = "retire" | "restore";
export type SandboxLifecycleInput = {
  action: SandboxLifecycleAction;
  sandbox: { slug: string; accountId: string; ownerUserId: string };
  /** Every organization in the sandbox's customer account; the caller has checked the sandbox command made each one. */
  organizationIds: string[];
  apply: boolean;
};
type Change = { from: string | null; to: string | null };
export type OrganizationLifecycle = {
  workspaceId: string; slug: string; name: string;
  status: Change; subscription: Change; allocation: Change | null;
  /** Messages suppressed now, by channel (retire). */
  deliveries: Record<string, number>;
  outboxHandled: number; supportSessionsEnded: number;
  /** The AI credit balance the organization keeps (null: it never used AI). */
  aiCredits: string | null;
};
export type SandboxLifecycleResult = {
  account: {
    externalId: string | null; status: Change; collection: Change;
    contract: { status: string; plan: string } | null;
    billingDocuments: { total: number; open: number }; usageSnapshots: number;
  };
  organizations: OrganizationLifecycle[];
  changed: boolean;
};

class DryRun extends Error {
  constructor(readonly result: SandboxLifecycleResult) { super("dry run"); }
}

export async function changeSandboxLifecycle(database: DatabaseService, input: SandboxLifecycleInput): Promise<SandboxLifecycleResult> {
  try {
    return await database.transaction(async (client) => {
      const result = await run(client, input);
      // A dry run counts under the same locks, then rolls everything back.
      if (!input.apply) throw new DryRun(result);
      return result;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.result;
    throw error;
  }
}

type AccountRow = { status: string; externalId: string | null };
type WorkspaceRow = { name: string; slug: string; status: string; currency: string };
type CollectionRow = { version: number; status: string; overdue: string; currency: string; nextReviewAt: Date | null; reason: string };
type AllocationRow = {
  version: number; status: string; contractVersionId: string | null; amount: string; seats: number; projects: number; reason: string;
};

async function run(client: PoolClient, input: SandboxLifecycleInput): Promise<SandboxLifecycleResult> {
  const retire = input.action === "retire";
  const correlationId = randomUUID();
  const { accountId, slug, ownerUserId } = input.sandbox;
  const account = (await client.query<AccountRow>(
    `SELECT status, external_customer_id AS "externalId" FROM customer_accounts WHERE id = $1 FOR UPDATE`, [accountId])).rows[0];
  if (!account) throw new OpsError(`The account of sandbox ${slug} was not found. Nothing was changed.`);
  if (account.status === "suspended") throw new OpsError(`The account of sandbox ${slug} is suspended in Wodana Control; decide that there first. Nothing was changed.`);
  // Under the account's lock: its organizations are the ones the caller checked.
  const linked = (await client.query<{ workspaceId: string }>(
    `SELECT workspace_id AS "workspaceId" FROM customer_account_organizations WHERE account_id = $1 ORDER BY is_default DESC, workspace_id`,
    [accountId])).rows.map((row) => row.workspaceId);
  if (linked.length !== input.organizationIds.length || linked.some((id) => !input.organizationIds.includes(id)))
    throw new OpsError(`The organizations of sandbox ${slug} changed while this ran; run it again. Nothing was changed.`);

  const organizations: OrganizationLifecycle[] = [];
  let firstCurrency = "";
  for (const workspaceId of linked) {
    await tenant(client, workspaceId);
    const workspace = (await client.query<WorkspaceRow>(
      `SELECT name, slug, status::text AS status, default_currency AS currency FROM workspaces WHERE id = $1 FOR UPDATE`, [workspaceId])).rows[0];
    if (!workspace) throw new OpsError(`An organization of sandbox ${slug} was not found. Nothing was changed.`);
    firstCurrency ||= workspace.currency.trim();
    organizations.push(retire ? await retireOrganization(client, workspaceId, workspace, input, correlationId)
      : await restoreOrganization(client, workspaceId, workspace, input, correlationId));
  }

  // ---------- the account ----------
  // Its collection state, contract and billing documents are read as its first organization (linked_organization_access).
  await tenant(client, linked[0]);
  const collection = (await client.query<CollectionRow>(
    `SELECT version, status, overdue_amount::text AS overdue, currency, next_review_at AS "nextReviewAt", reason
       FROM account_collection_state_versions WHERE account_id = $1 ORDER BY version DESC LIMIT 2 FOR UPDATE`, [accountId])).rows;
  const contract = (await client.query<{ status: string; plan: string; currency: string }>(
    `SELECT status, plan_code || ' v' || plan_version AS plan, currency FROM customer_account_contracts WHERE account_id = $1`, [accountId])).rows[0] ?? null;
  const collectionChange: Change = { from: collection[0]?.status ?? null, to: collection[0]?.status ?? null };
  if (retire && collection[0]?.status !== "closed") {
    // Closed: billing ends for the account (the control-plane sweep never moves a closed account to grace).
    const saved = await versionCollection(client, accountId, {
      version: (collection[0]?.version ?? 0) + 1, status: "closed", overdue: collection[0]?.overdue ?? "0",
      currency: collection[0]?.currency ?? contract?.currency ?? firstCurrency, nextReviewAt: null, reason: RETIRE_REASON,
    }, ownerUserId);
    collectionChange.to = "closed";
    await audit(client, linked[0], "account.collection_state_versioned", "account_collection", accountId, collection[0] ?? null, saved, correlationId);
  } else if (!retire && collection[0]?.status === "closed" && collection[0].reason === RETIRE_REASON) {
    // Back to the version before the retirement (current, with nothing overdue, when there was none).
    const before = collection[1];
    const review = before?.nextReviewAt && before.nextReviewAt.getTime() > Date.now() ? before.nextReviewAt : null;
    const saved = await versionCollection(client, accountId, {
      version: collection[0].version + 1, status: before?.status ?? "current", overdue: before ? before.overdue : "0",
      currency: before?.currency ?? collection[0].currency, nextReviewAt: review, reason: RESTORE_REASON,
    }, ownerUserId);
    collectionChange.to = saved.status;
    await audit(client, linked[0], "account.collection_state_versioned", "account_collection", accountId, collection[0], saved, correlationId);
  }
  const documents = (await client.query<{ total: number; open: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('draft', 'issued', 'past_due'))::int AS open
       FROM account_billing_documents WHERE account_id = $1`, [accountId])).rows[0];
  const snapshots = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM account_usage_snapshots WHERE account_id = $1`, [accountId])).rows[0];

  const accountStatus: Change = { from: account.status, to: account.status };
  const wanted = retire ? "archived" : "active";
  if (account.status !== wanted) {
    await client.query(`UPDATE customer_accounts SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`, [accountId, wanted]);
    accountStatus.to = wanted;
    const action = retire ? "sandbox.account_retired" : "sandbox.account_restored";
    await audit(client, linked[0], action, "customer_account", accountId, { status: account.status, collection: collectionChange.from },
      { status: wanted, collection: collectionChange.to, sandbox: slug, organizations: linked.length }, correlationId);
    await operatorAudit(client, linked[0], action, correlationId, { accountId, sandbox: slug, status: accountStatus, collection: collectionChange });
  }

  const changed = accountStatus.from !== accountStatus.to || collectionChange.from !== collectionChange.to
    || organizations.some((organization) => organization.status.from !== organization.status.to || organization.subscription.from !== organization.subscription.to
      || (organization.allocation !== null && organization.allocation.from !== organization.allocation.to)
      || Object.keys(organization.deliveries).length > 0 || organization.outboxHandled > 0 || organization.supportSessionsEnded > 0);
  return {
    account: { externalId: account.externalId, status: accountStatus, collection: collectionChange, contract: contract ? { status: contract.status, plan: contract.plan } : null,
      billingDocuments: documents, usageSnapshots: snapshots.count },
    organizations, changed,
  };
}

async function retireOrganization(client: PoolClient, workspaceId: string, workspace: WorkspaceRow, input: SandboxLifecycleInput,
  correlationId: string): Promise<OrganizationLifecycle> {
  if (workspace.status === "suspended")
    throw new OpsError(`The organization ${workspace.slug} is suspended in Wodana Control; decide that there first. Nothing was changed.`);
  // Messages still waiting: never sent. In-app notices deliver nothing outside Wodana and stay.
  const deliveries: Record<string, number> = {};
  for (const row of (await client.query<{ channel: string; count: number }>(
    `WITH suppressed AS (
       UPDATE notifications SET status = 'suppressed', suppressed_reason = $2, processing_started_at = NULL, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND channel <> 'in_app' AND status = ANY($3::notification_status[])
       RETURNING channel)
     SELECT channel, count(*)::int AS count FROM suppressed GROUP BY channel ORDER BY channel`, [workspaceId, SANDBOX_RETIRED, WAITING])).rows) {
    deliveries[row.channel] = row.count;
  }
  // Events still queued for the publisher: handled, never published (an archived organization's are not claimed, 0308).
  const outbox = await client.query(
    `UPDATE outbox_events SET status = 'published', published_at = now(), last_error = $2, claimed_at = NULL, claim_token = NULL
      WHERE workspace_id = $1 AND status IN ('pending', 'failed') AND attempts < 20`, [workspaceId, OUTBOX_NOTE]);
  // As an archived organization in Wodana Control: support access ends.
  const support = await client.query(
    `UPDATE tenant_support_sessions SET status = 'revoked', end_reason = 'tenant_archived', ended_at = now(), version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND status IN ('requested', 'approved', 'active')`, [workspaceId]);

  // Out of billing: the subscription is cancelled and an allocation still in force ends.
  const subscription = (await client.query<{ status: string }>(`SELECT status FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0];
  const subscriptionChange: Change = { from: subscription?.status ?? null, to: subscription?.status ?? null };
  if (subscription && subscription.status !== "cancelled") {
    await client.query(`UPDATE workspace_subscriptions SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1`, [workspaceId]);
    subscriptionChange.to = "cancelled";
  }
  const allocations = await latestAllocations(client, workspaceId);
  const effective = (await client.query<{ status: string }>(`SELECT status FROM effective_organization_billing_allocations WHERE workspace_id = $1`, [workspaceId])).rows[0];
  let allocationChange: Change | null = effective ? { from: effective.status, to: effective.status } : null;
  if (allocations[0] && effective && effective.status !== "ended") {
    await versionAllocation(client, workspaceId, allocations[0], "ended", RETIRE_REASON, input.sandbox.ownerUserId);
    allocationChange = { from: effective.status, to: "ended" };
  }
  const aiCredits = (await client.query<{ balance: string }>(`SELECT balance::text AS balance FROM ai_credit_accounts WHERE workspace_id = $1`, [workspaceId])).rows[0]?.balance ?? null;

  const status: Change = { from: workspace.status, to: workspace.status };
  if (workspace.status !== "archived") {
    await client.query(`UPDATE workspaces SET status = 'archived', archived_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [workspaceId]);
    status.to = "archived";
  }
  const outcome: OrganizationLifecycle = { workspaceId, slug: workspace.slug, name: workspace.name, status, subscription: subscriptionChange,
    allocation: allocationChange, deliveries, outboxHandled: outbox.rowCount ?? 0, supportSessionsEnded: support.rowCount ?? 0, aiCredits };
  if (touched(outcome)) {
    const before = { status: workspace.status, subscription: subscriptionChange.from, allocation: allocationChange?.from ?? null };
    const after = { status: status.to, subscription: subscriptionChange.to, allocation: allocationChange?.to ?? null, reason: SANDBOX_RETIRED, sandbox: input.sandbox.slug,
      deliveriesSuppressed: deliveries, outboxHandled: outcome.outboxHandled, supportSessionsEnded: outcome.supportSessionsEnded };
    await audit(client, workspaceId, "sandbox.retired", "workspace", workspaceId, before, after, correlationId);
    await operatorAudit(client, workspaceId, "sandbox.retired", correlationId, { workspaceId, sandbox: input.sandbox.slug, before, after });
  }
  return outcome;
}

async function restoreOrganization(client: PoolClient, workspaceId: string, workspace: WorkspaceRow, input: SandboxLifecycleInput,
  correlationId: string): Promise<OrganizationLifecycle> {
  const outcome: OrganizationLifecycle = { workspaceId, slug: workspace.slug, name: workspace.name, status: { from: workspace.status, to: workspace.status },
    subscription: { from: null, to: null }, allocation: null, deliveries: {}, outboxHandled: 0, supportSessionsEnded: 0, aiCredits: null };
  const subscription = (await client.query<{ status: string }>(`SELECT status FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0];
  outcome.subscription = { from: subscription?.status ?? null, to: subscription?.status ?? null };
  if (workspace.status !== "archived") return outcome;
  // Wodana Control's lifecycle archive is a final decision with its own export and retention checks: never undone here.
  const lifecycle = (await client.query<{ state: string }>(
    `SELECT state FROM tenant_lifecycle_versions WHERE workspace_id = $1 ORDER BY version DESC LIMIT 1`, [workspaceId])).rows[0];
  if (lifecycle?.state === "archived")
    throw new OpsError(`The organization ${workspace.slug} was archived in Wodana Control, not retired by this command; it stays archived. Nothing was changed.`);
  // What the retirement changed, as its audit recorded it.
  const retired = (await client.query<{ before: { subscription?: string | null } }>(
    `SELECT before FROM audit_events WHERE workspace_id = $1 AND action = 'sandbox.retired' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [workspaceId])).rows[0];

  await client.query(`UPDATE workspaces SET status = 'active', archived_at = NULL, version = version + 1, updated_at = now() WHERE id = $1`, [workspaceId]);
  outcome.status.to = "active";
  const previous = retired?.before.subscription;
  if (subscription && subscription.status === "cancelled" && previous && previous !== "cancelled") {
    await client.query(`UPDATE workspace_subscriptions SET status = $2, version = version + 1, updated_at = now() WHERE workspace_id = $1`, [workspaceId, previous]);
    outcome.subscription.to = previous;
  }
  const allocations = await latestAllocations(client, workspaceId);
  if (allocations[0]?.status === "ended" && allocations[0].reason === RETIRE_REASON && allocations[1]) {
    const back = allocations[1].status === "scheduled" ? "active" : allocations[1].status;
    await versionAllocation(client, workspaceId, allocations[1], back, RESTORE_REASON, input.sandbox.ownerUserId, allocations[0].version + 1);
    outcome.allocation = { from: "ended", to: back };
  }
  const before = { status: "archived", subscription: outcome.subscription.from, allocation: outcome.allocation?.from ?? null };
  const after = { status: "active", subscription: outcome.subscription.to, allocation: outcome.allocation?.to ?? null, sandbox: input.sandbox.slug };
  await audit(client, workspaceId, "sandbox.restored", "workspace", workspaceId, before, after, correlationId);
  await operatorAudit(client, workspaceId, "sandbox.restored", correlationId, { workspaceId, sandbox: input.sandbox.slug, before, after });
  return outcome;
}

const touched = (outcome: OrganizationLifecycle) => outcome.status.from !== outcome.status.to || outcome.subscription.from !== outcome.subscription.to
  || (outcome.allocation !== null && outcome.allocation.from !== outcome.allocation.to) || Object.keys(outcome.deliveries).length > 0
  || outcome.outboxHandled > 0 || outcome.supportSessionsEnded > 0;

async function tenant(client: PoolClient, workspaceId: string) {
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
}

async function latestAllocations(client: PoolClient, workspaceId: string): Promise<AllocationRow[]> {
  return (await client.query<AllocationRow>(
    `SELECT version, status, account_contract_version_id AS "contractVersionId", allocated_amount::text AS amount, seat_limit AS seats,
            project_limit AS projects, reason
       FROM organization_billing_allocation_versions WHERE workspace_id = $1 ORDER BY version DESC LIMIT 2 FOR UPDATE`, [workspaceId])).rows;
}

/** A new allocation version with the same amounts and limits, in force from now. */
async function versionAllocation(client: PoolClient, workspaceId: string, from: AllocationRow, status: string, reason: string, createdBy: string,
  version = from.version + 1) {
  await client.query(
    `INSERT INTO organization_billing_allocation_versions
       (workspace_id, account_contract_version_id, version, status, allocated_amount, seat_limit, project_limit, effective_from, effective_until, reason, created_by)
     VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, now(), NULL, $8, $9)`,
    [workspaceId, from.contractVersionId, version, status, from.amount, from.seats, from.projects, reason, createdBy]);
}

async function versionCollection(client: PoolClient, accountId: string, row: Omit<CollectionRow, "nextReviewAt"> & { nextReviewAt: Date | null }, createdBy: string) {
  return (await client.query<{ id: string; version: number; status: string; overdueAmount: string; currency: string }>(
    `INSERT INTO account_collection_state_versions (account_id, version, status, overdue_amount, currency, effective_at, next_review_at, reason, created_by)
     VALUES ($1, $2, $3, $4::numeric, $5, now(), $6, $7, $8)
     RETURNING id, version, status, overdue_amount::text AS "overdueAmount", currency`,
    [accountId, row.version, row.status, row.overdue, row.currency, row.nextReviewAt, row.reason, createdBy])).rows[0];
}

async function audit(client: PoolClient, workspaceId: string, action: string, entityType: string, entityId: string,
  before: unknown, after: unknown, correlationId: string) {
  await tenant(client, workspaceId);
  await client.query(
    `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
     VALUES ($1, NULL, 'internal', $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [workspaceId, action, entityType, entityId, JSON.stringify(before ?? {}), JSON.stringify(after ?? {}), correlationId]);
}

/** Wodana Control's own trail, addressed as Wodana Control addresses the organization (its provisioning id, else its id). */
async function operatorAudit(client: PoolClient, workspaceId: string, action: string, correlationId: string, details: Record<string, unknown>) {
  await client.query(
    `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
     VALUES (NULL, $1, 'tenant', COALESCE((SELECT external_tenant_id FROM tenant_provisioning_requests WHERE workspace_id = $2 ORDER BY created_at DESC LIMIT 1), $2::text),
             $3, $4::jsonb)`,
    [action, workspaceId, correlationId, JSON.stringify({ ...details, via: "operator_cli" })]);
}

// ---------- adopting a retired sandbox's people ----------

export type AdoptionVerdict = { adoptable: true; from: string[]; hasPassword: boolean } | { adoptable: false; reason: string };

/**
 * Whether each person may become a test member of a new sandbox (`sandbox --email-pattern` whose addresses they hold):
 * only someone who was a test member of a retired sandbox and has nothing else in Wodana. That is: an active user, not
 * a Wodana operator, with at least one membership in an organization of a retired sandbox account (archived, made by
 * the sandbox command) and whose every active membership, and every active customer-account membership, is in such an
 * account. Anyone else keeps their address to themselves. With the retired sandboxes' slugs and whether the person has
 * a password (an adopted person keeps theirs).
 */
export async function adoptionVerdicts(database: DatabaseService, userIds: string[]): Promise<Map<string, AdoptionVerdict>> {
  const verdicts = new Map<string, AdoptionVerdict>();
  for (const userId of userIds) {
    verdicts.set(userId, await database.transaction(async (client) => {
      const user = (await client.query<{ status: string; operator: boolean; hasPassword: boolean }>(
        `SELECT person.status, EXISTS (SELECT 1 FROM platform_administrators operator WHERE operator.user_id = person.id) AS operator,
                EXISTS (SELECT 1 FROM local_auth_credentials credential
                         JOIN user_identities identity ON identity.user_id = credential.user_id AND identity.provider = 'local'
                        WHERE credential.user_id = person.id) AS "hasPassword"
           FROM users person WHERE person.id = $1`, [userId])).rows[0];
      if (!user || user.status !== "active") return { adoptable: false, reason: "not an active user" };
      if (user.operator) return { adoptable: false, reason: "a Wodana operator" };
      // The person's own memberships, as they would see them (membership_self_discovery, workspace_self_discovery).
      await client.query("SELECT set_config('app.current_workspace_id', '', true), set_config('app.current_actor_id', $1, true)", [userId]);
      const memberships = (await client.query<{ workspaceId: string; status: string }>(
        `SELECT workspace_id AS "workspaceId", status::text AS status FROM workspace_memberships WHERE user_id = $1`, [userId])).rows;
      const organizations = await retiredSandboxOrganizations(client, memberships.map((membership) => membership.workspaceId));
      const active = memberships.filter((membership) => membership.status === "active");
      const live = active.filter((membership) => !organizations.get(membership.workspaceId)?.retired);
      if (live.length) {
        const slugs = live.map((membership) => organizations.get(membership.workspaceId)?.slug ?? "another organization");
        return { adoptable: false, reason: `an active member of ${[...new Set(slugs)].sort().join(", ")}` };
      }
      const accounts = (await client.query<{ accountId: string; retired: boolean }>(
        `SELECT membership.account_id AS "accountId",
                (account.status = 'archived' AND account.external_customer_id LIKE 'sandbox-%') AS retired
           FROM customer_account_memberships membership JOIN customer_accounts account ON account.id = membership.account_id
          WHERE membership.user_id = $1 AND membership.status = 'active'`, [userId])).rows;
      if (accounts.some((account) => !account.retired)) return { adoptable: false, reason: "in a customer account that is not a retired sandbox's" };
      const from = [...new Set([...organizations.values()].filter((organization) => organization.retired).map((organization) => organization.sandbox))].sort();
      if (!from.length) return { adoptable: false, reason: "not a test member of a retired sandbox" };
      return { adoptable: true, from, hasPassword: user.hasPassword };
    }));
  }
  return verdicts;
}

/**
 * The organizations given, with their slug and whether each is an archived organization of a retired sandbox account
 * (archived, external id sandbox-<slug>) that the sandbox command made: the account's first organization or one its
 * test owner requested through the command (sandbox-organization:<slug>) and that was approved.
 */
async function retiredSandboxOrganizations(client: PoolClient, workspaceIds: string[]) {
  const rows = (await client.query<{ workspaceId: string; slug: string | null; sandbox: string | null; retired: boolean }>(
    `SELECT target.id AS "workspaceId", branding.login_slug AS slug, substr(account.external_customer_id, 9) AS sandbox,
            COALESCE(account.status = 'archived' AND account.external_customer_id LIKE 'sandbox-%'
             AND (EXISTS (SELECT 1 FROM tenant_provisioning_requests provisioned
                           WHERE provisioned.workspace_id = target.id AND provisioned.external_tenant_id = account.external_customer_id)
                  OR EXISTS (SELECT 1 FROM organization_requests request
                              WHERE request.approved_workspace_id = target.id AND request.account_id = account.id AND request.status = 'approved'
                                AND request.idempotency_key LIKE 'sandbox-organization:%' AND request.requested_by = account.created_by)), false) AS retired
       FROM unnest($1::uuid[]) AS target (id)
       LEFT JOIN customer_account_organizations linked ON linked.workspace_id = target.id
       LEFT JOIN customer_accounts account ON account.id = linked.account_id
       LEFT JOIN tenant_login_branding branding ON branding.workspace_id = target.id`, [workspaceIds])).rows;
  // The organization itself archived too (workspace_self_discovery shows the person's own organizations).
  const archived = new Set((await client.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE id = ANY($1::uuid[]) AND status = 'archived'`, [workspaceIds])).rows.map((row) => row.id));
  return new Map(rows.map((row) => [row.workspaceId, { slug: row.slug ?? row.workspaceId, sandbox: row.sandbox ?? "", retired: row.retired && archived.has(row.workspaceId) }]));
}
