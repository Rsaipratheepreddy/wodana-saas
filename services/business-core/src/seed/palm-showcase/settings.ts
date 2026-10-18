import { isDeepStrictEqual } from "node:util";
import { ClientPortalAdminService } from "../../client-portal/client-portal-admin.service";
import { effectiveMinimumDeposit, type MinimumDeposit } from "../../design/design-packages.domain";
import { DesignPackagesService } from "../../design/design-packages.service";
import { ProjectWorkflowService } from "../../projects/project-workflow.service";
import { QuotationBuilderService } from "../../quotation/quotation-builder.service";
import { TaxNumberingService } from "../../workspaces/tax-numbering.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { actorOf, type Actor, type Core } from "./core";
import type { SeedData } from "./data";

/**
 * Workspace configuration from the tenant's documents: the tax profile on the region's model, the proposal kit,
 * quotation settings, design packages and the deposit floor, the project workflow and the client portal switch.
 * Each is compared first and written only when it differs.
 */
export async function ensureSettings(core: Core, data: SeedData, workspaceId: string, owner: Actor) {
  const actor = actorOf(owner);

  // Tax: the region pack says which model applies (UAE: VAT, TRN); the rate is the tenant's confirmed setting.
  const workspaces = core.get(WorkspacesService);
  const detail = await workspaces.get(actor, workspaceId) as unknown as { legalEntities: Array<{ id: string }> };
  const entityId = detail.legalEntities[0].id;
  const taxes = core.get(TaxNumberingService);
  const current = await taxes.get(actor, workspaceId, entityId) as { taxModel: { model: string }; tax: null | { version: number; pricesIncludeTax: boolean; rates: Array<{ code: string; label: string; rate: string; isDefault: boolean }> } };
  if (current.taxModel.model === "none") core.report.notes.push("The region pack has no tax model; no tax profile was written.");
  else await core.ensure("tax profile", "VAT profile", async () => Boolean(current.tax) && current.tax!.pricesIncludeTax === data.showcase.tax.pricesIncludeTax
    && isDeepStrictEqual(current.tax!.rates.map(({ code, label, rate, isDefault }) => ({ code, label, rate: String(Number(rate)), isDefault })), data.showcase.tax.rates),
  () => taxes.saveTax(actor, workspaceId, entityId, { ...(current.tax ? { version: current.tax.version } : {}), pricesIncludeTax: data.showcase.tax.pricesIncludeTax, rates: data.showcase.tax.rates }));

  // Proposal kit: the same fields as Settings → Quotations → Proposal.
  const quotation = core.get(QuotationBuilderService);
  const kit = (await quotation.proposalKit(actor, workspaceId)) as { kit: Record<string, unknown> & { version: number } };
  const fields = ["introduction", "letterNote", "defaultTerms", "defaultExclusions", "contactDetails", "website", "introductionImage", "closingImage", "monogramImage", "termsImages"];
  const desiredKit = Object.fromEntries(fields.map((field) => [field, data.proposalKit[field] ?? (field === "termsImages" ? [] : field.endsWith("Image") ? null : "")]));
  await core.ensure("proposal kit", "proposal kit", async () => fields.every((field) => isDeepStrictEqual(kit.kit[field] ?? null, desiredKit[field] ?? null)),
    () => quotation.saveProposalKit(actor, workspaceId, { version: kit.kit.version, ...desiredKit }));

  // Quotation settings: validity and review before sending.
  const settings = (await quotation.settings(actor, workspaceId)) as { settings: { validityDays: number; internalReview: boolean; version: number } };
  await core.ensure("quotation settings", "quotation settings", async () => settings.settings.validityDays === data.showcase.quotation.validityDays && settings.settings.internalReview === data.showcase.quotation.internalReview,
    () => quotation.saveSettings(actor, workspaceId, { version: settings.settings.version, validityDays: data.showcase.quotation.validityDays, internalReview: data.showcase.quotation.internalReview }));

  // Design packages and the minimum design deposit (configuration, not constants).
  const design = core.get(DesignPackagesService);
  const designState = (await design.get(actor, workspaceId)) as { minimumDeposit: MinimumDeposit | null; version: number; packages: Array<Record<string, unknown> & { id: string; code: string; version: number }> };
  // The fixture gives an amount, or a percentage of the design fee as a number; compared as the app keeps it.
  const wantedDeposit = effectiveMinimumDeposit(data.design.minimumDeposit as { amount?: string; currency?: string; percent?: number });
  await core.ensure("design settings", "minimum design deposit", async () => isDeepStrictEqual(designState.minimumDeposit, wantedDeposit),
    () => design.saveMinimumDeposit(actor, workspaceId, { minimumDeposit: data.design.minimumDeposit, version: designState.version }));
  for (const desired of data.design.packages) {
    const existing = designState.packages.find((row) => row.code === desired.code);
    const keys = ["name", "pricingMethod", "rate", "currency", "includedRevisions", "includesSpacePlanning", "includesRenders", "inclusions", "position", "areaUnit", "requiredRoleCode",
      "reviewRoleCode", "unitDefinition"];
    await core.ensure("design package", `design package ${desired.code}`, async () => Boolean(existing) && keys.every((key) => String(existing![key] ?? "") === String(desired[key] ?? ""))
      && Boolean(existing!.rateFrom) === Boolean(desired.rateFrom),
      () => design.savePackage(actor, workspaceId, { ...(desired as Record<string, unknown>), ...(existing ? { id: existing.id, version: existing.version } : {}) } as never));
  }

  // The project workflow (Palm's stage map) as the default route.
  const workflows = core.get(ProjectWorkflowService);
  const templates = (await workflows.list(actor, workspaceId)) as { templates: Array<{ id: string; code: string; name: string; description: string; isDefault: boolean; status: string; version: number; stages: unknown[] }> };
  const existingWorkflow = templates.templates.find((row) => row.code === data.workflow.code);
  await core.ensure("project workflow", `workflow ${data.workflow.code}`, async () => Boolean(existingWorkflow) && existingWorkflow!.status === "active" && existingWorkflow!.isDefault
    && existingWorkflow!.name === data.workflow.name && existingWorkflow!.description === data.workflow.description && isDeepStrictEqual(existingWorkflow!.stages, data.workflow.stages),
  () => workflows.save(actor, workspaceId, existingWorkflow?.id ?? "f03a7996-b75a-52c4-b8cc-e7f04bf3e1c2",
    { version: existingWorkflow?.version ?? 0, code: data.workflow.code, name: data.workflow.name, description: data.workflow.description, isDefault: true, stages: data.workflow.stages }));

  // The client portal switched on, so clients can be invited.
  const portal = core.get(ClientPortalAdminService);
  const portalState = (await portal.settings(actor, workspaceId)) as { settings: { enabled: boolean; version: number } };
  await core.ensure("client portal", "client portal on", async () => portalState.settings.enabled,
    () => portal.saveSettings(actor, workspaceId, { version: portalState.settings.version, enabled: true }));
}
