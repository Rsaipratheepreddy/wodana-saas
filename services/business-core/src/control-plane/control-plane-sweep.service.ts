import { Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { TenantDomainsService } from "../workspaces/tenant-domains.service";
import { DEFAULT_GRACE_DAYS, lifecycleAutomation } from "./control-plane.domain";
import { SupportSessionsService } from "./support-sessions.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";

/**
 * The control-plane sweep, run by the worker every few minutes: support sessions expire or are revoked,
 * a past-due account goes into grace and a finished grace suspends, and verified domains are rechecked.
 * Organizations are enumerated through `list_control_plane_workspaces()`; each one runs in its own tenant
 * transaction, and one failure does not stop the others.
 */
@Injectable()
export class ControlPlaneSweepService {
  private readonly logger = new Logger(ControlPlaneSweepService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly support: SupportSessionsService,
    private readonly domains: TenantDomainsService,
  ) {}

  async run() {
    const workspaces = await this.database.query<{ workspace_id: string }>("SELECT workspace_id FROM list_control_plane_workspaces()");
    const totals = { workspaces: workspaces.rowCount ?? 0, supportExpired: 0, supportRevoked: 0,
      graceStarted: 0, suspended: 0, domainsChecked: 0, domainsLost: 0, failedWorkspaces: 0 };
    for (const { workspace_id: workspaceId } of workspaces.rows) {
      try {
        const result = await this.runWorkspace(workspaceId);
        totals.supportExpired += result.support.expired;
        totals.supportRevoked += result.support.revoked;
        if (result.lifecycle === "grace") totals.graceStarted += 1;
        if (result.lifecycle === "suspended") totals.suspended += 1;
        totals.domainsChecked += result.domains.checked;
        totals.domainsLost += result.domains.lost;
      } catch (error) {
        totals.failedWorkspaces += 1;
        this.logger.error(`Control-plane sweep failed for workspace ${workspaceId}: ${(error as Error).message}`);
      }
    }
    return totals;
  }

  /** One organization's sweep, in its own tenant transactions. */
  async runWorkspace(workspaceId: string) {
    const support = await this.support.sweep(workspaceId);
    const changed = await this.lifecycle.automate(workspaceId, async ({ state, graceEndsAt, client }) => lifecycleAutomation({
      state, graceEndsAt, paymentPastDue: await this.paymentPastDue(client, workspaceId), graceDays: await this.graceDays(client, workspaceId),
    }));
    const domains = await this.domains.sweepOwnership(workspaceId);
    return { support, lifecycle: changed?.state ?? null, domains };
  }

  private async paymentPastDue(client: PoolClient, workspaceId: string) {
    const found = await client.query<{ pastDue: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM customer_account_organizations linked
           JOIN account_billing_documents document ON document.account_id = linked.account_id
          WHERE linked.workspace_id = $1 AND document.document_type = 'invoice'
            AND (document.status = 'past_due' OR (document.status = 'issued' AND document.due_at < now()))
       ) OR COALESCE((
         SELECT collection.status IN ('past_due', 'collections')
           FROM customer_account_organizations linked
           JOIN account_collection_state_versions collection ON collection.account_id = linked.account_id
          WHERE linked.workspace_id = $1 ORDER BY collection.version DESC LIMIT 1
       ), false) AS "pastDue"`, [workspaceId]);
    return Boolean(found.rows[0]?.pastDue);
  }

  /** Grace length comes from the contracted plan (`graceDays`), else the platform default. */
  private async graceDays(client: PoolClient, workspaceId: string) {
    const found = await client.query<{ days: number | null }>(
      `SELECT CASE WHEN profile.configuration->>'graceDays' ~ '^[0-9]{1,3}$'
                   THEN (profile.configuration->>'graceDays')::int END AS days
         FROM customer_account_organizations linked
         JOIN customer_account_contracts contract ON contract.account_id = linked.account_id
         JOIN tenant_setup_profiles profile ON profile.kind = 'plan' AND profile.code = contract.plan_code
          AND profile.version = contract.plan_version
        WHERE linked.workspace_id = $1`, [workspaceId]);
    return found.rows[0]?.days ?? DEFAULT_GRACE_DAYS;
  }
}
