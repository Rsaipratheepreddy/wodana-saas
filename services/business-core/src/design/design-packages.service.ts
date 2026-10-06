import { areaIn } from "../crm/opportunities/discovery.domain";
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { checkDesignPackage, designFee, effectiveMinimumDeposit, type DesignPackageInput, type PricingMethod } from "./design-packages.domain";
import { DEFAULT_SITE_VISIT_QUESTIONS, normaliseSiteQuestions, type SiteQuestion } from "./design-journey.domain";

export type DesignFlowSettings = {
  version: number; designInternalDays: number; designClientDays: number; materialSelectionDays: number; estimateDays: number;
  visualiserRoleCode: string; showroomBookingTypeId: string | null; siteVisitQuestions: SiteQuestion[];
  /** The 3D renders' own internal and client-facing days; null follows the design days. */
  renderInternalDays?: number | null; renderClientDays?: number | null;
};

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

  saveMinimumDeposit(actor: RequestActor, workspaceId: string, input: { minimumDeposit?: { amount: string; currency: string } | null; timings?: { inspirationDays: number; siteVisitHours: number }; version?: number }) {
    const keepMinimum = input.minimumDeposit === undefined;
    if (input.minimumDeposit && (!/^\d{1,12}(\.\d{1,2})?$/.test(input.minimumDeposit.amount ?? "") || !/^[A-Z]{3}$/.test(input.minimumDeposit.currency ?? "")))
      throw new UnprocessableEntityException("Enter the minimum deposit as an amount and currency");
    const minimum = effectiveMinimumDeposit(input.minimumDeposit);
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const current = await client.query<{ amount: string | null; currency: string | null; version: number }>(
        `SELECT minimum_design_deposit::text AS amount, currency, version FROM workspace_design_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
      const before = current.rows[0];
      if (input.version !== undefined && before && before.version !== input.version) throw new ConflictException("Design settings changed in another window. Reload and try again.");
      await client.query(
        `INSERT INTO workspace_design_settings (workspace_id, minimum_design_deposit, currency, inspiration_days, site_visit_hours, updated_by)
         VALUES ($1, $2, $3, COALESCE($5, 7), COALESCE($6, 72), $4)
         ON CONFLICT (workspace_id) DO UPDATE SET
           minimum_design_deposit = CASE WHEN $7 THEN workspace_design_settings.minimum_design_deposit ELSE excluded.minimum_design_deposit END,
           currency = CASE WHEN $7 THEN workspace_design_settings.currency ELSE excluded.currency END,
           inspiration_days = COALESCE($5, workspace_design_settings.inspiration_days), site_visit_hours = COALESCE($6, workspace_design_settings.site_visit_hours),
           updated_by = excluded.updated_by, updated_at = now(), version = workspace_design_settings.version + 1`,
        [workspaceId, minimum?.amount ?? null, minimum?.currency ?? null, user.userId, input.timings?.inspirationDays ?? null, input.timings?.siteVisitHours ?? null, keepMinimum]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.minimum_deposit_changed", entityType: "workspace_design_settings", entityId: workspaceId,
        before: before ? { amount: before.amount, currency: before.currency } : null, after: { minimumDeposit: keepMinimum ? undefined : minimum, timings: input.timings } });
      return this.load(client, workspaceId);
    });
  }

  /**
   * Settings › Design: the design flow's timings, the role that renders, the showroom booking type (the booking
   * slot engine) and the site-visit question list (PLM-128). Configuration; each journey freezes its copy at start.
   */
  saveFlowSettings(actor: RequestActor, workspaceId: string, input: Omit<DesignFlowSettings, "version"> & { version: number }) {
    const questions = normaliseSiteQuestions(input.siteVisitQuestions);
    if (questions.length !== input.siteVisitQuestions.length) throw new UnprocessableEntityException("Every question needs a unique key and its text");
    if (input.designClientDays < input.designInternalDays) throw new UnprocessableEntityException("The client deadline can't be before the internal one");
    const renderInternal = input.renderInternalDays ?? null, renderClient = input.renderClientDays ?? null;
    if ((renderClient ?? input.designClientDays) < (renderInternal ?? input.designInternalDays)) throw new UnprocessableEntityException("The renders' client deadline can't be before their internal one");
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const before = (await client.query<{ version: number }>(`SELECT version FROM workspace_design_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows[0];
      if ((before?.version ?? 0) !== input.version) throw new ConflictException("Design settings changed in another window. Reload and try again.");
      if (input.showroomBookingTypeId && !(await client.query(`SELECT 1 FROM booking_types WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.showroomBookingTypeId])).rowCount)
        throw new UnprocessableEntityException("Choose one of your booking types");
      await client.query(
        `INSERT INTO workspace_design_settings (workspace_id, design_internal_days, design_client_days, material_selection_days, estimate_days, visualiser_role_code,
                                                showroom_booking_type_id, site_visit_questions, updated_by, render_internal_days, render_client_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
         ON CONFLICT (workspace_id) DO UPDATE SET design_internal_days = excluded.design_internal_days, design_client_days = excluded.design_client_days,
           material_selection_days = excluded.material_selection_days, estimate_days = excluded.estimate_days, visualiser_role_code = excluded.visualiser_role_code,
           showroom_booking_type_id = excluded.showroom_booking_type_id, site_visit_questions = excluded.site_visit_questions,
           render_internal_days = excluded.render_internal_days, render_client_days = excluded.render_client_days,
           updated_by = excluded.updated_by, updated_at = now(), version = workspace_design_settings.version + 1`,
        [workspaceId, input.designInternalDays, input.designClientDays, input.materialSelectionDays, input.estimateDays, input.visualiserRoleCode.trim() || "visualiser",
          input.showroomBookingTypeId ?? null, JSON.stringify(questions), user.userId, renderInternal, renderClient]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "design.flow_settings_changed.v1", entityType: "workspace_design_settings", entityId: workspaceId,
        after: { ...input, siteVisitQuestions: questions.map((question) => question.key) } });
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

  quote(actor: RequestActor, workspaceId: string, id: string, measure: { spaces?: number | null; area?: string | null; areaUnit?: "sqft" | "sqm" | null }) {
    return this.access.withAnyPermission(actor, workspaceId, ["crm.opportunities.view", "crm.settings.manage"], async (client) => {
      const pkg = await this.requirePackage(client, workspaceId, id, false);
      if (pkg.status !== "active") throw new UnprocessableEntityException("This package is no longer offered");
      const area = measure.area && measure.areaUnit && pkg.areaUnit ? areaIn(measure.area, measure.areaUnit, pkg.areaUnit) : measure.area;
      return { packageId: pkg.id, fee: designFee(pkg, { spaces: measure.spaces, area }), currency: pkg.currency, pricingMethod: pkg.pricingMethod, areaUnit: pkg.areaUnit };
    });
  }

  /** The workspace minimum, frozen into a case when its service path is chosen. */
  static async minimumDeposit(client: Pick<PoolClient, "query">, workspaceId: string) {
    const row = (await client.query<{ amount: string | null; currency: string | null }>(
      `SELECT minimum_design_deposit::text AS amount, currency FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    return effectiveMinimumDeposit(row);
  }

  private async load(client: PoolClient, workspaceId: string) {
    const settings = (await client.query<{ amount: string | null; currency: string | null; version: number; inspirationDays: number; siteVisitHours: number }>(
      `SELECT minimum_design_deposit::text AS amount, currency, version, inspiration_days AS "inspirationDays", site_visit_hours AS "siteVisitHours" FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const packages = (await client.query<PackageRow>(`SELECT ${PACKAGE_COLUMNS} FROM design_packages WHERE workspace_id = $1 ORDER BY status, position, name`, [workspaceId])).rows;
    const flow = (await client.query<Omit<DesignFlowSettings, "version" | "siteVisitQuestions"> & { questions: unknown }>(
      `SELECT design_internal_days AS "designInternalDays", design_client_days AS "designClientDays", material_selection_days AS "materialSelectionDays", estimate_days AS "estimateDays",
              visualiser_role_code AS "visualiserRoleCode", showroom_booking_type_id AS "showroomBookingTypeId", site_visit_questions AS questions,
              render_internal_days AS "renderInternalDays", render_client_days AS "renderClientDays"
         FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const bookingTypes = (await client.query<{ id: string; name: string }>(`SELECT id, name FROM booking_types WHERE workspace_id = $1 AND active ORDER BY name`, [workspaceId])).rows;
    return { minimumDeposit: effectiveMinimumDeposit(settings), version: settings?.version ?? 0,
      timings: { inspirationDays: settings?.inspirationDays ?? 7, siteVisitHours: settings?.siteVisitHours ?? 72 }, packages,
      flow: {
        designInternalDays: flow?.designInternalDays ?? 35, designClientDays: flow?.designClientDays ?? 56, materialSelectionDays: flow?.materialSelectionDays ?? 7,
        estimateDays: flow?.estimateDays ?? 7, visualiserRoleCode: flow?.visualiserRoleCode ?? "visualiser", showroomBookingTypeId: flow?.showroomBookingTypeId ?? null,
        siteVisitQuestions: flow ? normaliseSiteQuestions(flow.questions) : DEFAULT_SITE_VISIT_QUESTIONS,
        renderInternalDays: flow?.renderInternalDays ?? null, renderClientDays: flow?.renderClientDays ?? null,
      },
      bookingTypes };
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
