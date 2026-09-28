import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { CommercialService } from "../commercial/commercial.service";
import { FactoryService } from "../factory/factory.service";
import { InventoryService } from "../inventory/inventory.service";
import { PettyCashService } from "../petty-cash/petty-cash.service";
import { OrdersService } from "../purchasing/orders.service";
import { PayablesService } from "../purchasing/payables.service";
import { PaymentRunsService } from "../purchasing/payment-runs.service";
import { SiteService } from "../site/site.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { waitingFor, type ApprovalContext, type ApprovalKind, type ApprovalRow } from "./approval-sources";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = new Set(["approve", "return", "reject"]);

/**
 * "Waiting for you": everything across the modules that someone must approve, verify or close, for the
 * person who may do it. One list for Home, the Approvals page and the sidebar badge. Decisions made in a
 * row go through the owning module's own command, so its permission, separation-of-duties and version
 * checks are the ones that apply.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly commercial: CommercialService,
    private readonly orders: OrdersService,
    private readonly factory: FactoryService,
    private readonly inventory: InventoryService,
    private readonly payables: PayablesService,
    private readonly runs: PaymentRunsService,
    private readonly site: SiteService,
    private readonly pettyCash: PettyCashService,
  ) {}

  mine(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => waitingFor(client, await this.context(client, workspaceId, user)));
  }

  /** How many things wait for this person (the sidebar badge and Home's first figure). */
  count(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { count, counts } = await waitingFor(client, await this.context(client, workspaceId, user));
      return { count, counts };
    });
  }

  /** Approve, return or refuse one row, through its module's command. Returns the refreshed list. */
  async decide(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const kind = String(body.kind ?? "") as ApprovalKind;
    const id = String(body.id ?? "");
    const decision = String(body.decision ?? "");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    if (!UUID.test(id)) throw new BadRequestException("Choose what to decide.");
    if (!DECISIONS.has(decision)) throw new BadRequestException("Approve, return or refuse.");
    // The row as this person sees it now: what it is, its version, and whether they may decide it.
    const row = (await this.mine(actor, workspaceId)).rows.find((item) => item.kind === kind && item.id === id);
    if (!row) throw new NotFoundException("This is no longer waiting for you. Refresh to see what is.");
    if (!row.decide) throw new BadRequestException("Open it to decide.");
    if (decision !== "approve" && decision !== row.decide.other) throw new BadRequestException("That decision doesn't apply here.");
    await this.dispatch(actor, workspaceId, row, decision, note);
    return this.mine(actor, workspaceId);
  }

  private async dispatch(actor: RequestActor, workspaceId: string, row: ApprovalRow, decision: string, note: string) {
    const approve = decision === "approve";
    switch (row.kind) {
      case "quote_review":
        return this.commercial.command(actor, workspaceId, row.parentId!, approve
          ? { action: row.decide!.approve, revision: row.version, quoteId: row.id }
          : { action: "return", revision: row.version, quoteId: row.id, note });
      case "receipt":
        return this.commercial.command(actor, workspaceId, row.parentId!, { action: "verify_payment", revision: row.version, paymentId: row.id });
      case "order":
        return this.orders.command(actor, workspaceId, row.id, { action: approve ? "approve" : "return", version: row.version, note });
      case "output":
        return this.factory.command(actor, workspaceId, row.parentId!, { action: "decide_report", reportId: row.id, decision: approve ? "approve" : "refuse", version: row.version, note });
      case "stock_correction":
        return this.inventory.decideAdjustment(actor, workspaceId, row.id, { action: approve ? "approve" : "reject", note });
      case "bill":
        return this.payables.command(actor, workspaceId, { action: "approve", id: row.id, version: row.version, note, commandId: randomUUID() });
      case "payment_run":
        return this.runs.command(actor, workspaceId, { action: approve ? "approve" : "return", id: row.id, version: row.version, note, commandId: randomUUID() });
      case "site_report":
        return this.site.command(actor, workspaceId, row.parentId!, { action: approve ? "approve" : "return", id: row.id, version: row.version, note });
      case "petty_cash":
        return this.pettyCash.command(actor, workspaceId, row.parentId!, { action: approve ? "approve" : "reject", claimId: row.id, version: row.version, note, commandId: randomUUID() });
      default:
        throw new BadRequestException("Open it to decide.");
    }
  }

  private async context(client: PoolClient, workspaceId: string, user: ActorUser): Promise<ApprovalContext> {
    const granted = new Map<string, boolean>();
    const can = async (permission: string) => {
      if (!granted.has(permission)) granted.set(permission, await this.access.hasPermission(client, workspaceId, user.userId, permission));
      return granted.get(permission)!;
    };
    const membership = (await client.query<{ id: string }>(
      `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, user.userId])).rows[0];
    const managed = membership ? (await client.query<{ projectId: string }>(
      `SELECT DISTINCT project_id AS "projectId" FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active AND is_manager AND project_id IS NOT NULL`,
      [workspaceId, membership.id])).rows.map((row) => row.projectId) : [];
    const currency = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
    return { workspaceId, userId: user.userId, displayName: user.displayName, membershipId: membership?.id ?? null, can, managedProjects: new Set(managed), currency };
  }
}
