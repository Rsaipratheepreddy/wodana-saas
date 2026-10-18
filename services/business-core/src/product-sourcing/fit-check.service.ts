import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { sizeNumber } from "./product-extract";
import { fitForCase, readAccessPoint, readAccessPoints } from "./fit-check.store";

const READERS = ["pre_projects.view", "purchasing.view", "purchasing.manage", "catalog.view"];
const EDITORS = ["pre_projects.edit"];
const OVERRIDERS = ["pre_projects.edit", "purchasing.manage"];
const SIZES = ["width", "height", "turnWidth", "cabinWidth", "cabinDepth", "cabinHeight"] as const;

type PointInput = {
  version: number; route: string; position: number; kind: string; label: string; unit: string; siteRecordId?: string | null; note?: string;
  width?: string | null; height?: string | null; turnWidth?: string | null; cabinWidth?: string | null; cabinDepth?: string | null; cabinHeight?: string | null;
};

/**
 * Fit check (plan §0.7 R5, E5-6): a case's measured access points, each item's fit through them, and the override
 * that lets a failing item be ordered. An override is for exactly the size and access points it saw.
 */
@Injectable()
export class FitCheckService {
  constructor(private readonly access: WorkspaceAccessService) {}

  accessPoints(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withAnyPermission(actor, workspaceId, READERS, async (client) => {
      await this.caseExists(client, workspaceId, caseId);
      const unitSystem = (await client.query<{ unitSystem: string }>(`SELECT unit_system::text AS "unitSystem" FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.unitSystem;
      return { points: await readAccessPoints(client, workspaceId, caseId), defaultUnit: unitSystem === "imperial" ? "in" : "cm" };
    });
  }

  /** Records or changes one access point (version 0 creates it; the same create sent again is a no-op). */
  saveAccessPoint(actor: RequestActor, workspaceId: string, caseId: string, pointId: string, input: PointInput) {
    return this.access.withAnyPermission(actor, workspaceId, EDITORS, async (client, user) => {
      await this.caseExists(client, workspaceId, caseId);
      const clean = this.clean(input);
      const current = await readAccessPoint(client, workspaceId, caseId, pointId, true);
      if (!current && input.version !== 0) throw new NotFoundException("Access point not found");
      if (current?.archived) throw new ConflictException("This access point was removed.");
      if (current && input.version === 0) {
        // A replayed create: the same content is accepted once.
        if (current.version === 1 && current.label === clean.label && current.kind === clean.kind) return current;
        throw new ConflictException("This access point already exists; reload and try again.");
      }
      if (current && current.version !== input.version) throw new ConflictException("Someone changed this access point; reload and try again.");
      const values = [pointId, workspaceId, caseId, clean.route, clean.position, clean.kind, clean.label, clean.width, clean.height, clean.turnWidth, clean.cabinWidth, clean.cabinDepth, clean.cabinHeight, clean.unit, clean.siteRecordId, clean.note, user.userId];
      try {
        if (current) await client.query(
          `UPDATE site_access_points SET route = $4, position = $5, kind = $6, label = $7, width = $8::numeric, height = $9::numeric, turn_width = $10::numeric, cabin_width = $11::numeric,
             cabin_depth = $12::numeric, cabin_height = $13::numeric, unit = $14, site_record_id = $15, note = $16, updated_by = $17, version = version + 1, updated_at = now()
           WHERE id = $1 AND workspace_id = $2 AND case_id = $3`, values);
        else await client.query(
          `INSERT INTO site_access_points (id, workspace_id, case_id, route, position, kind, label, width, height, turn_width, cabin_width, cabin_depth, cabin_height, unit, site_record_id, note, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14, $15, $16, $17, $17)`, values);
      } catch (error) {
        if ((error as { code?: string }).code === "23514") throw new UnprocessableEntityException("Cabin sizes are for lifts; a turn width is for corridors and stairs.");
        if ((error as { code?: string }).code === "23505") throw new ConflictException("This access point already exists; reload and try again.");
        throw error;
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: current ? "site.access_point_changed.v1" : "site.access_point_added.v1", entityType: "pre_project_case", entityId: caseId,
        before: current ?? null, after: { pointId, ...clean } });
      return (await readAccessPoint(client, workspaceId, caseId, pointId))!;
    });
  }

  archiveAccessPoint(actor: RequestActor, workspaceId: string, caseId: string, pointId: string, version: number) {
    return this.access.withAnyPermission(actor, workspaceId, EDITORS, async (client, user) => {
      const current = await readAccessPoint(client, workspaceId, caseId, pointId, true);
      if (!current) throw new NotFoundException("Access point not found");
      if (current.archived) return { archived: true };
      if (current.version !== version) throw new ConflictException("Someone changed this access point; reload and try again.");
      await client.query(`UPDATE site_access_points SET archived_at = now(), updated_by = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, pointId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "site.access_point_removed.v1", entityType: "pre_project_case", entityId: caseId, before: current });
      return { archived: true };
    });
  }

  /** Each item's fit (a warning at approval; ordering is blocked while one fails without an override). */
  check(actor: RequestActor, workspaceId: string, caseId: string, itemIds: string[]) {
    return this.access.withAnyPermission(actor, workspaceId, READERS, async (client) => {
      await this.caseExists(client, workspaceId, caseId);
      return { items: await fitForCase(client, workspaceId, caseId, itemIds) };
    });
  }

  /** Lets a failing item through with a reason, for the inputs the person saw (stale inputs are refused). */
  override(actor: RequestActor, workspaceId: string, caseId: string, input: { id: string; itemId: string; inputsHash: string; reason: string; context: "approval" | "ordering" }) {
    return this.access.withAnyPermission(actor, workspaceId, OVERRIDERS, async (client, user) => {
      const facts = await this.caseExists(client, workspaceId, caseId);
      const reason = input.reason.replace(/\s+/g, " ").trim();
      if (reason.length < 3) throw new UnprocessableEntityException("Say why it can go ahead");
      const replay = (await client.query<{ itemId: string; caseId: string }>(`SELECT item_id AS "itemId", case_id AS "caseId" FROM fit_check_overrides WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.id])).rows[0];
      if (replay) {
        if (replay.itemId !== input.itemId || replay.caseId !== caseId) throw new ConflictException("This decision id belongs to another item.");
        return (await fitForCase(client, workspaceId, caseId, [input.itemId]))[0];
      }
      // Serialise decisions on one item so two people can't both record one for the same inputs.
      await client.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, input.itemId]);
      const fit = (await fitForCase(client, workspaceId, caseId, [input.itemId]))[0];
      if (!fit) throw new NotFoundException("Item not found");
      if (fit.inputsHash !== input.inputsHash) throw new ConflictException("The item's size or the site's access points changed. Check the fit again.");
      if (fit.override) return fit;
      if (fit.result.status !== "does_not_fit") throw new ConflictException("This item doesn't need an override.");
      await client.query(
        `INSERT INTO fit_check_overrides (id, workspace_id, case_id, item_id, inputs_hash, outcome, result, reason, context, overridden_by) VALUES ($1, $2, $3, $4, $5, 'does_not_fit', $6::jsonb, $7, $8, $9)`,
        [input.id, workspaceId, caseId, input.itemId, fit.inputsHash, JSON.stringify({ result: fit.result, size: fit.size }), reason, input.context, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "sourcing.fit_overridden.v1", entityType: "catalog_item", entityId: input.itemId,
        after: { caseId, inputsHash: fit.inputsHash, reason, context: input.context, status: fit.result.status } });
      // The people who approve orders and the case's owner hear about it.
      const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "";
      const recipients = (await client.query<{ userId: string }>(
        `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
           JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
           JOIN role_permissions granted ON granted.role_id = effective_role.role_id
           JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.approve'
          WHERE membership.workspace_id = $1 AND membership.status = 'active'
         UNION SELECT owner.user_id FROM pre_project_cases pre_case JOIN workspace_memberships owner ON owner.workspace_id = pre_case.workspace_id AND owner.id = pre_case.owner_membership_id
          WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 AND owner.status = 'active'`, [workspaceId, caseId])).rows.map((row) => row.userId);
      for (const recipientUserId of recipients.filter((id) => id !== user.userId)) {
        await notifyUserInApp(client, { workspaceId, recipientUserId, code: "sourcing.fit_override", eventType: "sourcing.fit_override",
          variables: { item: fit.name, clientName: facts.clientName, actor: actorName, reason }, deepLink: `/workspace/pre-projects/cases/${caseId}`, idempotencyKey: `fit-override:${input.id}:${recipientUserId}` });
      }
      return (await fitForCase(client, workspaceId, caseId, [input.itemId]))[0];
    });
  }

  private clean(input: PointInput) {
    const kind = input.kind as "door" | "lift" | "stair" | "corridor" | "window" | "other";
    const label = input.label.replace(/\s+/g, " ").trim(), route = input.route.replace(/\s+/g, " ").trim();
    if (!label) throw new UnprocessableEntityException("Name the access point");
    if (!route) throw new UnprocessableEntityException("Name the route");
    const sizes = Object.fromEntries(SIZES.map((key) => {
      const raw = input[key];
      if (raw === null || raw === undefined || raw === "") return [key, null];
      const value = sizeNumber(raw);
      if (!value) throw new UnprocessableEntityException("Enter sizes as positive numbers");
      return [key, value];
    })) as Record<(typeof SIZES)[number], string | null>;
    if (kind !== "lift") { sizes.cabinWidth = null; sizes.cabinDepth = null; sizes.cabinHeight = null; }
    if (kind !== "corridor" && kind !== "stair") sizes.turnWidth = null;
    return { kind, label: label.slice(0, 120), route: route.slice(0, 60), position: input.position, unit: input.unit, siteRecordId: input.siteRecordId ?? null, note: (input.note ?? "").trim().slice(0, 500), ...sizes };
  }

  private async caseExists(client: PoolClient, workspaceId: string, caseId: string) {
    const row = (await client.query<{ clientName: string }>(
      `SELECT coalesce(party.display_name, opportunity.title, '') AS "clientName"
         FROM pre_project_cases pre_case
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
    if (!row) throw new NotFoundException("Case not found");
    return row;
  }
}
