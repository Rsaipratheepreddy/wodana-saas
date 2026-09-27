import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BASE_DOMAIN } from "../workspaces/domain-policy";
import { tenantLifecycleBaseline, type TenantLifecycleState } from "../workspaces/tenant-lifecycle.domain";
import { accountState, seatPosition } from "./control-plane.domain";

type DirectoryRow = {
  account_id: string; account_name: string; account_status: string; external_customer_id: string | null;
  contract_contact_email: string | null; organization_limit: number;
  workspace_id: string; external_tenant_id: string | null; organization_name: string; slug: string;
  workspace_status: string; is_default: boolean; lifecycle_state: TenantLifecycleState | null; lifecycle_version: number | null;
  grace_ends_at: Date | null; onboarding_status: string | null; subscription_status: string | null;
  plan_code: string | null; plan_version: number | null; seat_limit: number | null;
  active_members: number; invited_members: number; pending_invitations: number;
  owner_email: string | null; owner_invitation_status: string | null; owner_delivery_status: string | null;
  last_activity_at: Date | null; created_at: Date;
  open_support: boolean; domain_attention: boolean; payment_past_due: boolean;
};

export type AttentionReason = "payment_past_due" | "grace" | "suspended" | "domain" | "support_open"
  | "owner_invitation" | "over_seats";

const RESERVED_SLUGS = new Set(["admin", "api", "app", "auth", "internal", "login", "mail", "status", "support", "www", "workspace"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function organization(row: DirectoryRow) {
  const state = row.lifecycle_state ?? tenantLifecycleBaseline({
    workspaceStatus: row.workspace_status, onboardingStatus: row.onboarding_status, subscriptionStatus: row.subscription_status,
  });
  const seats = seatPosition({ limit: row.seat_limit, activeMembers: row.active_members,
    invitedMembers: row.invited_members, pendingInvitations: row.pending_invitations });
  const attention: AttentionReason[] = [];
  if (row.payment_past_due) attention.push("payment_past_due");
  if (state === "grace") attention.push("grace");
  if (state === "suspended") attention.push("suspended");
  if (row.domain_attention) attention.push("domain");
  if (row.open_support) attention.push("support_open");
  if (row.owner_invitation_status === "expired" || row.owner_delivery_status === "failed") attention.push("owner_invitation");
  if (seats.overLimit) attention.push("over_seats");
  return {
    workspaceId: row.workspace_id,
    key: row.external_tenant_id ?? row.workspace_id,
    externalTenantId: row.external_tenant_id,
    name: row.organization_name,
    slug: row.slug,
    address: `${row.slug}.${BASE_DOMAIN}`,
    isDefault: row.is_default,
    state,
    lifecycleVersion: row.lifecycle_version ?? 0,
    graceEndsAt: row.grace_ends_at,
    onboardingStatus: row.onboarding_status,
    plan: row.plan_code ? { code: row.plan_code, version: row.plan_version } : null,
    seats,
    owner: { email: row.owner_email, invitationStatus: row.owner_invitation_status, deliveryStatus: row.owner_delivery_status },
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    attention,
  };
}

/**
 * The accounts list and the account header (§6.1 screens). Reads control facts across tenants through the
 * operator-only `control_plane_directory()`; tenant business records are never read here.
 */
@Injectable()
export class AccountDirectoryService {
  constructor(private readonly database: DatabaseService) {}

  async list(operatorUserId: string, filter: { search?: string; state?: string }) {
    const rows = await this.directory(operatorUserId);
    const accounts = this.group(rows);
    const search = filter.search?.trim().toLowerCase() ?? "";
    const visible = accounts.filter((account) => {
      if (filter.state && account.state !== filter.state) return false;
      if (!search) return true;
      return [account.name, account.externalCustomerId ?? "", account.contactEmail ?? "",
        ...account.organizations.flatMap((org) => [org.name, org.slug, org.owner.email ?? "", org.externalTenantId ?? ""])]
        .some((value) => value.toLowerCase().includes(search));
    });
    const counts = accounts.reduce<Record<string, number>>((all, account) => {
      all[account.state] = (all[account.state] ?? 0) + 1;
      return all;
    }, {});
    return { accounts: visible, total: accounts.length, counts, observedAt: new Date().toISOString() };
  }

  async detail(operatorUserId: string, accountId: string) {
    const account = this.group(await this.directory(operatorUserId)).find((item) => item.id === accountId);
    if (!account) throw new NotFoundException("Account was not found");
    return { ...account, observedAt: new Date().toISOString() };
  }

  /** Control-plane actions on the account's organizations (who, what, when), newest first. */
  async activity(operatorUserId: string, accountId: string) {
    const account = await this.detail(operatorUserId, accountId);
    const targets = account.organizations.flatMap((org) => [org.workspaceId, ...(org.externalTenantId ? [org.externalTenantId] : [])]);
    const workspaceIds = account.organizations.map((org) => org.workspaceId);
    const events = await this.database.query<{ id: string; action: string; actorName: string | null; actorEmail: string | null;
      targetId: string | null; details: Record<string, unknown>; createdAt: Date }>(
      `SELECT audit.id, audit.action, app_user.display_name AS "actorName", app_user.primary_email AS "actorEmail",
              audit.target_id AS "targetId", audit.details, audit.created_at AS "createdAt"
         FROM platform_operator_audit audit
         LEFT JOIN users app_user ON app_user.id = audit.actor_user_id
        WHERE audit.target_id = ANY($1::text[]) OR audit.details->>'workspaceId' = ANY($2::text[])
        ORDER BY audit.created_at DESC LIMIT 200`, [targets, workspaceIds],
    );
    const names = new Map(account.organizations.map((org) => [org.workspaceId, org.name]));
    const byKey = new Map(account.organizations.flatMap((org) => org.externalTenantId ? [[org.externalTenantId, org.workspaceId]] : []));
    return {
      events: events.rows.map((event) => {
        const workspaceId = String(event.details.workspaceId ?? byKey.get(event.targetId ?? "") ?? event.targetId ?? "");
        return { id: event.id, action: event.action, actorName: event.actorName, actorEmail: event.actorEmail,
          workspaceId, organizationName: names.get(workspaceId) ?? null, createdAt: event.createdAt,
          reason: typeof event.details.reason === "string" ? event.details.reason
            : typeof (event.details.after as Record<string, unknown> | undefined)?.reason === "string"
              ? String((event.details.after as Record<string, unknown>).reason) : null };
      }),
    };
  }

  /** Whether a login address is free, with a free alternative when it is not. */
  async slugAvailability(input: string) {
    const slug = input.trim().toLowerCase();
    if (!slug || slug.length > 70 || !SLUG.test(slug)) throw new BadRequestException("Use lowercase letters, numbers and single hyphens.");
    const taken = async (candidate: string) => {
      if (RESERVED_SLUGS.has(candidate)) return true;
      const found = await this.database.query<{ taken: boolean }>(
        `SELECT wodana_internal_slug_taken($1::varchar) OR EXISTS (
           SELECT 1 FROM tenant_provisioning_drafts WHERE slug = $1
              AND status IN ('draft', 'provisioning', 'failed', 'provisioned')
              AND (status IN ('provisioning', 'provisioned') OR reservation_expires_at > now())
         ) AS taken`, [candidate]);
      return Boolean(found.rows[0]?.taken);
    };
    if (!await taken(slug)) return { slug, available: true, suggestion: null, address: `${slug}.${BASE_DOMAIN}` };
    for (let suffix = 2; suffix < 50; suffix += 1) {
      const candidate = `${slug.slice(0, 66)}-${suffix}`;
      if (!await taken(candidate)) return { slug, available: false, suggestion: candidate, address: `${slug}.${BASE_DOMAIN}` };
    }
    return { slug, available: false, suggestion: null, address: `${slug}.${BASE_DOMAIN}` };
  }

  private async directory(operatorUserId: string) {
    const result = await this.database.actorTransaction(operatorUserId, (client) =>
      client.query<DirectoryRow>("SELECT * FROM control_plane_directory()"));
    return result.rows;
  }

  private group(rows: DirectoryRow[]) {
    const accounts = new Map<string, { row: DirectoryRow; organizations: ReturnType<typeof organization>[] }>();
    for (const row of rows) {
      const entry = accounts.get(row.account_id) ?? { row, organizations: [] };
      entry.organizations.push(organization(row));
      accounts.set(row.account_id, entry);
    }
    return [...accounts.values()].map(({ row, organizations }) => {
      organizations.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name));
      const limits = organizations.map((org) => org.seats.limit);
      return {
        id: row.account_id,
        name: row.account_name,
        status: row.account_status,
        externalCustomerId: row.external_customer_id,
        contactEmail: row.contract_contact_email,
        organizationLimit: row.organization_limit,
        state: accountState(organizations.map((org) => org.state)),
        plan: organizations.find((org) => org.plan)?.plan ?? null,
        seats: {
          members: organizations.reduce((sum, org) => sum + org.seats.members, 0),
          limit: limits.some((limit) => limit === null) ? null : limits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0),
        },
        lastActivityAt: organizations.reduce<Date | null>((latest, org) =>
          org.lastActivityAt && (!latest || org.lastActivityAt > latest) ? org.lastActivityAt : latest, null),
        attention: [...new Set(organizations.flatMap((org) => org.attention))],
        createdAt: organizations.reduce((earliest, org) => org.createdAt < earliest ? org.createdAt : earliest, organizations[0].createdAt),
        organizations,
      };
    }).sort((left, right) => left.name.localeCompare(right.name));
  }
}
