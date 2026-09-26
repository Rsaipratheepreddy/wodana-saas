import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { checkDesignPackage, designFee, type DesignPackageInput, type PricingMethod } from "./design-packages.domain";

type PackageRow = {
  id: string; code: string; name: string; pricingMethod: PricingMethod; rate: string; currency: string; areaUnit: "sqft" | "sqm" | null;
  includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null; inclusions: string | null;
  position: number; status: "active" | "archived"; version: number;
};
const PACKAGE_COLUMNS = `id, code, name, pricing_method AS "pricingMethod", rate::text AS rate, currency, area_unit AS "areaUnit",
  included_revisions AS "includedRevisions", includes_space_planning AS "includesSpacePlanning", includes_renders AS "includesRenders",
  required_role_code AS "requiredRoleCode", inclusions, position, status, version`;

/** PLM-041: design package price list and minimum design deposit. Sales can read; owners and admins change it. */
@Injectable()
export class DesignPackagesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["crm.opportunities.view", "crm.settings.manage"], (client) => this.load(client, workspaceId));
  }

  saveMinimumDeposit(actor: RequestActor, workspaceId: string, input: { minimumDeposit: { amount: string; currency: string } | null; version?: number }) {
    const minimum = input.minimumDeposit;
    if (minimum && (!/^\d{1,12}(\.\d{1,2})?$/.test(minimum.amount ?? "") || !/^[A-Z]{3}$/.test(minimum.currency ?? "")))
      throw new UnprocessableEntityException("Enter the minimum deposit as an amount and currency");
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const current = await client.query<{ amount: string | null; currency: string | null; version: number }>(
        `SELECT minimum_design_deposit::text AS amount, currency, version FROM workspace_design_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
      const before = current.rows[0];
      if (input.version !== undefined && before && before.version !== input.version) throw new ConflictException("Design settings changed in another window. Reload and try again.");
      await client.query(
        `INSERT INTO workspace_design_settings (workspace_id, minimum_design_deposit, currency, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id) DO UPDATE SET minimum_design_deposit = excluded.minimum_design_deposit, currency = excluded.currency,
           updated_by = excluded.updated_by, updated_at = now(), version = workspace_design_settings.version + 1`,
        [workspaceId, minimum?.amount ?? null, minimum?.currency ?? null, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.minimum_deposit_changed", entityType: "workspace_design_settings", entityId: workspaceId,
        before: before ? { amount: before.amount, currency: before.currency } : null, after: minimum });
      return this.load(client, workspaceId);
    });
  }

  savePackage(actor: RequestActor, workspaceId: string, input: DesignPackageInput & { id?: string; version?: number }) {
    const value = checkDesignPackage(input);
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      let saved: PackageRow;
      if (input.id) {
        const before = await this.requirePackage(client, workspaceId, input.id, true);
        if (input.version !== undefined && before.version !== input.version) throw new ConflictException("This package changed in another window. Reload and try again.");
        saved = (await client.query<PackageRow>(
          `UPDATE design_packages SET code=$3, name=$4, pricing_method=$5, rate=$6, currency=$7, area_unit=$8, included_revisions=$9, includes_space_planning=$10,
             includes_renders=$11, required_role_code=$12, inclusions=$13, position=$14, version=version+1, updated_at=now()
           WHERE workspace_id=$1 AND id=$2 RETURNING ${PACKAGE_COLUMNS}`,
          [workspaceId, input.id, ...this.values(value)])).rows[0];
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.package_updated", entityType: "design_package", entityId: saved.id, before, after: saved });
      } else {
        saved = (await client.query<PackageRow>(
          `INSERT INTO design_packages (workspace_id, code, name, pricing_method, rate, currency, area_unit, included_revisions, includes_space_planning, includes_renders, required_role_code, inclusions, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (workspace_id, code) DO NOTHING RETURNING ${PACKAGE_COLUMNS}`,
          [workspaceId, ...this.values(value)])).rows[0];
        if (!saved) throw new ConflictException("A package with this code already exists");
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.package_created", entityType: "design_package", entityId: saved.id, after: saved });
      }
      return saved;
    });
  }

  setStatus(actor: RequestActor, workspaceId: string, id: string, input: { status: "active" | "archived"; version: number }) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const before = await this.requirePackage(client, workspaceId, id, true);
      if (before.version !== input.version) throw new ConflictException("This package changed in another window. Reload and try again.");
      if (before.status === input.status) return before;
      const saved = (await client.query<PackageRow>(`UPDATE design_packages SET status=$3, version=version+1, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING ${PACKAGE_COLUMNS}`, [workspaceId, id, input.status])).rows[0];
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `design.package_${input.status === "archived" ? "archived" : "restored"}`, entityType: "design_package", entityId: id, before: { status: before.status }, after: { status: input.status } });
      return saved;
    });
  }

  quote(actor: RequestActor, workspaceId: string, id: string, measure: { spaces?: number | null; area?: string | null }) {
    return this.access.withAnyPermission(actor, workspaceId, ["crm.opportunities.view", "crm.settings.manage"], async (client) => {
      const pkg = await this.requirePackage(client, workspaceId, id, false);
      if (pkg.status !== "active") throw new UnprocessableEntityException("This package is no longer offered");
      return { packageId: pkg.id, fee: designFee(pkg, measure), currency: pkg.currency, pricingMethod: pkg.pricingMethod, areaUnit: pkg.areaUnit };
    });
  }

  /** The workspace minimum, frozen into a case when its service path is chosen. */
  static async minimumDeposit(client: Pick<PoolClient, "query">, workspaceId: string) {
    const row = (await client.query<{ amount: string | null; currency: string | null }>(
      `SELECT minimum_design_deposit::text AS amount, currency FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    return row?.amount && row.currency ? { amount: row.amount, currency: row.currency } : null;
  }

  private async load(client: PoolClient, workspaceId: string) {
    const settings = (await client.query<{ amount: string | null; currency: string | null; version: number }>(
      `SELECT minimum_design_deposit::text AS amount, currency, version FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const packages = (await client.query<PackageRow>(`SELECT ${PACKAGE_COLUMNS} FROM design_packages WHERE workspace_id = $1 ORDER BY status, position, name`, [workspaceId])).rows;
    return { minimumDeposit: settings?.amount && settings.currency ? { amount: settings.amount, currency: settings.currency } : null, version: settings?.version ?? 0, packages };
  }

  private async requirePackage(client: PoolClient, workspaceId: string, id: string, lock: boolean) {
    const row = (await client.query<PackageRow>(`SELECT ${PACKAGE_COLUMNS} FROM design_packages WHERE workspace_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`, [workspaceId, id])).rows[0];
    if (!row) throw new NotFoundException("Design package not found");
    return row;
  }

  private values(value: DesignPackageInput) {
    return [value.code, value.name, value.pricingMethod, value.rate, value.currency, value.areaUnit ?? null, value.includedRevisions, value.includesSpacePlanning,
      value.includesRenders, value.requiredRoleCode ?? null, value.inclusions ?? null, value.position ?? 0];
  }
}
