import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { designFee, type PricingMethod } from "../../design/design-packages.domain";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { REQUIREMENT_ASSET_PREFIX } from "../leads/requirement-notes.service";
import { areaIn, discoveryMissing, type DiscoveryFacts, type DiscoveryQuestion } from "./discovery.domain";

export type SaveDiscoveryInput = Partial<DiscoveryFacts> & { version?: number; answers?: Record<string, unknown> };
type Context = { leadId: string | null; enquiryType: string | null; clientType: string | null; partyEmail: string | null };
type PackageRow = { id: string; name: string; pricingMethod: PricingMethod; rate: string; currency: string; areaUnit: "sqft" | "sqm" | null; status: string };

/** PLM-040: the Account Manager's discovery form on an opportunity, and the design fee it prices (PLM-041). */
@Injectable()
export class OpportunityDiscoveryService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", (client) => this.view(client, workspaceId, opportunityId));
  }

  save(actor: RequestActor, workspaceId: string, opportunityId: string, input: SaveDiscoveryInput) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, user) => {
      const context = await this.context(client, workspaceId, opportunityId);
      const before = await this.facts(client, workspaceId, opportunityId, true);
      if (input.version !== undefined && (before?.version ?? 0) !== input.version) throw new ConflictException("The discovery form changed in another window. Reload and try again.");
      const merged: DiscoveryFacts = {
        area: input.area !== undefined ? (input.area ? String(input.area) : null) : before?.area ?? null,
        areaUnit: input.areaUnit !== undefined ? input.areaUnit : before?.areaUnit ?? null,
        spaces: input.spaces !== undefined ? input.spaces : before?.spaces ?? null,
        propertyLocation: input.propertyLocation !== undefined ? input.propertyLocation?.replace(/\s+/g, " ").trim() || null : before?.propertyLocation ?? null,
        clientEmail: input.clientEmail !== undefined ? input.clientEmail?.trim().toLowerCase() || null : before?.clientEmail ?? null,
        floorPlanAssetId: input.floorPlanAssetId !== undefined ? input.floorPlanAssetId : before?.floorPlanAssetId ?? null,
        designPackageId: input.designPackageId !== undefined ? input.designPackageId : before?.designPackageId ?? null,
      };
      if (merged.area && (!/^\d{1,8}(\.\d{1,2})?$/.test(merged.area) || Number(merged.area) <= 0)) throw new UnprocessableEntityException("Enter the area as a number, e.g. 1500");
      if (merged.area && !merged.areaUnit) throw new UnprocessableEntityException("Choose square feet or square metres");
      if (!merged.area) merged.areaUnit = null;
      if (merged.spaces !== null && (!Number.isInteger(merged.spaces) || merged.spaces < 1 || merged.spaces > 500)) throw new UnprocessableEntityException("Enter the number of spaces between 1 and 500");
      if (merged.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merged.clientEmail)) throw new UnprocessableEntityException("Enter a valid client email");
      if (merged.propertyLocation && merged.propertyLocation.length > 240) throw new UnprocessableEntityException("Keep the location under 240 characters");
      if (merged.floorPlanAssetId && !(await this.files(client, workspaceId, context.leadId)).some((file) => file.id === merged.floorPlanAssetId))
        throw new UnprocessableEntityException("Choose a floor plan from this enquiry's files");
      const pkg = merged.designPackageId ? await this.package(client, workspaceId, merged.designPackageId) : null;
      if (merged.designPackageId && (!pkg || (pkg.status !== "active" && pkg.id !== before?.designPackageId))) throw new UnprocessableEntityException("Choose a design package that is offered");
      const fee = pkg ? this.fee(pkg, merged) : null;
      await client.query(
        `INSERT INTO crm_opportunity_discovery (workspace_id, opportunity_id, area, area_unit, spaces, property_location, client_email, floor_plan_asset_id, design_package_id, design_fee, design_fee_currency, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (workspace_id, opportunity_id) DO UPDATE SET area=excluded.area, area_unit=excluded.area_unit, spaces=excluded.spaces,
           property_location=excluded.property_location, client_email=excluded.client_email, floor_plan_asset_id=excluded.floor_plan_asset_id,
           design_package_id=excluded.design_package_id, design_fee=excluded.design_fee, design_fee_currency=excluded.design_fee_currency,
           updated_by=excluded.updated_by, updated_at=now(), version=crm_opportunity_discovery.version+1`,
        [workspaceId, opportunityId, merged.area, merged.areaUnit, merged.spaces, merged.propertyLocation, merged.clientEmail, merged.floorPlanAssetId,
          merged.designPackageId, fee?.fee ?? null, fee?.currency ?? null, user.userId]);
      const questions = await this.questions(client, workspaceId, context.enquiryType);
      const changedAnswers: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input.answers ?? {})) {
        if (!questions.some((question) => question.key === key)) throw new UnprocessableEntityException(`Unknown discovery question: ${key}`);
        if (typeof value === "string" && value.length > 4000) throw new UnprocessableEntityException("Keep each answer under 4000 characters");
        await client.query(
          `INSERT INTO crm_opportunity_discovery_values (workspace_id, opportunity_id, question_key, value, captured_by) VALUES ($1,$2,$3,$4::jsonb,$5)
           ON CONFLICT (workspace_id, opportunity_id, question_key) DO UPDATE SET value=excluded.value, captured_by=excluded.captured_by, captured_at=now()`,
          [workspaceId, opportunityId, key, JSON.stringify(value ?? null), user.userId]);
        changedAnswers[key] = value;
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.opportunity.discovery_saved", entityType: "crm_opportunity", entityId: opportunityId,
        before: before ? { ...before, version: undefined } : null, after: { ...merged, designFee: fee?.fee ?? null, answers: changedAnswers } });
      return this.view(client, workspaceId, opportunityId);
    });
  }

  /** What still blocks a stage that requires discovery; used by the pipeline stage gate. */
  async missing(client: PoolClient, workspaceId: string, opportunityId: string) {
    const context = await this.context(client, workspaceId, opportunityId);
    const facts = await this.facts(client, workspaceId, opportunityId, false);
    const pkg = facts?.designPackageId ? await this.package(client, workspaceId, facts.designPackageId) : null;
    const questions = await this.questions(client, workspaceId, context.enquiryType);
    return discoveryMissing({ facts, enquiryType: context.enquiryType, clientType: context.clientType, packagePricing: pkg?.pricingMethod ?? null, questions, answers: await this.answers(client, workspaceId, opportunityId) });
  }

  private async view(client: PoolClient, workspaceId: string, opportunityId: string) {
    const context = await this.context(client, workspaceId, opportunityId);
    const facts = await this.facts(client, workspaceId, opportunityId, false);
    const questions = await this.questions(client, workspaceId, context.enquiryType);
    const answers = await this.answers(client, workspaceId, opportunityId);
    const pkg = facts?.designPackageId ? await this.package(client, workspaceId, facts.designPackageId) : null;
    return {
      facts: facts ?? { area: null, areaUnit: null, spaces: null, propertyLocation: null, clientEmail: context.partyEmail, floorPlanAssetId: null, designPackageId: null },
      designFee: facts?.designFee ? { amount: facts.designFee, currency: facts.designFeeCurrency } : null,
      package: pkg ? { id: pkg.id, name: pkg.name, pricingMethod: pkg.pricingMethod, areaUnit: pkg.areaUnit } : null,
      enquiryType: context.enquiryType, clientType: context.clientType,
      questions, answers, files: await this.files(client, workspaceId, context.leadId),
      missing: discoveryMissing({ facts, enquiryType: context.enquiryType, clientType: context.clientType, packagePricing: pkg?.pricingMethod ?? null, questions, answers }),
      version: facts?.version ?? 0,
    };
  }

  private fee(pkg: PackageRow, facts: DiscoveryFacts) {
    if (pkg.pricingMethod === "per_area" && (!facts.area || !facts.areaUnit)) return null;
    if (pkg.pricingMethod === "per_space" && !facts.spaces) return null;
    const area = pkg.pricingMethod === "per_area" && facts.area && facts.areaUnit ? areaIn(facts.area, facts.areaUnit, pkg.areaUnit ?? facts.areaUnit) : null;
    return { fee: designFee(pkg, { spaces: facts.spaces, area }), currency: pkg.currency };
  }

  private async context(client: PoolClient, workspaceId: string, opportunityId: string): Promise<Context> {
    const row = (await client.query<Context & { found: boolean }>(
      `SELECT true AS found, opportunity.lead_id AS "leadId", enquiry.service_type AS "enquiryType", enquiry.details->>'customerType' AS "clientType",
              (SELECT point.raw_value FROM crm_contact_points point WHERE point.workspace_id = opportunity.workspace_id AND point.party_id = opportunity.party_id
                 AND point.type = 'email' AND point.status = 'active' ORDER BY point.is_primary DESC LIMIT 1) AS "partyEmail"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0];
    if (!row?.found) throw new NotFoundException("Opportunity not found");
    return row;
  }

  private async facts(client: PoolClient, workspaceId: string, opportunityId: string, lock: boolean) {
    return (await client.query<DiscoveryFacts & { version: number; designFee: string | null; designFeeCurrency: string | null }>(
      `SELECT area::text AS area, area_unit AS "areaUnit", spaces, property_location AS "propertyLocation", client_email AS "clientEmail",
              floor_plan_asset_id AS "floorPlanAssetId", design_package_id AS "designPackageId", design_fee::text AS "designFee",
              design_fee_currency AS "designFeeCurrency", version
       FROM crm_opportunity_discovery WHERE workspace_id = $1 AND opportunity_id = $2 ${lock ? "FOR UPDATE" : ""}`, [workspaceId, opportunityId])).rows[0] ?? null;
  }

  private async questions(client: PoolClient, workspaceId: string, enquiryType: string | null): Promise<DiscoveryQuestion[]> {
    return (await client.query<DiscoveryQuestion & { configuration: { options?: unknown } }>(
      `SELECT question.key, question.label, question.required, question.data_type AS "dataType", question.configuration FROM crm_qualification_forms form
       JOIN crm_qualification_questions question ON question.workspace_id = form.workspace_id AND question.form_id = form.id
       WHERE form.workspace_id = $1 AND form.purpose = 'discovery' AND form.status = 'active'
         AND (form.service_type IS NULL OR form.service_type = $2)
       ORDER BY (form.service_type IS NULL), question.position`, [workspaceId, enquiryType])).rows
      .filter((question, index, all) => all.findIndex((other) => other.key === question.key) === index)
      .map(({ configuration, ...question }) => ({ ...question, options: Array.isArray(configuration?.options)
        ? (configuration.options as unknown[]).map((option) => typeof option === "string" ? { id: option, label: option } : option as { id: string; label: string }).filter((option) => option?.id)
        : undefined }));
  }

  private async answers(client: PoolClient, workspaceId: string, opportunityId: string) {
    const rows = (await client.query<{ key: string; value: unknown }>(`SELECT question_key AS key, value FROM crm_opportunity_discovery_values WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId])).rows;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  private async files(client: PoolClient, workspaceId: string, leadId: string | null) {
    if (!leadId) return [];
    const rows = (await client.query<{ value: { id: string; name: string; mimeType: string } }>(
      `SELECT value FROM crm_lead_qualification_values WHERE workspace_id = $1 AND lead_id = $2 AND question_key LIKE $3 ORDER BY captured_at DESC`,
      [workspaceId, leadId, `${REQUIREMENT_ASSET_PREFIX}%`])).rows;
    return rows.map((row) => ({ id: row.value.id, name: row.value.name, mimeType: row.value.mimeType })).filter((file) => file.id);
  }

  private async package(client: PoolClient, workspaceId: string, id: string) {
    return (await client.query<PackageRow>(
      `SELECT id, name, pricing_method AS "pricingMethod", rate::text AS rate, currency, area_unit AS "areaUnit", status FROM design_packages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0] ?? null;
  }
}
