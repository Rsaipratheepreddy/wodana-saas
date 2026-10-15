import { DesignPackagesService } from "../design/design-packages.service";
import { Dec } from "../catalog-core/decimal";
import { copyBuilderData } from "../quotation/quote-revision";
import { prefillDesignFeeQuote } from "../quotation/design-fee-line";
import { noticeQuoteStep } from "../quotation/quote-notices";
import { releasePhaseOnDealApproval, winOpportunityOnAcceptance } from "./quote-acceptance";
import { dealAmount, dealApprovalView, decideDealStep, openDealApproval } from "./deal-file-approval";
import { dealInsightFor } from "./deal-file-insight";
import { readCaseTeam } from "../project-core/project-team";
import { markProposalWon } from "../crm/opportunities/opportunity-proposals";
import { decisionEvidenceFile, decisionRecorder } from "./quote-decision-access";
import { extendQuoteValidity } from "./quote-expiry";
import { readDefaultPaymentPlan, startingMilestones } from "./default-payment-plan";
import { recordAudit } from "../audit/record-audit";
import { noticeReceiptStep, permissionHolderNames } from "./commercial-notices";
import { effectivePortalBrand } from "./effective-brand";
import { newQuoteDefaults } from "./quote-defaults";
import { tellClients } from "../client-portal/portal-notices";
import { commercialRepository } from "./commercial-repository";
import { DEAL_FIRST_WORKFLOW_CODE } from "../projects/deal-first-workflow";
import {
  importedScopeDetails,
  importedScopeCatalogLinks,
} from "./commercial-scope";
import { quotationTemplateContent } from "./quotation-template";
import { confirmCommissionAmounts, normalizeCommissionLines, opportunityProofPath, paymentProofLink } from "./deal-submission";
import { sameOffer, validateDeduction } from "./variation-controls";
import {
  controlledChangeCanRelease,
  controlledChangeForQuote,
  controlledChangeKinds,
  deductionDraftLine,
  dispositionsCoverImpact,
  isNonFinancialControlledChange,
  projectChangeImpact,
  sourceLinesForChange,
  validateControlledChangeSources,
} from "./change-control";
import { startJourney } from "../design/design-journey.store";
import { servicePathRoute, quotationNeedsSitePlan, type ServicePathScope } from "../projects/service-path-route";
import { casePlan } from "../pre-projects/case-plan";
import { resolvedProjectWorkflowTemplate } from "../projects/project-workflow.repository";
import { qsEstimateCurrent, qsEstimateHash } from "./qs-estimate";
import { activeAcceptedBaseQuote, beginMainRound } from "./service-path-rounds";
import { captureApprovedDesignBaseline } from "../projects/project-design-control";
import { ensureJobForSource } from "../jobs/job-identity.store";
import { verifiedInvoiceSnapshot } from "./accounting-invoice";
import {
  agreementMatchesFinanceContext,
  bindFinanceContext,
  paymentHasFinanceVerifiedReceipt,
  recordCreditNote,
  recordProviderSettlement,
  reportManualReceipt,
  reverseProviderSettlement,
  upsertProviderInvoiceDocument,
  verifyReceipt,
} from "./finance-ledger";
import {
  agreementIsOperational,
  agreementMatchesAcceptedQuote,
  approvedMaterialEvidence,
  financeGatePaymentsReady,
  agreementHasSignedEvidence,
  isOperationalEvidence,
  materialApprovalsComplete,
  materialListSignedOff,
  ownerReviewInputsReady,
  designDepositMessage,
  designDepositReady,
  quotationApprovalSources,
  releasePaymentIsOperational,
  dealPaymentProofReady,
  quoteHasVerifiedReceipt,
} from "./release-integrity";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { caseCurrency as currency, roundAmount, splitByPercent, sumAmounts } from "./case-money";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ConfigService } from "@nestjs/config";
import { CatalogSellingPriceService } from "./catalog-selling-price.service";
import { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";
import {
  acceptedQuoteTotals,
  acceptedQuoteValue,
  actionable,
  assertQuoteSnapshot,
  date,
  defaultBrand,
  editable,
  emptyCommercial,
  freezeHash,
  newRequest,
  number,
  object,
  parseBrand,
  parseCover,
  parseLines,
  parsePaymentTerms,
  parseQuotePresentation,
  phone,
  quoteDecisionEvidence,
  text,
  totals,
} from "./commercial.domain";
import type {
  CommercialData,
  CommercialState,
  QuoteDecisionEvidence,
  PortalSettings,
  Quote,
  QuotationTemplate,
  CatalogSelection,
  CatalogPriceSnapshot,
  ChangeDisposition,
  ControlledChangeKind,
  QuoteLine,
} from "./commercial.types";
import type { ProjectData } from "../projects/execution.types";
import { ConfigurationRevisionsService } from "../workspaces/configuration-revisions.service";
import type { RestoreConfigurationRevisionDto } from "../workspaces/dto/restore-configuration-revision.dto";
import { partyOfCase, recordClientMessageSkipped, sendClientEvent } from "../crm/conversations/inbox/client-messages";
import { contactEmailSql } from "../client-portal/contact-email";
import { beforeQuoteIssued, quotationEntityId, quotingEntity } from "../proposals/quote-issue";
import { budgetRange } from "../design/finishes.store";
import { quoteReviewAction } from "../proposals/qs-requirement";
import { checkOverBudget, settleQuietly } from "../value-engineering/value-engineering.store";
import { quoteReferences } from "./case-quote-facts";
import { dealFileReference } from "./deal-file-reference";
import { readLetterhead } from "../workspaces/entity-letterhead";

/** Remove internal cost and margin truth without mutating the persisted commercial aggregate. */
export function commercialDataForCostAccess(data: CommercialData, canViewCosts: boolean): CommercialData {
  if (canViewCosts) return data;
  return {
    ...data,
    quotes: data.quotes.map((quote) => ({ ...quote, lines: quote.lines.map((line) => ({ ...line, unitCost: 0 })) })),
    ...(data.dealFile ? { dealFile: { ...data.dealFile, cost: 0, margin: 0 } } : {}),
  };
}

/**
 * Whether a quotation needs the QS estimate before it's approved and sent: a deal-first quotation, where the firm's
 * QS rules (qs-requirement.ts) say so. Approving, sending and the page's approve button all ask this one question.
 */
export async function needsQsEstimate(db: Pick<PoolClient, "query">, workspaceId: string, caseId: string, data: Pick<CommercialData, "servicePath">, quote: Pick<Quote, "id" | "kind">) {
  return await quoteReviewAction(db, workspaceId, caseId, quote, Boolean(data.servicePath)) === "qs_approve";
}

/** The quotations in review that wait for the QS estimate (the page offers the QS approval for these only). */
async function qsEstimateQuoteIds(db: Pick<PoolClient, "query">, workspaceId: string, caseId: string, data: CommercialData) {
  const ids: string[] = [];
  for (const quote of data.quotes)
    if (quote.status === "internal_review" && await needsQsEstimate(db, workspaceId, caseId, data, quote)) ids.push(quote.id);
  return ids;
}

export function preserveUnauthorizedCosts(lines: QuoteLine[], previous: Map<string, QuoteLine>, canEditCosts: boolean) {
  if (canEditCosts) return lines;
  for (const line of lines) line.unitCost = previous.get(line.id)?.unitCost ?? 0;
  return lines;
}

const BUILDER_LINE_KEYS = ["kind", "description", "pricingMode", "note", "version", "areaId", "fromAreaId", "workPackageId", "catalogItemId", "catalogVariantId",
  "catalogSnapshot", "formula", "length", "width", "height", "count", "dimensionUnit", "markupPercent", "discountKind", "discountValue", "taxCode", "lineTaxRate", "optionGroup", "imageAssetId", "catalogImageId", "changeOp", "boqLineId"];

/**
 * What issuing a quote delivered (Q-22): it is always in the client's portal; `channel` is how they were told
 * (WhatsApp, email, or not at all), `emailed` who got the email, and `reason` why nothing went out.
 */
export type IssueDelivery = {
  portal: true; channel: "whatsapp" | "email" | null; emailed: string[]; reason: string | null; decider: string; deciderHasEmail: boolean;
};

/** The people who submitted or Finance-verified a deal may not approve it (separation of duties). */
export function dealSeparationBlocks(data: Pick<CommercialData, "ownerReview">, userId: string) {
  const review = data.ownerReview;
  return Boolean(review && (review.submittedById === userId || review.financeReviewedById === userId));
}

export function isManualQuotationLine(line: QuoteLine) {
  return !line.scopeId && !line.catalogLinks?.some((selection) => selection.role === "work");
}

export function commercialCommandPermission(action: string) {
  if (action === "qs_approve") return "commercial.estimate";
  if (["verify_payment", "verify_credit", "review_deal_finance"].includes(action))
    return "commercial.finance.verify";
  if (action === "decide_owner_review") return "commercial.deal.approve";
  // Approvers, Sales with commercial.record_decision and the case's owner record it (checked in the command, Q-24).
  if (action === "record_decision") return "pre_projects.view";
  if (["approve", "execute_agreement"].includes(action))
    return "commercial.approve";
  if (action === "release") return "commercial.release";
  // Sending a quote back is the reviewer's step too (a QS may not edit the case); checked in the command.
  if (action === "return") return "pre_projects.view";
  return "pre_projects.edit";
}

function dealInput<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof Error) throw new BadRequestException(error.message);
    throw error;
  }
}

export function manualLineAuthorizations(
  lines: QuoteLine[],
  previous: Map<string, QuoteLine>,
) {
  return lines.filter((line) => {
    if (!isManualQuotationLine(line)) {
      if (line.manualReason)
        throw new BadRequestException(
          "A manual-line reason belongs only to an item without confirmed scope or a catalogue source.",
        );
      return false;
    }
    const old = previous.get(line.id);
    return !old || !isManualQuotationLine(old) || line.manualReason !== old.manualReason;
  });
}

@Injectable()
export class CommercialService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly config: ConfigService,
    private readonly sellingPrices: CatalogSellingPriceService,
    private readonly preparationReadiness: PreProjectReadinessService,
    private readonly revisions: ConfigurationRevisionsService = new ConfigurationRevisionsService(),
  ) {}
  get testMode() {
    return (
      this.config.get("PORTAL_DEMO_OTP") === "true" &&
      this.config.get("NODE_ENV") !== "production"
    );
  }
  async caseRecord(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    lock = false,
  ) {
    const result = await client.query(
      `SELECT c.status,o.id AS "opportunityId",o.status AS "opportunityStatus",
        o.reference AS "opportunityReference",enquiry.reference AS "enquiryReference",
        enquiry.service_type AS "enquiryType",
        (SELECT proof.id FROM crm_opportunity_payment_proofs proof WHERE proof.workspace_id=o.workspace_id AND proof.opportunity_id=o.id ORDER BY proof.recorded_at DESC LIMIT 1) AS "paymentProofId",
        o.amount AS "opportunityValue",o.title,p.display_name AS "customerName",o.currency_code AS currency,
        (SELECT raw_value FROM crm_contact_points cp WHERE cp.workspace_id=p.workspace_id AND cp.party_id=p.id AND cp.type='email' AND cp.status='active' ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS "customerEmail",
        (SELECT raw_value FROM crm_contact_points cp WHERE cp.workspace_id=p.workspace_id AND cp.party_id=p.id AND cp.type='phone' AND cp.status='active' ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS "customerPhone",
        (SELECT concat_ws(', ',NULLIF(a.line1,''),NULLIF(a.line2,''),NULLIF(a.locality,''),NULLIF(a.region,''),NULLIF(a.country_code,'')) FROM crm_addresses a WHERE a.workspace_id=p.workspace_id AND a.party_id=p.id ORDER BY a.is_primary DESC,a.created_at LIMIT 1) AS "customerAddress",
        e.id AS "legalEntityId",e.code AS "legalEntityCode",e.display_name AS "legalEntityName",
        e.registered_name AS "legalEntityRegisteredName",e.country_code AS "legalEntityCountryCode",
        e.base_currency AS "legalEntityBaseCurrency",e.tax_registration_number AS "legalEntityTaxRegistrationNumber"
       FROM pre_project_cases c
       JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id
       LEFT JOIN crm_leads source_lead ON source_lead.workspace_id=o.workspace_id AND source_lead.id=o.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id=source_lead.workspace_id AND enquiry.id=source_lead.enquiry_id
       JOIN crm_parties p ON p.workspace_id=o.workspace_id AND p.id=o.party_id
       -- The opportunity's legal entity; when none was chosen and the firm has only one, that one.
       LEFT JOIN LATERAL (SELECT entity.* FROM legal_entities entity
          WHERE entity.workspace_id=o.workspace_id AND entity.status='active'
            AND (entity.id=o.legal_entity_id OR (o.legal_entity_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM legal_entities other WHERE other.workspace_id=o.workspace_id AND other.status='active' AND other.id<>entity.id)))
          LIMIT 1) e ON true
       WHERE c.workspace_id=$1 AND c.id=$2 ${lock ? "FOR UPDATE OF c" : ""}`,
      [workspaceId, caseId],
    );
    if (!result.rowCount)
      throw new NotFoundException("Pre-execution not found.");
    if (lock && !["active", "released"].includes(result.rows[0].status))
      throw new ConflictException("This pre-execution is not active. Resume or reopen it before making commercial changes.");
    return result.rows[0];
  }
  private async workspaceDate(client: PoolClient, workspaceId: string) {
    const result = await client.query(
      `SELECT to_char(now() AT TIME ZONE default_timezone,'YYYY-MM-DD') AS date
       FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    return String(result.rows[0]?.date ?? new Date().toISOString().slice(0, 10));
  }
  private async designReadiness(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    quote: Quote | undefined,
  ) {
    if (!quote) return { designsRequired: 0, designsApproved: 0 };
    let designsApproved = 0;
    const hasPackageLines = quote.lines.some((line) => !line.scopeId);
    const packageDesigns = hasPackageLines
      ? (await client.query<{ total: number; approved: number }>(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE version.status='approved' AND NOT EXISTS (
                    SELECT 1 FROM pre_project_design_threads thread
                    WHERE thread.workspace_id=version.workspace_id AND thread.version_id=version.id
                      AND thread.blocking AND thread.status='open'
                  ))::int AS approved
           FROM pre_project_designs design
           JOIN LATERAL (
             SELECT id,workspace_id,status FROM pre_project_design_versions
             WHERE workspace_id=design.workspace_id AND design_id=design.id
             ORDER BY number DESC LIMIT 1
           ) version ON true
           WHERE design.workspace_id=$1 AND design.case_id=$2
             AND design.archived_at IS NULL AND design.scope_entry_id IS NULL`,
          [workspaceId, caseId],
        )).rows[0]
      : null;
    for (const line of quote.lines) {
      if (!line.scopeId) {
        if (packageDesigns?.total && packageDesigns.total === packageDesigns.approved)
          designsApproved += 1;
        continue;
      }
      const design = await client.query(
        `SELECT count(*)::int AS total,count(*) FILTER (WHERE v.status='approved' AND NOT EXISTS(SELECT 1 FROM pre_project_design_threads t WHERE t.workspace_id=v.workspace_id AND t.version_id=v.id AND t.blocking AND t.status='open'))::int AS approved FROM pre_project_item_design_refs r JOIN pre_project_design_versions v ON v.workspace_id=r.workspace_id AND v.id=r.design_version_id WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.entry_id=$3 AND r.version=$4`,
        [workspaceId, caseId, line.scopeId, line.specificationVersion ?? 0],
      );
      const readiness = design.rows[0] as { total: number; approved: number };
      if (readiness.total > 0 && readiness.total === readiness.approved)
        designsApproved += 1;
    }
    return { designsRequired: quote.lines.length, designsApproved };
  }
  async load(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
  ): Promise<CommercialData> {
    const stored = (await commercialRepository.load(client, workspaceId, caseId))?.content;
    if (!stored) return emptyCommercial();
    return {
      ...emptyCommercial(),
      ...stored,
      ownerReview: stored.ownerReview ?? null,
      dealFile: stored.dealFile ?? null,
      materialApprovals: stored.materialApprovals ?? [],
      financeContext: stored.financeContext ?? null,
      financeDocuments: stored.financeDocuments ?? [],
      receipts: stored.receipts ?? [],
      allocations: stored.allocations ?? [],
      credits: stored.credits ?? [],
    };
  }
  async persist(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    data: CommercialData,
    actor: string,
    action: string,
    quoteId?: string,
    note = "",
    actorUserId: string | null = null,
  ) {
    data.revision++;
    data.audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      quoteId,
      note,
    });
    const verifiedBefore = new Set((await client.query<{ id: string }>(
      `SELECT id FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2 AND status = 'verified'`, [workspaceId, caseId])).rows.map((row) => row.id));
    await commercialRepository.save(client, workspaceId, caseId, data);
    // A payment verified in this save: the client gets the receipt on WhatsApp (once per payment).
    const received = data.payments.filter((payment) => payment.status === "verified" && !verifiedBefore.has(payment.id));
    // A staff command (a coded action) is in the audit trail too, so the record's history reads it: who sent the
    // quotation, who verified which payment of how much. Portal and e-sign saves are audited where they happen.
    if (/^[a-z_]+$/.test(action)) {
      const quote = quoteId ? data.quotes.find((item) => item.id === quoteId) : undefined;
      const verified = received[0];
      await recordAudit(client, { workspaceId, actorUserId, action: `commercial.${action}.v1`, entityType: "commercial_case", entityId: caseId, after: {
        quoteId: quoteId ?? null, number: quote ? `V${quote.number}` : null, note: note || null,
        ...(verified ? { amount: String(verified.amount), currency: verified.currency ?? quote?.currency ?? data.quotes[0]?.currency ?? null, payment: verified.title } : {}),
      } });
    }
    if (received.length) {
      const owner = await partyOfCase(client, workspaceId, caseId);
      for (const payment of received) {
        const result = await sendClientEvent(client, { workspaceId, event: "receivables.payment_received", partyId: owner.partyId, leadId: owner.leadId, recordKey: payment.id, record: { paymentId: payment.id }, config: this.config, actorUserId });
        if (!result.sent) await recordClientMessageSkipped(client, workspaceId, "receivables.payment_received", payment.id, result, false);
      }
    }
    for (const quote of data.quotes)
      await ensureJobForSource(client, workspaceId, { type: "quote", id: quote.id, caseId }, actorUserId);
    for (const payment of data.payments) {
      if (!payment.invoice) continue;
      const invoice = payment.invoice;
      await client.query(
        `INSERT INTO commercial_reconciliation_jobs(workspace_id,case_id,payment_id,connection_id,invoice_id,provider) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,case_id,payment_id) DO UPDATE SET connection_id=$4,invoice_id=$5,provider=$6`,
        [
          workspaceId,
          caseId,
          payment.id,
          invoice.connectionId,
          invoice.id,
          invoice.provider,
        ],
      );
    }
  }
  private async seedPreparationRooms(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    quote: Quote,
  ) {
    const rooms = (
      await client.query(
        `SELECT id,name,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot"
         FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 ORDER BY created_at,id`,
        [workspaceId, caseId],
      )
    ).rows as Array<{
      id: string;
      name: string;
      catalogRecordId?: string | null;
      catalogSnapshot?: CatalogSelection["snapshot"] | null;
    }>;
    quote.rooms ??= [];
    for (const room of rooms) {
      if (
        quote.rooms.some(
          (value) =>
            value.id === room.id ||
            value.name.toLowerCase() === room.name.toLowerCase(),
        )
      )
        continue;
      quote.rooms.push({
        id: room.id,
        name: room.name,
        ...(room.catalogRecordId && room.catalogSnapshot
          ? {
              catalog: {
                role: "room",
                recordId: room.catalogRecordId,
                version: room.catalogSnapshot.version,
                snapshot: room.catalogSnapshot,
              },
            }
          : {}),
      });
    }
  }
  async state(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
  ): Promise<CommercialState> {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      async (client, user) => {
        const record = await this.caseRecord(client, workspaceId, caseId);
        const data = await this.load(client, workspaceId, caseId);
        const servicePathEnabled = (await resolvedProjectWorkflowTemplate(client, workspaceId)).code === DEAL_FIRST_WORKFLOW_CODE;
        const canEditCosts = await this.access.hasPermission(
          client,
          workspaceId,
          user.userId,
          "commercial.costs.manage",
        );
        const canViewCosts =
          canEditCosts ||
          (await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.costs.view",
          ));
        const accepted = activeAcceptedBaseQuote(data);
        const releaseReadiness = await this.designReadiness(
          client,
          workspaceId,
          caseId,
          accepted,
        );
        for (const quote of data.quotes) {
          if (
            quote.kind === "quotation" &&
            quote.status === "draft" &&
            quote.direction !== "deduction" &&
            !quote.rooms?.length &&
            !quote.lines.length
          )
            await this.seedPreparationRooms(client, workspaceId, caseId, quote);
        }
        const contacts = (
          await client.query(
            `SELECT grant_row.id,coalesce(grant_row.confirmed_name,grant_row.name) AS name,grant_row.phone,${contactEmailSql("grant_row")} AS email,grant_row.role,grant_row.active,
                    grant_row.test_contact AS "testContact",grant_row.version FROM client_portal_grants grant_row WHERE grant_row.workspace_id=$1 AND grant_row.case_id=$2 ORDER BY grant_row.created_at`,
            [workspaceId, caseId],
          )
        ).rows;
        const settings = await client.query(
          "SELECT slug,enabled FROM client_portal_settings WHERE workspace_id=$1",
          [workspaceId],
        );
        const dealApproval = await dealApprovalView(client, workspaceId, data.ownerReview, user.userId);
        return {
          workspaceId,
          caseId,
          ...record,
          servicePathEnabled,
          data: commercialDataForCostAccess(data, canViewCosts),
          quoteReferences: (await quoteReferences(client, workspaceId, [caseId])).get(caseId) ?? {},
          // PLM-146: which quotations are a budget range, for the list's badge.
          budgetRangeQuoteIds: (await client.query<{ id: string }>(`SELECT quote_id AS id FROM quote_budget_ranges WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows.map((row) => row.id),
          dealApproval,
          dealInsight: await dealInsightFor(client, workspaceId, { caseId, opportunityId: record.opportunityId ? String(record.opportunityId) : null, data, canViewCosts,
            team: data.dealFile || data.ownerReview ? await readCaseTeam(client, workspaceId, caseId) : [] }),
          contacts,
          portalSlug: settings.rows[0]?.slug ?? null,
          portalBrand: await effectivePortalBrand(client, workspaceId),
          // The business a new quotation is issued by: its letterhead heads the preview (PLM-112).
          portalLetterhead: await readLetterhead(client, workspaceId, (await quotingEntity(client, workspaceId, caseId))?.id),
          portalEnabled: settings.rows[0]?.enabled ?? false,
          testMode: this.testMode,
          releaseReadiness,
          canEdit:
            ["active", "released"].includes(record.status) &&
            (await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "pre_projects.edit",
            )),
          canApprove: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.approve",
          ),
          canEstimate: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.estimate",
          ),
          qsEstimateQuoteIds: await qsEstimateQuoteIds(client, workspaceId, caseId, data),
          viewerId: user.userId,
          // Deal approval is a permission plus separation of duties, never a role name.
          canApproveDeal:
            (await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "commercial.deal.approve",
            )) && !dealSeparationBlocks(data, user.userId)
            // The engine decides who holds the current step (the Owner above an amount, a delegate, an escalation).
            && (dealApproval?.status !== "pending" || dealApproval.currentStep === 1 || dealApproval.canDecide),
          canVerifyFinance: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.finance.verify",
          ),
          canOverridePrice: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.override_price",
          ),
          canViewCosts,
          canEditCosts,
          canRelease: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.release",
          ),
          canManagePortal: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "portal.manage",
          ),
          canManageContacts:
            (await this.access.hasPermission(client, workspaceId, user.userId, "portal.manage")) ||
            (await this.access.hasPermission(client, workspaceId, user.userId, "portal.contacts.manage")),
          stepHolders: {
            verifyAgreement: await permissionHolderNames(client, workspaceId, "commercial.approve"),
            verifyPayment: await permissionHolderNames(client, workspaceId, "commercial.finance.verify"),
            approveDeal: await permissionHolderNames(client, workspaceId, "commercial.deal.approve"),
            startProject: await permissionHolderNames(client, workspaceId, "projects.manage"),
          },
        };
      },
    );
  }
  async syncInvoice(
    actor: RequestActor,
    w: string,
    caseId: string,
    input: unknown,
    authorization: string,
  ) {
    const b = object(input),
      connectionId = text(b.connectionId, 80, true),
      invoiceId = text(b.invoiceId, 100, true),
      paymentId = text(b.paymentId, 80, true);
    if (
      !/^[0-9a-f-]{36}$/i.test(connectionId) ||
      !/^[a-zA-Z0-9]{1,100}$/.test(invoiceId)
    )
      throw new BadRequestException("Choose a valid connection and invoice.");
    const connection = await this.access.withPermissions(
      actor,
      w,
      ["pre_projects.view", "commercial.finance.verify"],
      async (client) => {
        await this.caseRecord(client, w, caseId);
        const d = await this.load(client, w, caseId);
        const payment = d.payments.find((p) => p.id === paymentId);
        if (!payment)
          throw new NotFoundException("Payment milestone not found.");
        const c = (
          await client.query(
            "SELECT provider,status,legal_entity_id,configuration FROM integration_connections WHERE workspace_id=$1 AND id=$2",
            [w, connectionId],
          )
        ).rows[0];
        if (
          !c ||
          !["quickbooks", "zoho_books"].includes(c.provider) ||
          c.status !== "connected" ||
          !c.legal_entity_id
        )
          throw new ConflictException(
            "Connect the accounting company in Workspace settings first.",
          );
        if (
          !d.financeContext ||
          payment.legalEntityId !== d.financeContext.legalEntityId ||
          c.legal_entity_id !== d.financeContext.legalEntityId
        )
          throw new ConflictException(
            "Use the accounting connection for the legal entity that owns this agreement.",
          );
        return c;
      },
    );
    const base =
      this.config.get<string>("INTELLIGENCE_API_URL") ??
      this.config.get<string>("NEXT_PUBLIC_INTELLIGENCE_API_URL") ??
      "http://127.0.0.1:8001/api/v1";
    const response = await fetch(
      `${base.replace(/\/$/, "")}/integrations/providers/workspaces/${w}/connections/${connectionId}/invoices/${invoiceId}`,
      { headers: { authorization }, signal: AbortSignal.timeout(20000) },
    ).catch(() => null);
    if (!response?.ok)
      throw new ConflictException(
        "Accounting could not verify this invoice. Check the connection and try again.",
      );
    const invoice = object(await response.json());
    return this.access.withPermissions(
      actor,
      w,
      ["pre_projects.view", "commercial.finance.verify"],
      async (client, user) => {
        // One provider invoice can settle only one milestone across the workspace.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${w}:${connection.provider}:${invoice.accountId}:${invoiceId}`],
        );
        await this.caseRecord(client, w, caseId, true);
        const duplicate = await client.query(
          `SELECT payment.case_id FROM commercial_payments payment WHERE payment.workspace_id=$1 AND payment.detail->'invoice'->>'id'=$2 AND payment.detail->'invoice'->>'provider'=$3 AND (payment.detail->'invoice'->>'accountId'=$4 OR payment.detail->'invoice'->>'connectionId'=$5) AND NOT(payment.case_id=$6 AND payment.id=$7) LIMIT 1`,
          [
            w,
            invoiceId,
            connection.provider,
            invoice.accountId,
            connectionId,
            caseId,
            paymentId,
          ],
        );
        if (duplicate.rowCount)
          throw new ConflictException(
            "This invoice is already linked to another payment milestone. Choose that milestone to refresh it.",
          );
        const d = await this.load(client, w, caseId);
        if (b.revision !== d.revision)
          throw new ConflictException(
            "The payment schedule changed. Refresh and try again.",
          );
        const p = d.payments.find((p) => p.id === paymentId);
        if (!p) throw new NotFoundException("Payment milestone not found.");
        if (
          !d.financeContext ||
          !p.legalEntityId ||
          p.legalEntityId !== d.financeContext.legalEntityId ||
          connection.legal_entity_id !== d.financeContext.legalEntityId
        )
          throw new ConflictException(
            "Use the accounting connection for the legal entity that owns this agreement.",
          );
        if (
          d.payments.some(
            (x) =>
              x.id !== p.id &&
              x.invoice?.connectionId === connectionId &&
              x.invoice.id === invoiceId,
          )
        )
          throw new ConflictException(
            "This invoice is already linked to another milestone.",
          );
        if (
          d.payments.some(
            (x) => x.invoice && x.invoice.connectionId !== connectionId,
          )
        )
          throw new ConflictException(
            "Use the same accounting company for this agreement.",
          );
        if (!p.invoice?.accountId && b.clientConfirmed !== true)
          throw new BadRequestException(
            "Confirm that this invoice belongs to the client and milestone.",
          );
        if (
          p.invoice &&
          (p.invoice.id !== invoiceId ||
            p.invoice.connectionId !== connectionId)
        )
          throw new ConflictException(
            "This milestone already has an accounting invoice. Resolve any replacement through a controlled commercial correction.",
          );
        const q =
          d.quotes.find((q) => q.id === p.sourceQuoteId) ??
          d.quotes.find(
            (q) => q.kind === "quotation" && q.status === "accepted",
          );
        const { total, balance, status, paymentUrl, settled } =
          verifiedInvoiceSnapshot(invoice, {
            id: invoiceId,
            amount: p.amount,
            currency: q?.currency ?? "",
            accountId: p.invoice?.accountId,
          });
        p.invoice = {
          accountId: text(invoice.accountId, 100, true),
          connectionId,
          provider: connection.provider,
          id: invoiceId,
          number: text(invoice.number ?? invoiceId, 100),
          customer: text(invoice.customerName ?? "", 240),
          total,
          balance,
          currency: q!.currency,
          status,
          paymentUrl,
          refreshedAt: new Date().toISOString(),
        };
        const reconciledAt = p.invoice.refreshedAt;
        upsertProviderInvoiceDocument(
          d,
          p,
          {
            provider: connection.provider,
            connectionId,
            providerDocumentId: invoiceId,
            number: p.invoice.number,
            total,
            status,
          },
          reconciledAt,
        );
        p.reference = p.invoice.number || invoiceId;
        if (settled) {
          recordProviderSettlement(
            d,
            p,
            {
              provider: connection.provider,
              connectionId,
              providerDocumentId: invoiceId,
              reference: p.reference,
            },
            "Accounting provider",
            reconciledAt,
          );
        } else {
          const wasVerified = p.status === "verified";
          const reversed = reverseProviderSettlement(
            d,
            p,
            "The accounting provider no longer reports this invoice as settled.",
            reconciledAt,
          );
          if (wasVerified || reversed) {
          await client.query(
            `UPDATE project_execution SET content=jsonb_set(jsonb_set(jsonb_set(content,'{financeClosed}','false'::jsonb),'{financeEvidence}',to_jsonb('Accounting balance reopened; review settlement.'::text)),'{revision}',to_jsonb(revision+1)),revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND project_id IN(SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2)`,
            [w, caseId],
          );
          }
        }
        await this.persist(
          client,
          w,
          caseId,
          d,
          user.displayName,
          "invoice_refreshed",
          undefined,
          `${connection.provider} · ${invoiceId}`,
          user.userId,
        );
        return { data: d };
      },
    );
  }
  async paymentTemplates(actor: RequestActor, w: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => ({
        items: (
          await c.query(
            'SELECT id,name,version,milestones,status,updated_at AS "updatedAt" FROM commercial_payment_templates WHERE workspace_id=$1 AND status=\'active\' ORDER BY name',
            [w],
          )
        ).rows,
      }),
    );
  }
  async quotationTemplates(actor: RequestActor, w: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => ({
        items: (
          await c.query(
            'SELECT id,name,version,content,status,updated_at AS "updatedAt" FROM commercial_quotation_templates WHERE workspace_id=$1 AND status=\'active\' ORDER BY updated_at DESC LIMIT 100',
            [w],
          )
        ).rows,
      }),
    );
  }
  async saveQuotationTemplate(actor: RequestActor, w: string, input: unknown) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.edit",
      async (c, actorUser) => {
        const b = object(input),
          caseId = text(b.caseId, 80, true),
          name = text(b.name, 160, true);
        await this.caseRecord(c, w, caseId);
        const data = await this.load(c, w, caseId),
          quote = data.quotes.find((q) => q.id === text(b.quoteId, 80, true));
        if (!quote)
          throw new NotFoundException(
            "Save the quotation before making a template.",
          );
        if (quote.kind !== "quotation" || !quote.lines.length)
          throw new BadRequestException(
            "Use a quotation with at least one item as your template.",
          );
        const templateId = b.id ? text(b.id, 80, true) : randomUUID();
        const current = b.id ? await c.query(
          'SELECT id,name,version,content,status,updated_at AS "updatedAt" FROM commercial_quotation_templates WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [w, templateId],
        ) : { rowCount: 0, rows: [] };
        if (b.id && !current.rowCount) throw new NotFoundException("Quotation template not found.");
        if (current.rowCount && current.rows[0].status !== "active") throw new ConflictException("Archived quotation templates cannot be changed.");
        const version = number(b.version ?? 0);
        if ((current.rows[0]?.version ?? 0) !== version) throw new ConflictException("Template changed. Reload before saving.");
        if (current.rowCount) await this.revisions.ensureBaseline(c, {
          workspaceId: w, resourceType: "quotation_template", resourceId: templateId,
          sourceVersion: current.rows[0].version, snapshot: current.rows[0], actorUserId: actorUser.userId,
        });
        let result;
        try {
          result = current.rowCount
            ? await c.query(
              `UPDATE commercial_quotation_templates
               SET name=$1,content=$2,version=version+1,updated_at=now()
               WHERE workspace_id=$3 AND id=$4 AND version=$5 AND status='active'
               RETURNING id,name,version,content,status,updated_at AS "updatedAt"`,
              [name, JSON.stringify(quotationTemplateContent(quote)), w, templateId, version],
            )
            : await c.query(
              'INSERT INTO commercial_quotation_templates(id,workspace_id,name,content) VALUES($1,$2,$3,$4) RETURNING id,name,version,content,status,updated_at AS "updatedAt"',
              [templateId, w, name, JSON.stringify(quotationTemplateContent(quote))],
            );
        } catch (error) {
          if ((error as { code?: string }).code === "23505") throw new ConflictException("A template with this name already exists. Choose another name.");
          throw error;
        }
        if (!result.rowCount)
          throw new ConflictException(
            "Template changed. Reload before saving.",
          );
        await this.revisions.record(c, {
          workspaceId: w, resourceType: "quotation_template", resourceId: templateId,
          sourceVersion: result.rows[0].version, action: current.rowCount ? "saved" : "created",
          snapshot: result.rows[0], actorUserId: actorUser.userId,
        });
        return result.rows[0];
      },
    );
  }
  async prepareQuotationTemplate(actor: RequestActor, w: string, id: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => {
        const template: QuotationTemplate | undefined = (
          await c.query(
            'SELECT id,name,version,content,status,updated_at AS "updatedAt" FROM commercial_quotation_templates WHERE workspace_id=$1 AND id=$2 AND status=\'active\'',
            [w, id],
          )
        ).rows[0];
        if (!template)
          throw new NotFoundException("Quotation template not found.");
        const content = template.content,
          warnings = new Set<string>();
        const refs = [
          ...(content.rooms ?? []).flatMap((r) =>
            r.catalog ? [r.catalog] : [],
          ),
          ...content.lines.flatMap((l) => l.catalogLinks ?? []),
        ];
        const records = (
          await c.query(
            `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration,r.content->'commerce' AS commerce FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[]) AND NOT r.archived AND NOT c.archived`,
            [w, [...new Set(refs.map((r) => r.recordId))]],
          )
        ).rows;
        const selected = new Map(records.map((r) => [r.id, r]));
        const refresh = (ref: CatalogSelection): CatalogSelection | null => {
          const current = selected.get(ref.recordId);
          if (
            !current ||
            !(
              current.kind === ref.role ||
              (ref.role === "material" &&
                ["sku", "hardware", "consumable"].includes(current.kind))
            )
          ) {
            warnings.add(
              `${ref.snapshot.name} is unavailable. Its written specification is retained; choose a replacement if needed.`,
            );
            return null;
          }
          if (current.version !== ref.version)
            warnings.add(
              current.commerce
                ? `${current.name} uses the latest catalog version. Review the specification; its current verified selling price will be resolved when the quotation is saved.`
                : `${current.name} uses the latest catalog version. Review the specification; the template price is unchanged.`,
            );
          return {
            role: ref.role,
            recordId: current.id,
            version: current.version,
            snapshot: current,
          };
        };
        for (const room of content.rooms ?? [])
          if (room.catalog) room.catalog = refresh(room.catalog) ?? undefined;
        for (const line of content.lines) {
          const old = line.catalogLinks ?? [];
          line.catalogLinks = old.flatMap((ref) => {
            const current = refresh(ref);
            return current ? [current] : [];
          });
          for (const role of ["material", "finish"] as const) {
            const labels = (refs: CatalogSelection[]) =>
              refs
                .filter((r) => r.role === role)
                .map(
                  (r) =>
                    r.snapshot.name +
                    (r.snapshot.code ? ` · ${r.snapshot.code}` : ""),
                )
                .join("\n");
            const previous = labels(old),
              next = labels(line.catalogLinks);
            // Preserve unavailable products as written scope instead of silently deleting them.
            if (
              previous &&
              next &&
              old.filter((r) => r.role === role).length ===
                line.catalogLinks.filter((r) => r.role === role).length &&
              (line[role] === previous ||
                line[role].startsWith(previous + "\n\n"))
            )
              line[role] = next + line[role].slice(previous.length);
          }
          const unit = line.catalogLinks.find((r) => r.role === "unit");
          if (
            unit &&
            String(
              unit.snapshot.configuration?.symbol ?? unit.snapshot.code,
            ) !== line.unit
          ) {
            line.catalogLinks = line.catalogLinks.filter((r) => r !== unit);
            warnings.add(
              `The unit for ${line.title} changed in the catalog. The quoted unit and rate were preserved.`,
            );
          }
          const work = line.catalogLinks.find((r) => r.role === "work"),
            variant = line.catalogLinks.find((r) => r.role === "variant");
          if (variant) {
            const related = (
              await c.query(
                "SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='work'",
                [w, variant.recordId],
              )
            ).rows;
            if (
              !work ||
              (related.length &&
                !related.some((r) => r.target_id === work.recordId))
            ) {
              line.catalogLinks = line.catalogLinks.filter(
                (r) => r !== variant,
              );
              warnings.add(
                `Choose a matching catalog variant for ${line.title}.`,
              );
            }
          }
        }
        return { template, warnings: [...warnings] };
      },
    );
  }
  async savePaymentTemplate(actor: RequestActor, w: string, input: unknown) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.edit",
      async (c, actorUser) => {
        const b = object(input),
          name = text(b.name, 160, true),
          milestones = parsePaymentTerms(b.milestones, true),
          id = b.id ? text(b.id, 80, true) : randomUUID();
        const version = number(b.version ?? 0);
        const before = version > 0 ? await c.query(
          'SELECT id,name,version,milestones,status,updated_at AS "updatedAt" FROM commercial_payment_templates WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [w, id],
        ) : { rowCount: 0, rows: [] };
        if (version > 0 && (!before.rowCount || before.rows[0].version !== version || before.rows[0].status !== "active")) {
          throw new ConflictException("Template changed. Reload before saving.");
        }
        if (before.rowCount) await this.revisions.ensureBaseline(c, {
          workspaceId: w, resourceType: "payment_template", resourceId: id,
          sourceVersion: version, snapshot: before.rows[0], actorUserId: actorUser.userId,
        });
        const result = await c.query(
          `INSERT INTO commercial_payment_templates(id,workspace_id,name,version,milestones) VALUES($1,$2,$3,1,$4)
           ON CONFLICT(id) DO UPDATE SET name=$3,milestones=$4,version=commercial_payment_templates.version+1,updated_at=now()
           WHERE commercial_payment_templates.workspace_id=$2 AND commercial_payment_templates.version=$5 AND commercial_payment_templates.status='active'
           RETURNING id,name,version,milestones,status,updated_at AS "updatedAt"`,
          [id, w, name, JSON.stringify(milestones), version],
        );
        if (!result.rowCount)
          throw new ConflictException(
            "Template changed. Reload before saving.",
          );
        const saved = result.rows[0];
        await this.revisions.record(c, {
          workspaceId: w, resourceType: "payment_template", resourceId: id,
          sourceVersion: saved.version, action: version ? "saved" : "created", snapshot: saved,
          actorUserId: actorUser.userId,
        });
        return saved;
      },
    );
  }

  templateHistory(actor: RequestActor, workspaceId: string, kind: "quotation" | "payment", templateId: string) {
    const resourceType = kind === "quotation" ? "quotation_template" : "payment_template";
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", (client) =>
      this.revisions.history(client, workspaceId, resourceType, templateId));
  }

  archiveTemplate(
    actor: RequestActor,
    workspaceId: string,
    kind: "quotation" | "payment",
    templateId: string,
    input: unknown,
  ) {
    const version = number(object(input).version);
    const table = kind === "quotation" ? "commercial_quotation_templates" : "commercial_payment_templates";
    const resourceType = kind === "quotation" ? "quotation_template" : "payment_template";
    return this.access.withPermission(actor, workspaceId, "pre_projects.edit", async (client, actorUser) => {
      const before = await client.query(
        `SELECT id,name,version,${kind === "quotation" ? "content" : "milestones"},status,updated_at AS "updatedAt"
         FROM ${table} WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspaceId, templateId],
      );
      if (!before.rowCount || before.rows[0].status !== "active") throw new NotFoundException("Active template not found.");
      if (before.rows[0].version !== version) throw new ConflictException("Template changed. Reload before archiving.");
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType, resourceId: templateId, sourceVersion: version,
        snapshot: before.rows[0], actorUserId: actorUser.userId,
      });
      const result = await client.query(
        `UPDATE ${table} SET status='archived',version=version+1,updated_at=now()
         WHERE workspace_id=$1 AND id=$2 AND version=$3 AND status='active'
         RETURNING id,name,version,${kind === "quotation" ? "content" : "milestones"},status,updated_at AS "updatedAt"`,
        [workspaceId, templateId, version],
      );
      if (!result.rowCount) throw new ConflictException("Template changed. Reload before archiving.");
      await this.revisions.record(client, {
        workspaceId, resourceType, resourceId: templateId, sourceVersion: result.rows[0].version,
        action: "archived", snapshot: result.rows[0], actorUserId: actorUser.userId,
      });
      return result.rows[0];
    });
  }

  rollbackTemplate(
    actor: RequestActor,
    workspaceId: string,
    kind: "quotation" | "payment",
    templateId: string,
    input: RestoreConfigurationRevisionDto,
  ) {
    const table = kind === "quotation" ? "commercial_quotation_templates" : "commercial_payment_templates";
    const resourceType = kind === "quotation" ? "quotation_template" : "payment_template";
    const contentColumn = kind === "quotation" ? "content" : "milestones";
    return this.access.withPermission(actor, workspaceId, "pre_projects.edit", async (client, actorUser) => {
      const before = await client.query(
        `SELECT id,name,version,${contentColumn},status,updated_at AS "updatedAt"
         FROM ${table} WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspaceId, templateId],
      );
      if (!before.rowCount) throw new NotFoundException("Template not found.");
      if (before.rows[0].version !== input.version) throw new ConflictException("Template changed. Reload before restoring.");
      const revision = await this.revisions.requireRevision(client, workspaceId, resourceType, templateId, input.revisionId);
      const target = revision.snapshot;
      const name = text(target.name, 160, true);
      const status = target.status === "archived" ? "archived" : "active";
      const content = kind === "quotation"
        ? object(target.content)
        : parsePaymentTerms(target.milestones, true);
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType, resourceId: templateId, sourceVersion: before.rows[0].version,
        snapshot: before.rows[0], actorUserId: actorUser.userId,
      });
      let result;
      try {
        result = await client.query(
          `UPDATE ${table} SET name=$1,${contentColumn}=$2,status=$3,version=version+1,updated_at=now()
           WHERE workspace_id=$4 AND id=$5 AND version=$6
           RETURNING id,name,version,${contentColumn},status,updated_at AS "updatedAt"`,
          [name, JSON.stringify(content), status, workspaceId, templateId, input.version],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("Another template already uses this name.");
        throw error;
      }
      if (!result.rowCount) throw new ConflictException("Template changed. Reload before restoring.");
      await this.revisions.record(client, {
        workspaceId, resourceType, resourceId: templateId, sourceVersion: result.rows[0].version,
        action: "rolled_back", snapshot: result.rows[0], actorUserId: actorUser.userId,
        sourceRevisionId: revision.id,
      });
      return result.rows[0];
    });
  }

  private async importIncludedScope(
    client: import("pg").PoolClient,
    workspaceId: string,
    caseId: string,
    q: Quote,
    refreshExisting = false,
    entryIds?: string[],
  ) {
    const rows = await client.query(
      `SELECT e.id,e.version,e.title,e.note,e.quantity,e.unit,r.id AS room_id,r.catalog_record_id,r.catalog_snapshot,coalesce(r.name,'General') AS room,coalesce((SELECT jsonb_agg(jsonb_build_object('role',l.role,'recordId',l.record_id,'version',l.snapshot->'version','snapshot',l.snapshot)) FROM pre_project_scope_links l WHERE l.workspace_id=e.workspace_id AND l.entry_id=e.id),'[]') AS catalog_links,s.version AS specification_version,s.content AS specification FROM pre_project_brief_entries e LEFT JOIN pre_project_rooms r ON r.workspace_id=e.workspace_id AND r.id=e.room_id LEFT JOIN LATERAL(SELECT version,content FROM pre_project_item_specifications WHERE workspace_id=e.workspace_id AND entry_id=e.id AND case_id=e.case_id ORDER BY version DESC LIMIT 1)s ON true WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.kind='requirement' AND e.scope_status='included' AND e.archived_at IS NULL`,
      [workspaceId, caseId],
    );
    const selectedRows = entryIds ? rows.rows.filter(line => entryIds.includes(line.id)) : rows.rows;
    if (entryIds && selectedRows.length !== new Set(entryIds).size) throw new ConflictException("A selected requirement is no longer available or included. Reopen the import dialog and choose again.");
    for (const line of selectedRows) {
      const prior = q.lines.find((l) => l.scopeId === line.id);
      if (prior && !refreshExisting) continue;
      q.rooms ??= [];
      if (line.room_id && !q.rooms.some((r) => r.name === line.room))
        q.rooms.push({
          id: line.room_id,
          name: line.room,
          ...(line.catalog_snapshot
            ? {
                catalog: {
                  role: "room",
                  recordId: line.catalog_record_id,
                  version: line.catalog_snapshot.version,
                  snapshot: line.catalog_snapshot,
                },
              }
            : {}),
        });
      const next = {
        id: prior?.id ?? randomUUID(),
        room: line.room,
        title: line.title,
        ...importedScopeDetails({
          note: line.note,
          specification: line.specification,
          catalogLinks: line.catalog_links,
        }),
        quantity: Number(line.quantity ?? 1),
        unit: line.unit || "nos",
        unitCost: prior?.unitCost ?? 0,
        rate: prior?.rate ?? 0,
        ...(prior
          ? {
              materialRows: prior.materialRows,
              pricingMode: prior.pricingMode,
              photo: prior.photo,
              variant: prior.variant,
              customMaterials: prior.customMaterials,
            }
          : {}),
        catalogLinks: importedScopeCatalogLinks({
          catalogLinks: line.catalog_links,
          specification: line.specification,
        }),
        scopeId: line.id,
        scopeVersion: line.version,
        specificationVersion: line.specification_version ?? undefined,
      };
      if (next.catalogLinks.length > 12)
        throw new BadRequestException(
          `“${line.title}” has more than 12 catalog selections. Split its scope into separate items before importing.`,
        );
      if (prior) Object.assign(prior, next);
      else q.lines.push(next);
    }
    return selectedRows.length;
  }
  catalogOptions(
    actor: RequestActor,
    w: string,
    caseId: string,
    q: Record<string, string>,
  ) {
    const kind = text(q.kind ?? "work", 30, true),
      search = text(q.search ?? "", 180),
      linked = text(q.linkedTo ?? "", 80),
      catalog = text(q.catalogId ?? "", 80);
    if (
      ![
        "room",
        "work",
        "variant",
        "material",
        "brand",
        "finish",
        "unit",
        "construction",
        "hardware",
      ].includes(kind)
    )
      throw new BadRequestException("Choose a catalog type.");
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        return {
          items: (
            await client.query(
              `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",r.content->'attributes' AS attributes,CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration,r.content->'commerce' AS commerce,r.content->>'description' AS description,
      (SELECT jsonb_build_object('id',asset.id,'recordId',asset.catalog_record_id,'name',asset.original_name,'mimeType',asset.mime_type,'hasPreview',asset.preview_key IS NOT NULL) FROM workspace_catalog_assets asset WHERE asset.workspace_id=r.workspace_id AND asset.catalog_record_id=r.id AND asset.status='active' AND asset.role='primary_image' ORDER BY asset.sort_order,asset.created_at,asset.id LIMIT 1) AS "primaryAsset",
      coalesce((SELECT jsonb_agg(jsonb_build_object('role',l.relation,'recordId',t.id,'snapshot',jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'kind',t.kind,'version',t.version,'catalogId',t.catalog_id,'catalogName',tc.name,'configuration',CASE WHEN t.kind='unit' THEN coalesce(t.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(t.content->'configuration'->>'symbol',t.content->'aliases'->>0,t.code)) ELSE t.content->'configuration' END))) FROM workspace_catalog_links l JOIN workspace_catalog_records t ON t.workspace_id=l.workspace_id AND t.id=l.target_id JOIN workspace_catalog_records tc ON tc.workspace_id=t.workspace_id AND tc.id=t.catalog_id WHERE l.workspace_id=r.workspace_id AND l.record_id=r.id AND l.relation IN ('unit','work','variant','material','finish','brand','construction') AND NOT t.archived AND NOT tc.archived),'[]'::jsonb) AS links
      FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND (r.kind=$2 OR ($2='material' AND r.kind IN ('sku','hardware','consumable'))) AND NOT r.archived AND NOT c.archived AND ($3='' OR strpos(lower(r.name||' '||r.code||' '||c.name),lower($3))>0) AND ($4='' OR r.catalog_id::text=$4) AND ($5='' OR EXISTS(SELECT 1 FROM workspace_catalog_links l WHERE l.workspace_id=r.workspace_id AND ((l.record_id=r.id AND l.target_id::text=$5) OR (l.target_id=r.id AND l.record_id::text=$5)))) ORDER BY r.name,r.id LIMIT 100`,
              [w, kind, search, catalog, linked],
            )
          ).rows,
        };
      },
    );
  }
  async masterCatalog(actor: RequestActor, w: string, caseId: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        const result = await client.query(
          `SELECT id AS "catalogId" FROM workspace_catalog_records
        WHERE workspace_id=$1 AND kind='catalog_group' AND NOT archived
        ORDER BY CASE WHEN content->'attributes' @> '[{"name":"Default catalog","value":"true"}]'::jsonb THEN 0 ELSE 1 END,name,id LIMIT 1`,
          [w],
        );
        return result.rows[0] ?? {};
      },
    );
  }
  async catalogItemContext(
    actor: RequestActor,
    w: string,
    caseId: string,
    workId: string,
  ) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        // Follow only the selected item's recipe, variants, materials, units and prices.
        // Never traverse room membership, which would expand into unrelated items.
        const catalogs = await client.query(
          `WITH RECURSIVE edges(source,target) AS (
        SELECT l.record_id,l.target_id FROM workspace_catalog_links l
        JOIN workspace_catalog_records r ON r.workspace_id=l.workspace_id AND r.id=l.record_id
        WHERE l.workspace_id=$1 AND (l.relation='unit'
          OR (r.kind IN ('work','variant','construction') AND l.relation IN ('material','sku','hardware','consumable','finish','construction'))
          OR (r.kind='construction' AND l.relation='variant'))
        UNION
        SELECT l.target_id,l.record_id FROM workspace_catalog_links l
        JOIN workspace_catalog_records r ON r.workspace_id=l.workspace_id AND r.id=l.record_id
        WHERE l.workspace_id=$1 AND ((r.kind IN ('construction','variant') AND l.relation='work')
          OR (r.kind='construction' AND l.relation='parent')
          OR (r.kind='rate_card' AND l.relation IN ('work','variant','material','sku','hardware','consumable','finish')))
      ), scoped(id) AS (
        SELECT r.id FROM workspace_catalog_records r JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id
        WHERE r.workspace_id=$1 AND r.id=$2 AND r.kind='work' AND NOT r.archived AND NOT parent.archived
        UNION SELECT e.target FROM scoped s JOIN edges e ON e.source=s.id
      )
      SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",parent.name AS "catalogName",r.content
      FROM scoped s JOIN workspace_catalog_records r ON r.id=s.id AND r.workspace_id=$1
      JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id
      WHERE NOT r.archived AND NOT parent.archived ORDER BY r.kind,r.name,r.id`,
          [w, workId],
        );
        if (!catalogs.rows.length)
          throw new NotFoundException("Item not found in Master Data.");
        const links = await client.query(
          `SELECT record_id AS "recordId",target_id AS "targetId",relation FROM workspace_catalog_links
        WHERE workspace_id=$1 AND record_id=ANY($2::uuid[]) AND target_id=ANY($2::uuid[])`,
          [w, catalogs.rows.map((r) => r.id)],
        );
        return { catalogs: catalogs.rows, links: links.rows };
      },
    );
  }
  async catalogContext(actor: RequestActor, w: string, caseId: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => {
        const record = await this.caseRecord(c, w, caseId);
        const data = await this.load(c, w, caseId);
        const catalogs = await c.query(
          `SELECT r.id,r.name,r.code,r.kind,r.version,r.updated_at AS "updatedAt",r.catalog_id AS "catalogId",parent.name AS "catalogName",r.content,
            (SELECT jsonb_build_object('id',asset.id,'recordId',asset.catalog_record_id,'name',asset.original_name,'mimeType',asset.mime_type,'hasPreview',asset.preview_key IS NOT NULL) FROM workspace_catalog_assets asset WHERE asset.workspace_id=r.workspace_id AND asset.catalog_record_id=r.id AND asset.status='active' AND asset.role='primary_image' ORDER BY asset.sort_order,asset.created_at,asset.id LIMIT 1) AS "primaryAsset"
           FROM workspace_catalog_records r LEFT JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id WHERE r.workspace_id=$1 AND NOT r.archived AND (r.kind='catalog_group' OR (parent.id IS NOT NULL AND NOT parent.archived)) ORDER BY r.kind,r.name`,
          [w],
        );
        const links = (
          await c.query(
            'SELECT record_id AS "recordId",target_id AS "targetId",relation FROM workspace_catalog_links WHERE workspace_id=$1',
            [w],
          )
        ).rows;
        const scope = (
          await c.query(
            `SELECT e.id,e.title,e.quantity,e.unit,e.version,e.scope_status AS "scopeStatus",s.content AS specification,s.version AS "specificationVersion" FROM pre_project_brief_entries e LEFT JOIN LATERAL(SELECT content,version FROM pre_project_item_specifications WHERE workspace_id=e.workspace_id AND case_id=e.case_id AND entry_id=e.id ORDER BY version DESC LIMIT 1)s ON true WHERE e.workspace_id=$1 AND e.case_id=$2 AND NOT e.archived_at IS NOT NULL AND e.kind='requirement'`,
            [w, caseId],
          )
        ).rows;
        return {
          fetchedAt: new Date().toISOString(),
          case: { title: record.title, currency: record.currency },
          scope,
          quotations: data.quotes,
          paymentTemplates: (
            await c.query(
              "SELECT id,name,version,milestones FROM commercial_payment_templates WHERE workspace_id=$1",
              [w],
            )
          ).rows,
          catalogs: catalogs.rows,
          links,
          totalCatalogRecords: catalogs.rowCount,
        };
      },
    );
  }
  async catalogPrice(
    actor: RequestActor,
    w: string,
    caseId: string,
    input: unknown,
  ) {
    const b = object(input);
    for (const [id, version, label] of [
      [b.variantId, b.variantVersion, "variant"],
      [b.unitId, b.unitVersion, "unit"],
      [b.rateZoneId, b.rateZoneVersion, "pricing zone"],
    ] as const)
      if (Boolean(id) !== Boolean(version))
        throw new BadRequestException(
          `Select the current version of the ${label}.`,
        );
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        return this.sellingPrices.resolve(client, w, {
          catalogId: uuid(b.catalogId, "catalog"),
          workId: uuid(b.workId, "catalog item"),
          workVersion: number(b.workVersion, 1e8, 1),
          ...(b.variantId !== undefined
            ? {
                variantId: uuid(b.variantId, "variant"),
                variantVersion: number(b.variantVersion, 1e8, 1),
              }
            : {}),
          ...(b.unitId !== undefined
            ? {
                unitId: uuid(b.unitId, "unit"),
                unitVersion: number(b.unitVersion, 1e8, 1),
              }
            : {}),
          ...(b.unitLabel !== undefined
            ? { unitLabel: text(b.unitLabel, 20, true) }
            : {}),
          ...(b.rateZoneId !== undefined
            ? {
                rateZoneId: uuid(b.rateZoneId, "pricing zone"),
                rateZoneVersion: number(b.rateZoneVersion, 1e8, 1),
              }
            : {}),
          quantity: number(b.quantity, 1e6, 0.0001),
          currency: currency(b.currency),
          pricingDate:
            b.pricingDate === undefined
              ? await this.workspaceDate(client, w)
              : date(b.pricingDate),
          taxRate: number(b.taxRate ?? 0, 100),
        });
      },
    );
  }
  async command(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    input: unknown,
  ) {
    const b = object(input),
      action = text(b.action, 50, true);
    const permission = commercialCommandPermission(action);
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", permission],
      async (client, user) => {
        const record = await this.caseRecord(client, workspaceId, caseId, true);
        if (!["active", "released"].includes(record.status))
          throw new ConflictException("This case is not editable.");
        const data = await this.load(client, workspaceId, caseId);
        if (number(b.revision) !== data.revision)
          throw new ConflictException(
            "Someone updated this case. Reload to see the latest changes.",
          );
        let q = b.quoteId
          ? data.quotes.find((q) => q.id === b.quoteId)
          : undefined;
        // A change request's variation moves with its change (priced in the builder, approved, sent and decided there).
        if (q?.changeRequestId && ["save", "submit", "approve", "qs_approve", "return", "issue", "withdraw", "record_decision", "revise"].includes(action))
          throw new ConflictException("This variation belongs to a change request. Open the change request to move it on.");
        const now = new Date().toISOString();
        /** What issuing a quote actually delivered (Q-22): always the portal, and the emails that were queued. */
        let sent: IssueDelivery | undefined;
        /** Who recorded a client's decision given outside the portal (Q-24). */
        let recorder: "approver" | "sales" | null = null;
        // The deal-first service path (Q-37); "set_palm_flow" is its former name, still accepted from older clients.
        if (action === "set_service_path" || action === "set_palm_flow") {
          const template = await resolvedProjectWorkflowTemplate(client, workspaceId);
          if (template.code !== DEAL_FIRST_WORKFLOW_CODE)
            throw new BadRequestException("This project flow is not configured for this workspace.");
          if (data.quotes.length || data.dealFile)
            throw new ConflictException("Choose the service path before preparing a quotation.");
          const supplied = object(b.scope);
          const keys: Array<keyof ServicePathScope> = [
            "design", "mainQuotation", "materialSelection", "procurement",
            "manufacturing", "siteWorks", "installation",
          ];
          const scope = Object.fromEntries(keys.map((key) => {
            if (typeof supplied[key] !== "boolean")
              throw new BadRequestException(`Choose whether ${key} applies to this enquiry.`);
            return [key, supplied[key]];
          })) as ServicePathScope;
          try {
            servicePathRoute(scope);
          } catch (error) {
            throw new BadRequestException(error instanceof Error ? error.message : "Invalid service path.");
          }
          data.servicePath = { scope, selectedAt: now, selectedBy: user.userId, designMinimumDeposit: await DesignPackagesService.minimumDeposit(client, workspaceId) };
        } else if (action === "create_change_case") {
          const kind = text(b.kind, 40, true) as ControlledChangeKind;
          if (!controlledChangeKinds.includes(kind))
            throw new BadRequestException("Choose a valid change type.");
          if (!Array.isArray(b.sourceLineIds) || b.sourceLineIds.length > 100)
            throw new BadRequestException("Choose up to 100 affected contract items.");
          const sourceLineIds = b.sourceLineIds.map((id) => text(id, 80, true));
          validateControlledChangeSources(data, kind, sourceLineIds);
          const activeSources = new Set(
            data.requests
              .filter(
                (request) =>
                  request.control &&
                  !["resolved", "declined", "withdrawn"].includes(
                    request.status,
                  ),
              )
              .flatMap((request) => request.control!.sourceLineIds),
          );
          if (sourceLineIds.some((id) => activeSources.has(id)))
            throw new ConflictException(
              "An open Change Case already controls one of those contract items.",
            );
          const request = newRequest(
            data,
            text(b.title, 240, true),
            text(b.detail, 6000, true),
            undefined,
            undefined,
            { name: user.displayName, client: false },
          );
          request.owner = text(b.owner ?? "", 160);
          request.dueDate = b.dueDate ? date(b.dueDate) : "";
          request.status = "under_review";
          request.control = {
            kind,
            sourceLineIds,
            quoteIds: [],
            dispositions: [],
          };
        } else if (action === "assess_change_case") {
          const request = data.requests.find((item) => item.id === b.requestId);
          if (!request?.control)
            throw new NotFoundException("Controlled Change Case not found.");
          if (["resolved", "declined", "withdrawn"].includes(request.status))
            throw new ConflictException("A closed Change Case cannot be reassessed.");
          if (
            request.control.quoteIds.some((quoteId) => {
              const quote = data.quotes.find((item) => item.id === quoteId);
              return quote && quote.status !== "draft";
            })
          )
            throw new ConflictException(
              "Return the linked draft documents before changing the impact assessment.",
            );
          const project = await client.query<{
            id: string;
            content: ProjectData | null;
          }>(
            `SELECT project.id,execution.content
             FROM delivery_projects project
             LEFT JOIN project_execution_view execution
               ON execution.workspace_id=project.workspace_id
              AND execution.project_id=project.id
             WHERE project.workspace_id=$1 AND project.case_id=$2`,
            [workspaceId, caseId],
          );
          if (!project.rowCount) {
            request.control.impact = {
              assessedAt: now,
              projectId: "pre-execution",
              sourceLineIds: [...request.control.sourceLineIds],
              targets: [],
              bookingCount: 0,
              hasReportedOrCompletedWork: false,
            };
          } else {
            const projectId = project.rows[0].id;
            const bookingCount = await client.query<{ count: number }>(
              `SELECT count(*)::int AS count
               FROM project_bookings
               WHERE workspace_id=$1 AND project_id=$2
                 AND status IN ('tentative','confirmed')`,
              [workspaceId, projectId],
            );
            const content = project.rows[0].content ?? ({} as ProjectData);
            const projectData = {
              ...content,
              tasks: content.tasks ?? [],
              reports: content.reports ?? [],
              orders: content.orders ?? [],
              materials: content.materials ?? [],
              workPackages: content.workPackages ?? [],
            } as ProjectData;
            request.control.impact = projectChangeImpact(
              projectId,
              projectData,
              request.control.sourceLineIds,
              now,
              bookingCount.rows[0]?.count ?? 0,
            );
          }
          request.control.dispositions = [];
        } else if (action === "set_change_dispositions") {
          const request = data.requests.find((item) => item.id === b.requestId);
          if (!request?.control)
            throw new NotFoundException("Controlled Change Case not found.");
          if (!request.control.impact)
            throw new ConflictException(
              "Assess the operational impact before recording dispositions.",
            );
          if (
            request.control.quoteIds.some((quoteId) => {
              const quote = data.quotes.find((item) => item.id === quoteId);
              return quote && quote.status !== "draft";
            })
          )
            throw new ConflictException(
              "Return the linked draft documents before changing dispositions.",
            );
          if (!Array.isArray(b.dispositions) || b.dispositions.length > 300)
            throw new BadRequestException("Provide the disposition for each impacted record.");
          const dispositions = b.dispositions.map((input) => {
            const value = object(input);
            const targetKind = text(value.targetKind, 30, true);
            if (![
              "work_package",
              "task",
              "order",
              "material",
              "booking",
            ].includes(targetKind))
              throw new BadRequestException("Choose a valid impacted record type.");
            const action = text(value.action, 40, true);
            if (![
              "cancel",
              "hold_and_replan",
              "return_or_credit",
              "retain_as_stock",
              "rework",
              "complete_as_client_owned",
            ].includes(action))
              throw new BadRequestException("Choose a valid change disposition.");
            return {
              targetKind: targetKind as ChangeDisposition["targetKind"],
              targetId: text(value.targetId, 120, true),
              action: action as ChangeDisposition["action"],
              note: text(value.note, 3000, true),
            };
          });
          if (!dispositionsCoverImpact(request.control.impact, dispositions))
            throw new ConflictException(
              "Record one disposition for every impacted work package, task, order, material, and booking.",
            );
          request.control.dispositions = dispositions;
        } else if (action === "withdraw_change_case") {
          const request = data.requests.find((item) => item.id === b.requestId);
          if (!request?.control)
            throw new NotFoundException("Controlled Change Case not found.");
          const caseQuotes = request.control.quoteIds
            .map((quoteId) => data.quotes.find((quote) => quote.id === quoteId))
            .filter((quote): quote is Quote => Boolean(quote));
          if (caseQuotes.some((quote) => quote.status === "accepted"))
            throw new ConflictException(
              "An accepted Change Case cannot be withdrawn. Create a corrective Change Case instead.",
            );
          if (!caseQuotes.some((quote) => quote.status === "issued"))
            throw new ConflictException("There is no issued Change Case document to withdraw.");
          for (const quote of caseQuotes)
            if (quote.status === "issued") quote.status = "withdrawn";
          request.status = "under_review";
          request.resolution = "";
        } else if (action === "restart_change_case") {
          const request = data.requests.find((item) => item.id === b.requestId);
          if (!request?.control)
            throw new NotFoundException("Controlled Change Case not found.");
          if (["resolved", "declined", "withdrawn"].includes(request.status))
            throw new ConflictException("A closed Change Case cannot be restarted.");
          const caseQuotes = request.control.quoteIds
            .map((quoteId) => data.quotes.find((quote) => quote.id === quoteId))
            .filter((quote): quote is Quote => Boolean(quote));
          if (caseQuotes.some((quote) => quote.status === "accepted"))
            throw new ConflictException(
              "This Change Case already has an accepted document. Create a corrective Change Case instead.",
            );
          if (
            caseQuotes.some((quote) =>
              ["issued", "internal_review", "internal_approved"].includes(
                quote.status,
              ),
            )
          )
            throw new ConflictException(
              "Withdraw or return every client document before restarting the Change Case.",
            );
          request.control.quoteIds = [];
          delete request.quoteId;
          delete request.control.impact;
          request.control.dispositions = [];
          request.status = "under_review";
          request.resolution = "";
        } else if (action === "prepare_change_variations") {
          const request = data.requests.find((item) => item.id === b.requestId);
          if (!request?.control)
            throw new NotFoundException("Controlled Change Case not found.");
          if (["resolved", "declined", "withdrawn"].includes(request.status))
            throw new ConflictException("A closed Change Case cannot create new documents.");
          if (request.control.quoteIds.length)
            throw new ConflictException(
              "This Change Case already has controlled draft documents. Create a new case for a materially different request.",
            );
          if (!request.control.impact)
            throw new ConflictException(
              "Assess the operational impact before preparing client documents.",
            );
          if (
            !dispositionsCoverImpact(
              request.control.impact,
              request.control.dispositions,
            )
          )
            throw new ConflictException(
              "Record a disposition for every impacted item before preparing the client documents.",
            );
          if (
            data.quotes.some((quote) =>
              ["draft", "internal_review", "internal_approved"].includes(
                quote.status,
              ),
            )
          )
            throw new ConflictException(
              "Finish or return the existing working quotation before preparing a Change Case.",
            );
          validateControlledChangeSources(
            data,
            request.control.kind,
            request.control.sourceLineIds,
          );
          const base = data.quotes.find(
            (quote) => quote.kind === "quotation" && quote.status === "accepted",
          );
          if (!base)
            throw new ConflictException(
              "Accept the original quotation before preparing a controlled change.",
            );
          const financialDirection = text(b.financialDirection ?? "", 20);
          if (
            request.control.kind === "price_correction" &&
            !["addition", "deduction"].includes(financialDirection)
          )
            throw new BadRequestException(
              "Choose whether the price correction is an additional charge or a credit.",
            );
          const changeNeedsDeduction =
            request.control.kind === "removal" ||
            request.control.kind === "replacement" ||
            (request.control.kind === "price_correction" &&
              financialDirection === "deduction");
          if (changeNeedsDeduction && !request.control.sourceLineIds.length)
            throw new ConflictException(
              "Choose the accepted contract item that this credit or replacement affects.",
            );
          const deductions = changeNeedsDeduction
            ? sourceLinesForChange(data, request.control.sourceLineIds).map(
                ({ line, remainingQuantity }) =>
                  deductionDraftLine(line, remainingQuantity),
              )
            : [];
          let nextVariationNumber = Math.max(
            0,
            ...data.quotes.map((quote) => quote.number),
          );
          const createVariation = (
            direction: "addition" | "deduction",
            title: string,
            lines: Quote["lines"],
            nonFinancial = false,
          ): Quote => ({
            id: randomUUID(),
            number: ++nextVariationNumber,
            kind: "variation",
            direction,
            familyId: base.familyId ?? base.id,
            baselineId: base.id,
            definitionBaseline: base.definitionBaseline,
            status: "draft",
            title,
            cover: structuredClone(base.cover),
            presentation: base.presentation
              ? structuredClone(base.presentation)
              : undefined,
            inclusions: base.inclusions,
            currency: base.currency,
            validUntil: new Date(Date.now() + 30 * 86400000)
              .toISOString()
              .slice(0, 10),
            discount: 0,
            taxRate: base.taxRate,
            terms: `${base.terms}\n\nChange Case C${request.number}: ${request.title}\n${request.detail}`.slice(
              0,
              10000,
            ),
            exclusions: base.exclusions,
            lines,
            requestIds: [request.id],
            paymentTerms:
              direction === "deduction" || nonFinancial
                ? []
                : structuredClone(base.paymentTerms ?? []),
            paymentTemplate: base.paymentTemplate,
            rooms: [],
            createdAt: now,
            total: 0,
          });
          const nonFinancial = isNonFinancialControlledChange(
            request.control.kind,
          );
          const variations: Quote[] =
            request.control.kind === "replacement"
              ? [
                  createVariation(
                    "deduction",
                    `Change C${request.number} · remove / replace`,
                    deductions,
                  ),
                  createVariation(
                    "addition",
                    `Change C${request.number} · replacement scope`,
                    [],
                  ),
                ]
              : [
                  createVariation(
                    changeNeedsDeduction ? "deduction" : "addition",
                    `Change C${request.number} · ${request.title}`,
                    deductions,
                    nonFinancial,
                  ),
                ];
          request.control.quoteIds = variations.map((variation) => variation.id);
          request.quoteId = variations[0].id;
          request.status = "under_review";
          data.quotes.push(...variations);
          q = variations[0];
        } else if (["create", "revise", "variation"].includes(action)) {
          // A change request's variation is its own working document; it never holds up the case's next version.
          if (
            data.quotes.some((q) => !q.changeRequestId &&
              ["draft", "internal_review", "internal_approved"].includes(
                q.status,
              ),
            )
          )
            throw new ConflictException(
              "Finish or return to the existing working version first.",
            );
          if (action === "revise" && (!q || q.status === "accepted"))
            throw new ConflictException(
              "Accepted quotations require a variation.",
            );
          if (
            action === "variation" &&
            (!q || q.status !== "accepted" || q.kind !== "quotation")
          )
            throw new ConflictException(
              "Accept the base quotation before creating a variation.",
            );
          const kind =
            action === "variation" ? "variation" : (q?.kind ?? "quotation");
          const mainRound = action === "create" && data.quotes.length > 0 && Boolean(data.servicePath);
          if (action === "create" && data.quotes.length && !mainRound)
            throw new ConflictException("Use Create revision for the existing quotation.");
          if (mainRound) beginMainRound(data);
          if (action === "create" &&
              (await resolvedProjectWorkflowTemplate(client, workspaceId)).code === DEAL_FIRST_WORKFLOW_CODE &&
              !data.servicePath)
            throw new ConflictException("Choose the enquiry's service path before preparing its quotation.");
          const defaults = await newQuoteDefaults(client, workspaceId, caseId);
          // A first quote starts with the firm's default payment plan; revisions and variations keep their source's (Q-34).
          const plan = action === "create" && !q?.paymentTerms?.length ? startingMilestones(await readDefaultPaymentPlan(client, workspaceId)) : null;
          q = {
            id: randomUUID(),
            number: Math.max(0, ...data.quotes.map((q) => q.number)) + 1,
            kind,
            round: action === "create" && data.servicePath
              ? mainRound ? "main" : servicePathRoute(data.servicePath.scope).firstPaidRound
              : q?.round,
            direction: action === "variation" ? "addition" : q?.direction,
            familyId: action === "revise" ? (q?.familyId ?? q?.id) : undefined,
            baselineId: action === "variation" ? q?.id : q?.baselineId,
            definitionBaseline: q?.definitionBaseline,
            status: "draft",
            title:
              action === "variation"
                ? "Additional work"
                : (q?.title ?? record.title),
            cover: q?.cover ?? {
              preparedFor: record.customerName,
              location: "",
              subtitle: "Interior design & fit-out proposal",
            },
            presentation: q?.presentation
              ? structuredClone(q.presentation)
              : undefined,
            inclusions: q?.inclusions ?? "",
            currency: q?.currency ?? record.currency ?? defaults.currency ?? undefined,
            validUntil: new Date(Date.now() + defaults.validityDays * 86400000)
              .toISOString()
              .slice(0, 10),
            discount: action === "variation" ? 0 : (q?.discount ?? 0),
            taxRate: q?.taxRate ?? defaults.taxRate,
            terms: q?.terms ?? defaults.terms,
            exclusions: q?.exclusions ?? defaults.exclusions,
            lines:
              action === "variation" ? [] : structuredClone(q?.lines ?? []),
            requestIds: [],
            paymentTerms: plan ? plan.paymentTerms : structuredClone(q?.paymentTerms ?? []),
            paymentTemplate: plan ? plan.paymentTemplate : q?.paymentTemplate,
            rooms:
              action === "variation" ? [] : structuredClone(q?.rooms ?? []),
            createdAt: now,
            total: 0,
          };
          if (action === "create") {
            await this.seedPreparationRooms(client, workspaceId, caseId, q);
          }
          data.quotes.push(q);
        } else if (action === "import_scope") {
          if (!q) throw new NotFoundException("Quotation not found.");
          editable(q);
          if (b.entryIds !== undefined && (!Array.isArray(b.entryIds) || !b.entryIds.length || b.entryIds.length > 500)) throw new BadRequestException("Select at least one requirement to import.");
          const entryIds = Array.isArray(b.entryIds) ? b.entryIds.map(id => uuid(id, "requirement")) : undefined;
          const count = await this.importIncludedScope(
            client,
            workspaceId,
            caseId,
            q,
            b.refreshExisting === true,
            entryIds,
          );
          if (!count)
            throw new ConflictException(
              "Mark scope items Included in Preparation before importing. You can also add rooms and items from your catalogs.",
            );
        } else if (action === "save") {
          if (!q) throw new NotFoundException("Quotation not found.");
          editable(q);
          const v = object(b.quote);
          // An unknown cost (from the builder) arrives as null; keep it unknown rather than zero.
          const unknownCost = new Set(q.lines.filter((line) => line.unitCost === null).map((line) => line.id));
          if (Array.isArray(v.lines)) v.lines = v.lines.map((line) => (line && typeof line === "object" && (line as { unitCost?: unknown }).unitCost === null ? { ...line, unitCost: 0 } : line));
          const lines = parseLines(v.lines);
          for (const line of lines) if (unknownCost.has(line.id)) (line as { unitCost: number | null }).unitCost = null;
          // Fields owned by the quotation builder are kept as they are; this save never clears them.
          for (const line of lines) {
            const stored = q.lines.find((item) => item.id === line.id) as Record<string, unknown> | undefined;
            if (stored) for (const key of BUILDER_LINE_KEYS) if (stored[key] !== undefined) (line as Record<string, unknown>)[key] = stored[key];
          }
          const rooms: NonNullable<Quote["rooms"]> = [];
          if (v.rooms !== undefined) {
            if (!Array.isArray(v.rooms) || v.rooms.length > 100)
              throw new BadRequestException("Use up to 100 rooms.");
            for (const input of v.rooms) {
              const r = object(input),
                room: NonNullable<Quote["rooms"]>[number] = {
                  id: text(r.id, 80, true),
                  name: text(r.name, 120, true),
                };
              if (
                rooms.some(
                  (x) =>
                    x.id === room.id ||
                    x.name.toLowerCase() === room.name.toLowerCase(),
                )
              )
                throw new BadRequestException("Give each room a unique name.");
              if (r.catalog) {
                const ref = object(r.catalog),
                  recordId = text(ref.recordId, 80, true),
                  version = number(ref.version, 1e8, 1),
                  old = q.rooms?.find((x) => x.id === room.id)?.catalog;
                if (old?.recordId === recordId && old.version === version)
                  room.catalog = old;
                else {
                  const selected = (
                    await client.query(
                      `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=$2 AND r.kind='room' AND NOT r.archived AND NOT c.archived`,
                      [workspaceId, recordId],
                    )
                  ).rows[0];
                  if (!selected || selected.version !== version)
                    throw new ConflictException(
                      "The room catalog changed. Choose its current version.",
                    );
                  room.catalog = {
                    role: "room",
                    recordId,
                    version,
                    snapshot: selected,
                  };
                }
              }
              rooms.push(room);
            }
          }

          for (const l of lines) {
            for (const selection of l.catalogLinks ?? []) {
              const old = q.lines
                .find((row) => row.id === l.id)
                ?.catalogLinks?.find(
                  (c) =>
                    c.recordId === selection.recordId &&
                    c.role === selection.role &&
                    c.version === selection.version,
                );
              if (old) {
                selection.snapshot = old.snapshot;
                continue;
              }
              const selected = (
                await client.query(
                      `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration,r.content->'commerce' AS commerce FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=$2 AND NOT r.archived AND NOT c.archived`,
                  [workspaceId, selection.recordId],
                )
              ).rows[0];
              if (
                !selected ||
                selected.version !== selection.version ||
                !(
                  selected.kind === selection.role ||
                  (selection.role === "material" &&
                    ["sku", "hardware", "consumable"].includes(selected.kind))
                )
              )
                throw new ConflictException(
                  "A catalog selection changed or is unavailable. Select its current version.",
                );
              selection.snapshot = selected;
            }
          }
          for (const line of lines) {
            for (const role of ["work", "variant", "unit"])
              if (
                (line.catalogLinks ?? []).filter(
                  (selection) => selection.role === role,
                ).length > 1
              )
                throw new BadRequestException(
                  `Choose only one catalog ${role} per quotation item.`,
                );
            const work = line.catalogLinks?.find((c) => c.role === "work"),
              variant = line.catalogLinks?.find((c) => c.role === "variant");
            if (!variant) continue;
            if (!work)
              throw new BadRequestException(
                "Choose the catalog item before selecting its variant.",
              );
            const linked = await client.query(
              `SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='work'`,
              [workspaceId, variant.recordId],
            );
            if (
              !linked.rows.some((r) => r.target_id === work.recordId)
            )
              throw new BadRequestException(
                "This variant belongs to another catalog item. Choose a matching variant.",
              );
          }
          const known = new Map(q.lines.map((l) => [l.id, l]));
          const canEditCosts = await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.costs.manage",
          );
          preserveUnauthorizedCosts(lines, known, canEditCosts);
          for (const l of lines) {
            const old = known.get(l.id);
            delete l.scopeId;
            delete l.scopeVersion;
            delete l.specificationVersion;
            if (old?.scopeId)
              Object.assign(l, {
                scopeId: old.scopeId,
                scopeVersion: old.scopeVersion,
                specificationVersion: old.specificationVersion,
              });
          }
          let canOverridePrice: boolean | undefined;
          const manualAuthorizations = manualLineAuthorizations(lines, known);
          if (manualAuthorizations.length) {
            canOverridePrice = await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "commercial.override_price",
            );
            if (!canOverridePrice)
              throw new ForbiddenException(
                "Commercial price override permission is required to add a manual quotation item.",
              );
            const missingReason = manualAuthorizations.find(
              (line) => !line.manualReason?.trim(),
            );
            if (missingReason)
              throw new BadRequestException(
                `Explain why ${missingReason.title} is being added without confirmed scope or a catalogue source.`,
              );
            for (const line of manualAuthorizations)
              data.audit.push({
                id: randomUUID(),
                at: now,
                actor: user.displayName,
                action: "manual_quotation_line_authorized",
                quoteId: q.id,
                note: `${line.title}: ${line.manualReason}`,
              });
          }
          const quoteCurrency = currency(v.currency),
            quoteTaxRate = number(v.taxRate, 100);
          let defaultPricingDate: string | undefined;
          for (const line of lines) {
            const old = known.get(line.id),
              priceRequest = line.catalogPriceRequest,
              work = line.catalogLinks?.find(
                (selection) => selection.role === "work",
              ),
              variant = line.catalogLinks?.find(
                (selection) => selection.role === "variant",
              ),
              unit = line.catalogLinks?.find(
                (selection) => selection.role === "unit",
              );
            delete line.catalogPriceRequest;
            const managed = Boolean(
              priceRequest ||
                old?.catalogPrice ||
                (line.pricingMode !== "materials" &&
                  (work?.snapshot.commerce || variant?.snapshot.commerce)),
            );
            if (!managed) continue;
            if (!work)
              throw new BadRequestException(
                "Choose a catalog item before resolving its selling price.",
              );
            if (
              line.pricingMode === "materials" &&
              priceRequest?.action !== "override"
            )
              throw new BadRequestException(
                "Catalog rate resolution applies to item-rate lines. Use an authorized override for a custom material build-up.",
              );

            const sameSelection = old?.catalogPrice
              ? sameCatalogPriceSelection(old.catalogPrice, line)
              : false;
            if (!priceRequest && old?.catalogPrice && sameSelection) {
              line.catalogPrice = retainedCatalogPrice(
                old.catalogPrice,
                line,
                quoteCurrency,
                quoteTaxRate,
              );
              line.rate = catalogSnapshotRate(line.catalogPrice);
              continue;
            }

            const pricingDate =
              priceRequest?.pricingDate ??
              (defaultPricingDate ??=
                await this.workspaceDate(client, workspaceId));
            const resolution = await this.sellingPrices.resolve(
              client,
              workspaceId,
              {
                catalogId: work.snapshot.catalogId,
                workId: work.recordId,
                workVersion: work.version,
                ...(variant
                  ? {
                      variantId: variant.recordId,
                      variantVersion: variant.version,
                    }
                  : {}),
                ...(unit
                  ? { unitId: unit.recordId, unitVersion: unit.version }
                  : {}),
                unitLabel: line.unit,
                ...(priceRequest?.rateZoneId
                  ? {
                      rateZoneId: priceRequest.rateZoneId,
                      rateZoneVersion: priceRequest.rateZoneVersion,
                    }
                  : {}),
                quantity: line.quantity,
                currency: quoteCurrency,
                pricingDate,
                taxRate: quoteTaxRate,
              },
            );
            if (priceRequest?.action === "override") {
              canOverridePrice ??= await this.access.hasPermission(
                client,
                workspaceId,
                user.userId,
                "commercial.override_price",
              );
              if (!canOverridePrice)
                throw new ForbiddenException(
                  "Commercial price override permission is required.",
                );
              if (line.rate <= 0)
                throw new BadRequestException(
                  "An overridden selling price must be greater than zero.",
                );
              line.catalogPrice = {
                ...resolution.snapshot,
                status: "resolved",
                source: "manual_override",
                issue: undefined,
                override: {
                  amount: line.rate,
                  reason: priceRequest.reason!,
                  by: user.displayName,
                  at: now,
                },
              };
              data.audit.push({
                id: randomUUID(),
                at: now,
                actor: user.displayName,
                action: "catalog_price_override",
                quoteId: q.id,
                note: `${line.title}: ${quoteCurrency} ${line.rate} (${priceRequest.reason})`,
              });
            } else {
              line.catalogPrice = resolution.snapshot;
              line.rate = catalogSnapshotRate(resolution.snapshot);
            }
          }
          const requestIds = Array.isArray(v.requestIds)
            ? v.requestIds.map((id) => text(id, 80, true))
            : [];
          if (
            requestIds.some(
              (id) =>
                !data.requests.some(
                  (r) =>
                    r.id === id &&
                    !["resolved", "declined", "withdrawn"].includes(r.status),
                ),
            )
          )
            throw new ConflictException("Choose open change requests.");
          const controlledRequest = controlledChangeForQuote(data, q.id);
          if (
            controlledRequest &&
            !requestIds.includes(controlledRequest.id)
          )
            throw new ConflictException(
              "A controlled Change Case cannot be removed from its linked document.",
            );
          if (
            controlledRequest &&
            q.kind === "variation" &&
            v.direction !== undefined &&
            v.direction !== q.direction
          )
            throw new ConflictException(
              "The financial direction is fixed by the controlled Change Case.",
            );
          if (
            controlledRequest &&
            q.direction === "deduction" &&
            lines.some(
              (line) =>
                !line.deductsLineId ||
                !controlledRequest.control!.sourceLineIds.includes(
                  line.deductsLineId,
                ),
            )
          )
            throw new ConflictException(
              "A controlled credit can only deduct the contract items selected in its Change Case.",
            );
          if (
            controlledRequest &&
            isNonFinancialControlledChange(controlledRequest.control!.kind) &&
            (lines.length || (Array.isArray(v.paymentTerms) && v.paymentTerms.length))
          )
            throw new ConflictException(
              "A clarification or schedule amendment cannot contain prices or payment terms.",
            );
          Object.assign(q, {
            title: text(v.title, 240, true),
            ...(v.cover ? { cover: parseCover(v.cover) } : {}),
            presentation:
              v.presentation === undefined
                ? q.presentation
                : parseQuotePresentation(v.presentation),
            inclusions: text(v.inclusions ?? "", 6000),
            currency: quoteCurrency,
            validUntil: date(v.validUntil),
            discount: roundAmount(v.discount, quoteCurrency),
            taxRate: quoteTaxRate,
            terms: text(v.terms, 10000),
            exclusions: text(v.exclusions, 6000),
            lines,
            rooms: v.rooms === undefined ? q.rooms : rooms,
            requestIds,
            direction:
              controlledRequest && q.kind === "variation"
                ? q.direction
                : q.kind === "variation" && v.direction === "deduction"
                  ? "deduction"
                  : "addition",
            paymentTerms:
              (controlledRequest && q.direction === "deduction") ||
              (q.kind === "variation" && v.direction === "deduction")
                ? []
                : parsePaymentTerms(v.paymentTerms ?? []),
          });
          for (const request of data.requests) {
            if (requestIds.includes(request.id)) request.quoteId = q.id;
            else if (request.quoteId === q.id) delete request.quoteId;
          }
          if (
            v.paymentTemplate &&
            !(
              q.paymentTemplate &&
              object(v.paymentTemplate).id === q.paymentTemplate.id &&
              object(v.paymentTemplate).version === q.paymentTemplate.version
            )
          ) {
            const template = object(v.paymentTemplate);
            const t = (
              await client.query(
                "SELECT id,name,version FROM commercial_payment_templates WHERE workspace_id=$1 AND id=$2",
                [workspaceId, text(template.id, 80, true)],
              )
            ).rows[0];
            if (!t)
              throw new BadRequestException("Payment template not found.");
            q.paymentTemplate = { id: t.id, name: t.name, version: t.version };
          } else if (!v.paymentTemplate) delete q.paymentTemplate;
          q.total = totals(q).total;
        } else if (
          ["submit", "approve", "qs_approve", "return", "issue", "withdraw"].includes(action)
        ) {
          if (!q) throw new NotFoundException("Quotation not found.");
          if (action === "submit") {
            editable(q);
            const controlledRequest = controlledChangeForQuote(data, q.id);
            const nonFinancial = Boolean(
              controlledRequest &&
                isNonFinancialControlledChange(controlledRequest.control!.kind),
            );
            if (q.direction !== "deduction" && !nonFinancial)
              parsePaymentTerms(q.paymentTerms, true);
            validateDeduction(data, q);
            const pricingIssue = q.lines.find(
              (line) =>
                line.catalogPrice && line.catalogPrice.status !== "resolved",
            );
            if (pricingIssue)
              throw new ConflictException(
                pricingIssue.catalogPrice?.status === "stale"
                  ? `Refresh the catalog selling price for ${pricingIssue.title} after changing its quantity, currency or tax.`
                  : `Confirm a selling price for ${pricingIssue.title} before submitting for review.`,
              );
            if (
              !nonFinancial &&
              (!q.lines.length || q.lines.some((l) => l.rate <= 0))
            )
              throw new ConflictException(
                "Add items and selling rates before submitting for review.",
              );
            if (nonFinancial && (q.lines.length || q.paymentTerms.length))
              throw new ConflictException(
                "A clarification or schedule amendment must remain a zero-value document.",
              );
            if (q.kind === "quotation") {
              const linked = q.lines.filter((line) => line.scopeId);
              const readiness = await this.preparationReadiness.evaluate(
                client,
                workspaceId,
                caseId,
                {
                  target: "pricing",
                  requireIncludedScope: linked.length > 0,
                  // The case's path decides: no site visit (no Site area) means no plan to ask for.
                  requireSitePlan: quotationNeedsSitePlan(await casePlan(client, workspaceId, caseId), data.servicePath?.scope, q.round),
                  scopeReferences: linked.map((line) => ({
                    scopeId: line.scopeId!,
                    title: line.title,
                    scopeVersion: line.scopeVersion,
                    specificationVersion: line.specificationVersion,
                  })),
                },
              );
              if (!readiness.ready)
                throw new ConflictException(readiness.blockers[0].detail);
              if (linked.length) {
                const baseline = readiness.definitionBaseline?.latest;
                if (
                  !readiness.definitionBaseline?.confirmed ||
                  !baseline?.current ||
                  baseline.status !== "confirmed"
                )
                  throw new ConflictException(
                    "Confirm the current requirements and design definition before quotation review.",
                  );
                q.definitionBaseline = {
                  id: baseline.id,
                  number: baseline.number,
                  hash: baseline.snapshotHash,
                };
                q.designEvidence = await captureApprovedDesignBaseline(
                  client,
                  workspaceId,
                  caseId,
                  q.lines.map((line) => ({
                    scopeLineId: line.id,
                    sourceScopeId: line.scopeId,
                    sourceScopeVersion: line.scopeVersion,
                    sourceSpecificationVersion: line.specificationVersion,
                    title: line.title,
                  })),
                  now,
                  q.definitionBaseline,
                  { includePackageDesigns: Boolean(data.servicePath?.scope.design && q.round === "main") },
                );
              } else {
                delete q.definitionBaseline;
                if (data.servicePath && q.round === "main") {
                  q.designEvidence = await captureApprovedDesignBaseline(
                    client,
                    workspaceId,
                    caseId,
                    q.lines.map((line) => ({ scopeLineId: line.id, title: line.title })),
                    now,
                    undefined,
                    { includePackageDesigns: data.servicePath.scope.design },
                  );
                } else delete q.designEvidence;
              }
            }
            q.total = totals(q).total;
            q.status = "internal_review";
          }
          if (action === "approve" || action === "qs_approve") {
            if (q.status !== "internal_review")
              throw new ConflictException(
                "Submit this version for review first.",
              );
            // A discount above the firm's threshold needs someone who approves quotes, not only the QS (plan §6.5).
            const threshold = (await client.query<{ percent: string | null }>(
              `SELECT discount_approval_percent::text AS percent FROM workspace_quotation_settings WHERE workspace_id=$1`,
              [workspaceId])).rows[0]?.percent ?? null;
            const priced = totals(q);
            if (threshold !== null && priced.subtotal > 0
              && Dec.of(priced.discount).mul(100).cmp(Dec.of(threshold).mul(priced.subtotal)) > 0
              && !(await this.access.hasPermission(client, workspaceId, user.userId, "commercial.approve")))
              throw new ForbiddenException(`The discount is above the ${threshold}% your firm allows without approval. Someone who approves quotes must approve this quote.`);
            if (action === "qs_approve") {
              if (!data.servicePath || q.kind !== "quotation")
                throw new ConflictException("QS estimate review applies to a quotation round in the deal-first workflow.");
              const estimate = totals(q);
              if (estimate.cost <= 0)
                throw new ConflictException("Enter the QS cost estimate for the quotation items before approving pricing.");
              q.qsEstimate = {
                quoteHash: qsEstimateHash(q), cost: estimate.cost,
                sellingTotal: estimate.total, reviewedAt: now,
                reviewedById: user.userId, reviewedBy: user.displayName,
              };
            } else if (await needsQsEstimate(client, workspaceId, caseId, data, q)) {
              // The firm's QS rules decide (standard catalogue items at approved list prices need no QS estimate).
              throw new ConflictException("A Quantity Surveyor must review this quotation before it is issued.");
            }
            q.status = "internal_approved";
            q.approvedBy = user.displayName;
          }
          if (action === "return") {
            const reviewPermission = data.servicePath && q.kind === "quotation" ? "commercial.estimate" : "commercial.approve";
            if (!(await this.access.hasPermission(client, workspaceId, user.userId, reviewPermission))
              && !(await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.edit")))
              throw new ForbiddenException("Only the quote's reviewer or someone who edits this case can send it back.");
            if (!["internal_review", "internal_approved"].includes(q.status))
              throw new ConflictException(
                "This version cannot return to draft.",
              );
            q.status = "draft";
            delete q.approvedBy;
            delete q.qsEstimate;
          }
          if (action === "withdraw") {
            if (q.status !== "issued")
              throw new ConflictException(
                "Only a pending quotation can be withdrawn.",
              );
            if (controlledChangeForQuote(data, q.id))
              throw new ConflictException(
                "A controlled Change Case cannot withdraw one document on its own. Withdraw the complete package or create a corrective Change Case.",
              );
            q.status = "withdrawn";
          }
          if (action === "issue") {
            if (q.status !== "internal_approved")
              throw new ConflictException(
                "Internal approval is required before issue.",
              );
            // Every requirement ends in a decision before a quotation goes out (plan §6.8, requirement trace).
            if (q.kind === "quotation") {
              const open = (await client.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM pre_project_brief_entries WHERE workspace_id=$1 AND case_id=$2 AND kind='requirement' AND archived_at IS NULL AND scope_status='undecided'`,
                [workspaceId, caseId])).rows[0].count;
              if (open) throw new ConflictException(`Decide every requirement before sending: ${open} still to decide.`);
            }
            // A QS estimate already given must still match; one the firm's QS rules don't ask for isn't required.
            if (data.servicePath && q.kind === "quotation" && !qsEstimateCurrent(q) && (q.qsEstimate || await needsQsEstimate(client, workspaceId, caseId, data, q)))
              throw new ConflictException("The QS estimate review is missing or the quotation changed. Return it for a fresh review.");
            const controlledRequest = controlledChangeForQuote(data, q.id);
            const isCaseSibling = (other: Quote) =>
              Boolean(
                controlledRequest && other.requestIds.includes(controlledRequest.id),
              );
            if (
              data.quotes.some(
                (other) =>
                  other.id !== q!.id &&
                  other.status === "accepted" &&
                  sameOffer(other, q!) &&
                  !isCaseSibling(other),
              )
            )
              throw new ConflictException(
                "An offer was accepted. Create an approved variation instead.",
              );
            const settings = (
              await client.query(
                "SELECT * FROM client_portal_settings WHERE workspace_id=$1 AND enabled=true",
                [workspaceId],
              )
            ).rows[0];
            if (!settings) {
              // Say who can switch it on (by permission), so Sales isn't left at a dead end.
              const managers = (await client.query<{ name: string }>(
                `SELECT DISTINCT account.display_name AS name
                   FROM workspace_memberships membership
                   JOIN users account ON account.id = membership.user_id AND account.status = 'active'
                   JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
                   JOIN role_permissions granted ON granted.role_id = assigned.role_id
                   JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'portal.manage'
                  WHERE membership.workspace_id = $1 AND membership.status = 'active' AND membership.user_id <> $2
                  ORDER BY account.display_name LIMIT 2`,
                [workspaceId, user.userId])).rows.map((row) => row.name);
              throw new ConflictException(
                managers.length
                  ? `The client portal is off. Ask ${managers.join(" or ")} to switch it on in Settings, then send again.`
                  : "The client portal is off. Switch it on in Settings, then send again.",
              );
            }
            // The quote goes to the case's client approver; with only one, the sender needn't pick them.
            const approvers = (
              await client.query<{ id: string }>(
                `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 AND active=true AND role='approver' ORDER BY created_at`,
                [workspaceId, caseId],
              )
            ).rows;
            const chosen = b.approverId === undefined || b.approverId === null || b.approverId === ""
              ? (approvers.length === 1 ? approvers[0].id : "")
              : text(b.approverId, 80, true);
            if (!chosen)
              throw new ConflictException(approvers.length
                ? "Choose which client decision-maker receives this quote."
                : "Add the client's decision-maker first.");
            const grant = approvers.find((approver) => approver.id === chosen);
            if (!grant)
              throw new ConflictException("Choose an active client approver.");
            if (q.validUntil < now.slice(0, 10))
              throw new ConflictException(
                "Update the quotation validity before issue.",
              );
            for (const previous of data.quotes)
              if (
                previous.status === "issued" &&
                sameOffer(previous, q) &&
                !isCaseSibling(previous)
              )
                previous.status = "superseded";
            validateDeduction(data, q);
            // QS confirmation (PLM-082), the quotation number and the markup disclosure the client sees (R3).
            // A QS estimate on this exact version is the QS's pricing too, so the QS is never asked twice.
            await beforeQuoteIssued(client, { workspaceId, caseId, quoteId: q.id, familyId: q.familyId ?? null, kind: q.kind, actorUserId: user.userId,
              qsEstimated: Boolean(data.servicePath && q.kind === "quotation" && qsEstimateCurrent(q)) });
            q.status = "issued";
            q.issuedAt = now;
            q.approverId = grant.id;
            q.brand = await effectivePortalBrand(client, workspaceId);
            q.letterhead = await readLetterhead(client, workspaceId, await quotationEntityId(client, workspaceId, caseId, q.familyId ?? q.id));
            // Brand is frozen only on issue. It changes the public snapshot,
            // not the QS-reviewed quantities, costs or selling prices.
            if (data.servicePath && q.kind === "quotation" && q.qsEstimate)
              q.qsEstimate.quoteHash = qsEstimateHash(q);
            q.hash = freezeHash(q);
            for (const id of q.requestIds) {
              const request = data.requests.find((r) => r.id === id);
              if (!request) continue;
              if (!request.control) {
                request.status = "awaiting_decision";
                continue;
              }
              const everyCaseDocumentIssued = request.control.quoteIds.every(
                (quoteId) =>
                  data.quotes.some(
                    (quote) => quote.id === quoteId && quote.status === "issued",
                  ),
              );
              request.status = everyCaseDocumentIssued
                ? "awaiting_decision"
                : "under_review";
            }
            // The client hears their quotation or variation is ready (once per issued revision), and the
            // sender is told exactly what went out: "Sent" only claims the email that was queued.
            const told = await tellClients(client, { workspaceId, caseId, event: "quote_issued", recordId: `${q.id}:${q.hash}`, title: `${q.title} (V${q.number})`,
              due: q.validUntil, demo: this.testMode });
            const decider = (await client.query<{ name: string; email: string | null }>(
              `SELECT grant_row.name, ${contactEmailSql("grant_row")} AS email FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 AND grant_row.id = $3`,
              [workspaceId, caseId, grant.id])).rows[0];
            sent = { portal: true, channel: "channel" in told ? told.channel ?? null : null, emailed: "names" in told ? told.names ?? [] : [], reason: told.reason,
              decider: decider?.name ?? "", deciderHasEmail: Boolean(decider?.email) };
          }
        } else if (action === "submit_owner_review") {
          if (record.opportunityStatus !== "won")
            throw new ConflictException("Mark the linked opportunity Won before submitting a deal.");
          const accepted = activeAcceptedBaseQuote(data);
          if (!accepted)
            throw new ConflictException(
              "Client acceptance is required before owner review.",
            );
          assertQuoteSnapshot(accepted);
          if (
            data.agreement?.status !== "executed" ||
            !agreementMatchesAcceptedQuote(data.agreement, accepted) ||
            !agreementMatchesFinanceContext(data)
          )
            throw new ConflictException(
              "Verify the signed agreement before owner review.",
            );
          if (
            data.ownerReview?.status === "approved" &&
            data.ownerReview.quoteId === accepted.id
          )
            throw new ConflictException(
              "This deal already has owner approval.",
            );
          const checklistInput = object(b.checklist),
            checklist = {
              agreement: checklistInput.agreement === true,
              boq: checklistInput.boq === true,
              documents: checklistInput.documents === true,
              margin: checklistInput.margin === true,
              materials: checklistInput.materials === true,
              payment: checklistInput.payment === true,
            };
          const commissionLines = dealInput(() => normalizeCommissionLines(b.commissionLines, acceptedQuoteValue(accepted), accepted.currency));
          // PLM-122: the payment proof attached on the opportunity (which made it Won) is the Deal File's proof;
          // a link is needed only when there is neither that nor a Finance-verified receipt.
          const attachedProof = record.paymentProofId ? opportunityProofPath(workspaceId, String(record.opportunityId), String(record.paymentProofId)) : undefined;
          const paymentProofUrl = attachedProof && !(typeof b.paymentProofUrl === "string" && b.paymentProofUrl.trim())
            ? attachedProof
            : dealInput(() => paymentProofLink(b.paymentProofUrl, quoteHasVerifiedReceipt(data, accepted.id)));
          data.ownerReview = {
            id:
              data.ownerReview?.quoteId === accepted.id
                ? data.ownerReview.id
                : randomUUID(),
            quoteId: accepted.id,
            quoteHash: accepted.hash ?? freezeHash(accepted),
            status: "pending_finance",
            commission: sumAmounts(commissionLines.map((line) => line.amount), accepted.currency),
            commissionLines,
            paymentProofUrl,
            checklist,
            submissionNote: text(b.note, 3000, true),
            submittedAt: now,
            submittedBy: user.displayName,
            submittedById: user.userId,
          };
          // The second paid round updates the same Deal File; it must never
          // remove the Project Ref created after the first agreement.
          if (!data.designRound) data.dealFile = null;
          // E3: the Deal File approval opens at Finance under the workspace's policy for this amount.
          await openDealApproval(client, { workspaceId, caseId, review: data.ownerReview, quote: accepted, title: `${record.title} · Q-${accepted.number}`, actorUserId: user.userId });
        } else if (action === "review_deal_finance") {
          const review = data.ownerReview;
          if (!review || review.status !== "pending_finance")
            throw new ConflictException("Submit the deal to Finance before verifying it.");
          if (review.submittedById === user.userId)
            throw new ForbiddenException("A separate Finance reviewer must verify the deal.");
          const decision = text(b.decision, 20, true);
          if (!["confirm", "return"].includes(decision))
            throw new BadRequestException("Choose confirm or return.");
          const financeNote = text(b.note ?? "", 3000, decision === "return");
          if (decision === "confirm") {
            if (b.paymentVerified !== true)
              throw new BadRequestException("Finance must verify the proof of payment.");
            const accepted = data.quotes.find(quote => quote.id === review.quoteId && quote.status === "accepted");
            if (!accepted || assertQuoteSnapshot(accepted) !== review.quoteHash)
              throw new ConflictException("The accepted quotation changed. Submit the deal again.");
            const finalCommissionLines = dealInput(() => confirmCommissionAmounts(review.commissionLines ?? [], b.commissionLines, acceptedQuoteValue(accepted), accepted.currency));
            review.finalCommissionLines = finalCommissionLines;
            review.commission = sumAmounts(finalCommissionLines.map((line) => line.amount), accepted.currency);
            // E3: Finance's step on the engine (who may verify, and the record of who did).
            await decideDealStep(client, { workspaceId, caseId, review, quote: accepted, title: `${record.title} · Q-${accepted.number}`, actorUserId: user.userId,
              step: "finance", decision: "approve", note: financeNote });
            review.status = "pending_approval";
          } else {
            await decideDealStep(client, { workspaceId, caseId, review, quote: data.quotes.find(quote => quote.id === review.quoteId),
              title: record.title, actorUserId: user.userId, step: "finance", decision: "return", note: financeNote });
            review.status = "returned";
            review.decisionNote = financeNote;
          }
          review.financeNote = financeNote;
          review.financeReviewedAt = now;
          review.financeReviewedBy = user.displayName;
          review.financeReviewedById = user.userId;
        } else if (action === "decide_owner_review") {
          // Anyone holding commercial.deal.approve decides (checked with the command), except the
          // people who submitted or verified this deal.
          const review = data.ownerReview,
            decision = text(b.decision, 20, true);
          if (!review || review.status !== "pending_approval")
            throw new ConflictException("Finance must confirm the Deal File before it is approved.");
          if (!["approve", "return", "reject"].includes(decision))
            throw new BadRequestException("Choose approve, return or reject.");
          if (dealSeparationBlocks(data, user.userId))
            throw new ForbiddenException(
              "Someone who didn't submit or verify this deal must approve it.",
            );
          if (record.opportunityStatus !== "won")
            throw new ConflictException("The linked opportunity must remain Won for Deal File approval.");
          const decisionNote = text(b.note ?? "", 3000, decision !== "approve");
          const accepted = data.quotes.find(
            (quote) =>
              quote.id === review.quoteId && quote.status === "accepted",
          );
          if (
            !accepted ||
            assertQuoteSnapshot(accepted) !== review.quoteHash
          )
            throw new ConflictException(
              "The accepted quotation changed. Submit a new owner review.",
            );
          if (decision === "approve") {
            const agreement = data.agreement;
            // Commission is optional: Finance confirms the lines, which may be none.
            if (!Array.isArray(review.finalCommissionLines) || !review.financeReviewedById)
              throw new ConflictException("Finance must confirm the Deal File before it is approved.");
            if (!dealPaymentProofReady(data, review.paymentProofUrl, accepted.id))
              throw new ConflictException("Add a proof-of-payment link, or have Finance verify the receipt, before approval.");
            if (Object.entries(review.checklist).some(([key, checked]) =>
              !checked && !(data.servicePath && key === "materials")))
              throw new ConflictException(
                "Complete every owner review check before approval.",
              );
            if (
              !(data.servicePath
                ? agreementIsOperational(data.agreement) && agreementMatchesAcceptedQuote(data.agreement, accepted)
                : ownerReviewInputsReady(data, accepted))
            )
              throw new ConflictException(
                "Verify the agreement and exact client material approvals before owner approval.",
              );
            if (data.servicePath && !financeGatePaymentsReady(data, "release", accepted.id))
              throw new ConflictException("Finance must verify this quotation round's payment before the deal is approved.");
            if (data.servicePath?.scope.design && accepted.round === "design" &&
                !designDepositReady(data, accepted))
              throw new ConflictException(designDepositMessage(data.servicePath.designMinimumDeposit, accepted));
            const snapshot = acceptedQuoteTotals(accepted);
            // E3: the approver's step on the engine. With more approvers after this one (the Owner above an amount),
            // the Deal File waits for them; it is created only when the request is approved.
            const approval = await decideDealStep(client, { workspaceId, caseId, review, quote: accepted, title: `${record.title} · Q-${accepted.number}`,
              actorUserId: user.userId, step: "approver", decision: "approve", note: decisionNote });
            if (approval && approval.status !== "approved") {
              review.decisionNote = decisionNote;
            } else {
            review.status = "approved";
            review.decisionNote = decisionNote;
            review.decidedAt = now;
            review.decidedBy = user.displayName;
            review.decidedById = user.userId;
            const existingDealFile = data.designRound?.dealFile;
            data.dealFile = {
              id: existingDealFile?.id ?? randomUUID(),
              reference: existingDealFile?.reference ?? await dealFileReference(client, workspaceId, record.legalEntityId ? String(record.legalEntityId) : null, caseId, now.slice(0, 4)),
              revision: existingDealFile ? existingDealFile.revision + 1 : 1,
              ownerReviewId: review.id,
              quoteId: accepted.id,
              quoteNumber: accepted.number,
              quoteHash: review.quoteHash,
              definitionBaseline: accepted.definitionBaseline,
              designEvidence: accepted.designEvidence,
              materialEvidence: approvedMaterialEvidence(
                accepted,
                data.materialApprovals,
              ),
              agreementReference: agreement!.reference,
              paymentIds: data.payments
                .filter((payment) => payment.sourceQuoteId === accepted.id && payment.requiredForRelease)
                .map((payment) => payment.id),
              value: acceptedQuoteValue(accepted),
              // A cost missing on a line is no cost at all (reports read 0 as unknown), never a false margin.
              cost: snapshot.costMissing ? 0 : snapshot.cost,
              margin: snapshot.costMissing ? 0 : snapshot.margin,
              commission: review.commission,
              commissionLines: review.finalCommissionLines,
              paymentProofUrl: review.paymentProofUrl,
              opportunityId: record.opportunityId,
              opportunityReference: record.opportunityReference,
              enquiryReference: record.enquiryReference,
              status: "active",
              approvedAt: now,
              approvedBy: user.displayName,
            };
            // A paid design round opens design work in Planning; the project itself starts from the accepted main quotation.
            if (data.servicePath?.scope.design && accepted.round === "design") await startJourney(client, workspaceId, caseId, user.userId);
            else if (accepted.round !== "design") await releasePhaseOnDealApproval(client, { workspaceId, caseId, actorUserId: user.userId });
            // PLM-103 / PLM-009: the round's proposal is Won (once) and its value is locked by this Deal File approval.
            if (record.opportunityId) await markProposalWon(client, { workspaceId, opportunityId: String(record.opportunityId), round: accepted.round === "design" ? "design" : "main",
              actorUserId: user.userId, quote: { id: accepted.id, number: accepted.number, amount: dealAmount(accepted), currencyCode: accepted.currency }, lockByDealFile: true });
            }
          } else {
            await decideDealStep(client, { workspaceId, caseId, review, quote: data.quotes.find((quote) => quote.id === review.quoteId), title: record.title,
              actorUserId: user.userId, step: "approver", decision: decision === "return" ? "return" : "reject", note: decisionNote });
            review.status = decision === "return" ? "returned" : "rejected";
            review.decisionNote = decisionNote;
            review.decidedAt = now;
            review.decidedBy = user.displayName;
            review.decidedById = user.userId;
            data.dealFile = data.designRound?.dealFile ?? null;
          }
        } else if (action === "sync_material_approvals") {
          const accepted = activeAcceptedBaseQuote(data);
          if (!accepted)
            throw new ConflictException(
              "Accept the quotation before preparing material approvals.",
            );
          if (data.servicePath &&
              (accepted.round !== "main" || data.dealFile?.quoteId !== accepted.id || data.ownerReview?.status !== "approved"))
            throw new ConflictException("Book material selection after the main agreement, payment and Owner-approved Deal File.");
          const approvals =
            data.materialApprovals ?? (data.materialApprovals = []);
          for (const source of quotationApprovalSources(accepted)) {
            if (
              approvals.some(
                (approval) =>
                  approval.quoteId === accepted.id &&
                  approval.lineId === source.lineId &&
                  approval.materialRowId === source.materialRowId,
              )
            )
              continue;
            approvals.push({
              id: randomUUID(),
              quoteId: accepted.id,
              lineId: source.lineId,
              materialRowId: source.materialRowId,
              revision: 1,
              room: source.room,
              item: source.item,
              name: source.name,
              code: source.code,
              brand: source.brand,
              specification: source.specification,
              note: "",
              status: "proposed",
            });
          }
        } else if (action === "save_material_approval") {
          const approval = data.materialApprovals?.find(
            (item) => item.id === b.materialApprovalId,
          );
          if (!approval)
            throw new NotFoundException("Material selection not found.");
          if (!["proposed", "rejected"].includes(approval.status))
            throw new ConflictException(
              "Only proposed or rejected selections can be edited.",
            );
          approval.name = text(b.name, 240, true);
          approval.code = text(b.code ?? "", 80);
          approval.brand = text(b.brand ?? "", 160);
          approval.specification = text(b.specification ?? "", 3000, true);
          approval.note = text(b.note ?? "", 3000);
          if (b.photo !== undefined) {
            const photo = text(b.photo, 250000);
            if (
              photo &&
              !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
                photo,
              )
            )
              throw new BadRequestException(
                "Use a PNG, JPEG or WebP material photo.",
              );
            approval.photo = photo || undefined;
          }
          if (approval.status === "rejected") {
            approval.revision++;
            approval.status = "proposed";
            delete approval.approverId;
            delete approval.submittedAt;
            delete approval.decidedAt;
            delete approval.decidedBy;
            delete approval.decisionNote;
            delete approval.decisionChallengeId;
          }
        } else if (action === "submit_material_approval") {
          const approval = data.materialApprovals?.find(
            (item) => item.id === b.materialApprovalId,
          );
          if (!approval || approval.status !== "proposed")
            throw new ConflictException(
              "Prepare the material selection before sending it.",
            );
          const grant = (
            await client.query(
              `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND active=true AND role='approver'`,
              [workspaceId, caseId, text(b.approverId, 80, true)],
            )
          ).rows[0];
          if (!grant)
            throw new ConflictException("Choose an active client approver.");
          approval.status = "client_review";
          approval.approverId = grant.id;
          approval.submittedAt = now;
        } else if (action === "verify_credit") {
          if (
            !(await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "commercial.finance.verify",
            ))
          )
            throw new ForbiddenException("Finance verification is required.");
          const credit = data.credits?.find((c) => c.id === b.creditId);
          if (!credit) throw new NotFoundException("Client credit not found.");
          if (credit.status === "verified")
            throw new ConflictException(
              "This client credit was already verified.",
            );
          recordCreditNote(
            data,
            credit,
            {
              reference: text(b.reference, 500, true),
              evidence: text(b.evidence, 3000, true),
            },
            user.displayName,
            now,
          );
        } else if (action === "request") {
          if (b.decisionRequest === true) {
            const targetType = text(b.targetType, 30, true);
            if (!["quotation", "material"].includes(targetType))
              throw new BadRequestException("Choose a supported exact revision.");
            const targetId = text(b.targetId, 80, true);
            const targetRevision = number(b.targetRevision, 1_000_000, 1);
            let targetLabel = "";
            let clientApproverGrantId = "";
            if (targetType === "quotation") {
              const target = data.quotes.find((item) => item.id === targetId && item.number === targetRevision && Boolean(item.issuedAt));
              if (!target) throw new ConflictException("The selected quotation revision is no longer available.");
              if (!target.approverId) throw new ConflictException("Assign a client approver to this quotation revision first.");
              targetLabel = `Quotation V${target.number}`;
              clientApproverGrantId = target.approverId;
            } else {
              const target = data.materialApprovals?.find((item) => item.id === targetId && item.revision === targetRevision && item.status === "client_review");
              if (!target) throw new ConflictException("The selected material revision is no longer awaiting review.");
              if (!target.approverId) throw new ConflictException("Assign a client approver to this material revision first.");
              targetLabel = `${target.name} · Revision ${target.revision}`;
              clientApproverGrantId = target.approverId;
            }
            if (!Array.isArray(b.allowedChoices) || b.allowedChoices.length < 2 || b.allowedChoices.length > 8)
              throw new BadRequestException("Add between two and eight clear choices.");
            const labels = b.allowedChoices.map((choice) => text(choice, 80, true));
            if (new Set(labels.map((choice) => choice.toLocaleLowerCase())).size !== labels.length)
              throw new BadRequestException("Decision choices must be unique.");
            const dueDate = date(b.dueDate);
            if (dueDate < now.slice(0, 10)) throw new BadRequestException("Choose today or a future due date.");
            const escalationMinutes = b.escalationMinutes == null || b.escalationMinutes === ""
              ? null : number(Number(b.escalationMinutes), 43_200, 0);
            const requestedChannels = Array.isArray(b.reminderChannels) ? b.reminderChannels : ["in_app"];
            const channels = [...new Set(requestedChannels.map((channel) => text(channel, 20, true)))];
            if (channels.some((channel) => !["in_app", "email", "whatsapp"].includes(channel)))
              throw new BadRequestException("Choose a supported reminder channel.");
            const membership = await client.query<{ id: string }>(
              `SELECT id FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
              [workspaceId, user.userId],
            );
            if (!membership.rows[0]) throw new ForbiddenException("An active workspace membership is required.");
            const request = newRequest(data, text(b.title, 240, true), text(b.detail, 6000, true), q?.id, {
              ownerMembershipId: membership.rows[0].id,
              clientApproverGrantId,
              target: { type: targetType as "quotation" | "material", id: targetId, revision: targetRevision, label: targetLabel },
              allowedChoices: labels.map((label, index) => ({ id: `choice-${index + 1}`, label })),
              escalationMinutes,
              notificationPolicy: {
                remindersEnabled: b.remindersEnabled !== false,
                channels: channels as Array<"in_app" | "email" | "whatsapp">,
              },
              decision: null,
            }, { name: user.displayName, client: false });
            request.owner = user.displayName;
            request.dueDate = dueDate;
            request.status = "awaiting_decision";
          } else {
            newRequest(
              data,
              text(b.title, 240, true),
              text(b.detail, 6000, true),
              q?.id,
              undefined,
              { name: user.displayName, client: false },
            );
          }
        } else if (action === "update_request") {
          const r = data.requests.find((r) => r.id === b.requestId);
          if (!r) throw new NotFoundException("Request not found.");
          r.owner = text(b.owner, 160);
          r.dueDate = b.dueDate ? date(b.dueDate) : "";
          const status = text(b.status, 30, true);
          if (
            ![
              "open",
              "under_review",
              "declined",
              "withdrawn",
              "resolved",
            ].includes(status) &&
            !(
              status === "awaiting_decision" && r.status === "awaiting_decision"
            )
          )
            throw new BadRequestException("Invalid request status.");
          const resolution = text(b.resolution, 3000);
          if (
            ["resolved", "declined", "withdrawn"].includes(status) &&
            !resolution
          )
            throw new BadRequestException("Add a closure reason.");
          if (r.control) {
            if (status === "resolved" && !controlledChangeCanRelease(data, r.id))
              throw new ConflictException(
                "Accept every linked Change Case document and complete its impact dispositions before resolving it.",
              );
            if (
              ["declined", "withdrawn"].includes(status) &&
              r.control.quoteIds.some((quoteId) =>
                data.quotes.some(
                  (quote) => quote.id === quoteId && quote.status === "accepted",
                ),
              )
            )
              throw new ConflictException(
                "This Change Case already has an accepted document. Create a corrective Change Case rather than closing it as declined or withdrawn.",
              );
          } else if (
            status === "resolved" &&
            r.quoteId &&
            !data.quotes.some(
              (q) => q.status === "accepted" && q.requestIds.includes(r.id),
            )
          )
            throw new ConflictException(
              "Accept the linked revised quotation before resolving this change.",
            );
          r.status = status as typeof r.status;
          r.resolution = resolution;
        } else if (action === "comment") {
          const r = data.requests.find((r) => r.id === b.requestId);
          if (!r) throw new NotFoundException("Request not found.");
          const visibility = b.visibility === "internal" ? "internal" : "client";
          const commentId = randomUUID();
          // Files the team attaches to a reply the client reads (as the client can): the team's own uploads on this case.
          const files = await teamReplyFiles(client, workspaceId, caseId, visibility, b.assetIds);
          r.comments.push({
            id: commentId,
            at: now,
            author: user.displayName,
            text: text(b.text, 6000, files.length === 0),
            visibility,
          });
          for (const assetId of files)
            await client.query(`INSERT INTO client_portal_attachments (workspace_id, case_id, asset_id, target_kind, target_id, attached_by) VALUES ($1, $2, $3, 'message', $4, $5)`,
              [workspaceId, caseId, assetId, commentId, user.userId]);
          // A reply the client reads reaches them (email, or nothing while the portal or its Messages are off); a note stays inside.
          if (visibility === "client" && !r.decisionRequest)
            await tellClients(client, { workspaceId, caseId, event: "message_replied", recordId: `message:${commentId}`, title: r.title,
              note: `${r.title}: ${r.comments.at(-1)!.text || `${files.length} file${files.length === 1 ? "" : "s"}`}` });
        } else if (action === "attach_agreement_file") {
          if (!data.agreement) throw new ConflictException("Save the agreement before attaching its signed documents.");
          if (b.quoteId !== data.agreement.quoteId) throw new ConflictException("The agreement changed. Reopen it before attaching files.");
          const assetId = text(b.assetId, 80, true);
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) throw new BadRequestException("Choose an uploaded file.");
          const files = data.agreement.files ?? [];
          if (!files.some(file => file.id === assetId)) {
            if (files.length >= 20) throw new ConflictException("An agreement can have up to 20 files.");
            const asset = await client.query(`SELECT id,original_name AS name,mime_type AS "mimeType",byte_size AS "byteSize",preview_key IS NOT NULL AS "hasPreview" FROM pre_project_brief_assets WHERE workspace_id=$1 AND case_id=$2 AND id=$3`, [workspaceId, caseId, assetId]);
            if (!asset.rowCount) throw new BadRequestException("This file does not belong to this project.");
            data.agreement.files = [...files, { ...asset.rows[0], addedAt: now, addedBy: user.userId }];
          }
        } else if (action === "agreement") {
          const quote = data.quotes.find(
            (q) =>
              q.id === b.quoteId &&
              q.status === "accepted" &&
              q.kind === "quotation",
          );
          if (!quote)
            throw new ConflictException("Select the accepted base quotation.");
          if (data.designRound && quote.round !== "main")
            throw new ConflictException("The design agreement is complete. Use the accepted main quotation for the next agreement.");
          const quoteHash = assertQuoteSnapshot(quote);
          const acceptedTotal = quote.clientDecision?.acceptedTotal;
          if (
            quote.clientDecision?.decision !== "accept" ||
            quote.clientDecision.quoteHash !== quoteHash ||
            acceptedTotal === undefined
          )
            throw new ConflictException(
              "This accepted quotation is missing revision-bound acceptance evidence. Ask the client to accept the current issued revision again.",
            );
          if (data.agreement?.status === "executed")
            throw new ConflictException(
              "Executed agreement evidence is locked. A separate amendment is required.",
            );
          const financeContext = bindFinanceContext(
            data.financeContext,
            record,
            quote.currency,
            now,
          );
          data.financeContext = financeContext;
          const agreementReference = text(b.reference, 200, true);
          if (!data.payments.some(payment => payment.sourceQuoteId === quote.id)) {
            // Exact shares in the contract currency's minor units; the last takes the rest, so they add up.
            const shares = splitByPercent(acceptedTotal, (quote.paymentTerms ?? []).map((term) => term.percent), financeContext.currency);
            const roundPayments = (quote.paymentTerms ?? []).map((term, index) => {
              const amount = shares[index];
              return {
                id: randomUUID(),
                sourceQuoteId: quote.id,
                legalEntityId: financeContext.legalEntityId,
                currency: financeContext.currency,
                agreementReference,
                title: term.title,
                amount,
                dueDate: "",
                trigger: term.trigger,
                requiredForRelease: term.requiredForRelease,
                requiredForProduction: term.requiredForProduction === true,
                status: "pending" as const,
                proof: "",
                reference: "",
              };
            });
            data.payments.push(...roundPayments);
          }
          for (const payment of data.payments.filter(payment => payment.sourceQuoteId === quote.id)) {
            if (
              payment.legalEntityId &&
              payment.legalEntityId !== financeContext.legalEntityId
            )
              throw new ConflictException(
                "An existing payment milestone belongs to another legal entity.",
              );
            if (payment.currency && payment.currency !== financeContext.currency)
              throw new ConflictException(
                "An existing payment milestone uses another contract currency.",
              );
            payment.legalEntityId = financeContext.legalEntityId;
            payment.currency = financeContext.currency;
            payment.agreementReference = agreementReference;
          }
          data.agreement = {
            files: data.agreement?.quoteId === quote.id ? data.agreement.files : [],
            quoteId: quote.id,
            quoteHash,
            selectedOptionLineIds: [...quote.clientDecision.selectedOptionLineIds],
            acceptedTotal,
            legalEntityId: financeContext.legalEntityId,
            currency: financeContext.currency,
            reference: agreementReference,
            terms: text(b.terms, 10000, true),
            evidence: text(b.evidence, 3000),
            evidenceKind:
              b.evidenceKind === "demonstration"
                ? "demonstration"
                : "operational",
            status: "draft",
          };
        } else if (action === "execute_agreement") {
          // The signed document itself is the evidence; a written description is optional once it's attached.
          if (
            !data.agreement ||
            !agreementHasSignedEvidence(data.agreement) ||
            !isOperationalEvidence(data.agreement)
          )
            throw new ConflictException(
              "Attach the signed agreement (or describe it) first. Demonstration evidence cannot execute a live agreement.",
            );
          const acceptedQuote = data.quotes.find(
            (quote) => quote.id === data.agreement!.quoteId && quote.status === "accepted",
          );
          if (
            !acceptedQuote ||
            !agreementMatchesFinanceContext(data) ||
            !data.agreement.quoteHash ||
            assertQuoteSnapshot(acceptedQuote) !== data.agreement.quoteHash ||
            acceptedQuote.clientDecision?.acceptedTotal !== data.agreement.acceptedTotal ||
            JSON.stringify(acceptedQuote.clientDecision?.selectedOptionLineIds ?? []) !==
              JSON.stringify(data.agreement.selectedOptionLineIds ?? [])
          )
            throw new ConflictException(
              "The agreement no longer matches the accepted quotation evidence. Record a new agreement from the accepted revision.",
            );
          data.agreement.status = "executed";
          data.agreement.executedBy = user.displayName;
          data.agreement.executedAt = now;
        } else if (action === "payment") {
          if (!data.agreement)
            throw new ConflictException("Record the agreement first.");
          const existing = data.payments.find((p) => p.id === b.paymentId);
          if (existing?.invoice && roundAmount(b.amount, data.financeContext?.currency) !== existing.amount)
            throw new ConflictException(
              "A linked invoice fixes the milestone amount. Resolve its commercial correction first.",
            );
          if (existing && existing.status !== "pending")
            throw new ConflictException(
              "Submitted or verified payment records cannot be edited.",
            );
          // An issued tax invoice fixes what the milestone asks for until it's credited.
          const invoiced = existing
            ? (await client.query<{ number: string }>(
                `SELECT number FROM client_invoices WHERE workspace_id = $1 AND case_id = $2 AND payment_id = $3 AND status = 'issued'`,
                [workspaceId, caseId, existing.id],
              )).rows[0]
            : undefined;
          if (invoiced && (roundAmount(b.amount, data.financeContext?.currency) !== existing!.amount || text(b.title, 160, true) !== existing!.title))
            throw new ConflictException(
              `Tax invoice ${invoiced.number} is issued for this milestone. Credit it before changing its amount or title.`,
            );
          if (!existing && data.payments.some((p) => p.sourceQuoteId))
            throw new ConflictException(
              "This schedule comes from the accepted quotation. Use an approved variation for extra payments.",
            );
          if (
            existing?.sourceQuoteId &&
            (roundAmount(b.amount, data.financeContext?.currency) !== existing.amount ||
              text(b.title, 160, true) !== existing.title ||
              b.requiredForRelease !== existing.requiredForRelease ||
              (b.requiredForProduction === true) !==
                (existing.requiredForProduction === true))
          )
            throw new ConflictException(
              "The accepted milestone amount and conditions are fixed. Update only its due date and accounting reference.",
            );
          const value = {
            id: existing?.id ?? randomUUID(),
            legalEntityId: data.financeContext?.legalEntityId,
            currency: data.financeContext?.currency,
            agreementReference: data.agreement.reference,
            title: text(b.title, 160, true),
            amount: roundAmount(b.amount, data.financeContext?.currency),
            dueDate: date(b.dueDate),
            requiredForRelease: b.requiredForRelease === true,
            requiredForProduction: b.requiredForProduction === true,
            status: "pending" as const,
            proof: "",
            reference: text(b.reference ?? "", 240),
            evidenceKind:
              b.evidenceKind === "demonstration"
                ? ("demonstration" as const)
                : ("operational" as const),
          };
          if (value.amount <= 0)
            throw new BadRequestException("Enter a payment amount.");
          if (existing)
            Object.assign(existing, {
              ...value,
              sourceQuoteId: existing.sourceQuoteId,
              trigger: existing.trigger,
            });
          else data.payments.push(value);
        } else if (action === "report_payment_receipt") {
          const payment = data.payments.find((p) => p.id === b.paymentId);
          if (!payment) throw new NotFoundException("Payment not found.");
          if (payment.status === "verified")
            throw new ConflictException("Payment already verified.");
          const receiptReference = text(b.reference, 240, true);
          const receiptEvidence = text(b.evidence, 3000, true);
          payment.evidenceKind =
            b.evidenceKind === "demonstration"
              ? "demonstration"
              : "operational";
          if (
            !isOperationalEvidence({
              evidenceKind: payment.evidenceKind,
              proof: receiptEvidence,
              reference: receiptReference,
            })
          )
            throw new ConflictException(
              "Demonstration evidence cannot create a live receipt.",
            );
          reportManualReceipt(
            data,
            payment,
            {
              reference: receiptReference,
              evidence: receiptEvidence,
            },
            user.displayName,
            now,
            user.userId,
          );
        } else if (action === "verify_payment") {
          const payment = data.payments.find((p) => p.id === b.paymentId);
          if (!payment) throw new NotFoundException("Payment not found.");
          if (payment.status === "verified")
            throw new ConflictException("Payment already verified.");
          verifyReceipt(data, payment, user.displayName, now, user.userId);
          if (
            !releasePaymentIsOperational(payment) ||
            !paymentHasFinanceVerifiedReceipt(data, payment)
          )
            throw new ConflictException(
              "Only operational receipt evidence can verify a live milestone.",
            );
        } else if (action === "release") {
          // Projects start from the accepted quotation (Start project), never from this old release step.
          throw new ConflictException("Start the project from the accepted quotation.");
        } else if (action === "extend_validity") {
          // Same content, a new date: no new review round (Q-7). The client is told it's open again.
          if (!q) throw new NotFoundException("Quotation not found.");
          const today = await this.workspaceDate(client, workspaceId);
          const change = extendQuoteValidity(q, text(b.validUntil, 10, true), today);
          q.validityExtensions = [...(q.validityExtensions ?? []), { ...change, at: now, by: user.displayName, byId: user.userId }];
          await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "commercial.quote_validity_extended.v1", entityType: "pre_project_case", entityId: caseId,
            before: { quoteId: q.id, validUntil: change.from }, after: { quoteId: q.id, validUntil: change.to } });
          await tellClients(client, { workspaceId, caseId, event: "quote_issued", recordId: `${q.id}:${q.hash}:valid:${change.to}`, title: `${q.title} (V${q.number})`,
            due: q.validUntil, demo: this.testMode });
        } else if (action === "record_decision") {
          // Staff record the client's decision on the sent quote (a signed copy, an email, in person).
          if (!q) throw new NotFoundException("Quotation not found.");
          recorder = await decisionRecorder(client, (code) => this.access.hasPermission(client, workspaceId, user.userId, code), { workspaceId, caseId, userId: user.userId });
          if (!recorder) throw new ForbiddenException("Only the case owner, Sales who record decisions or an approver can record the client's decision.");
          if (q.kind !== "quotation") throw new ConflictException("Record a variation's decision from its change case.");
          actionable(q);
          const decision = text(b.decision, 20, true);
          if (!["accept", "changes", "decline"].includes(decision)) throw new BadRequestException("Choose accept, changes or decline.");
          const method = text(b.method, 20, true);
          if (!["signed_document", "email", "in_person", "phone", "message"].includes(method)) throw new BadRequestException("Choose how the client decided.");
          const note = text(b.note ?? "", 6000, decision !== "accept");
          const clientName = text(b.clientName ?? record.customerName ?? "", 160, true);
          // The file the client decided in (a signed copy, a screenshot of the message); required from Sales.
          const evidenceId = typeof b.evidenceAssetId === "string" ? b.evidenceAssetId.trim() : "";
          const evidence = evidenceId ? await decisionEvidenceFile(client, workspaceId, caseId, evidenceId) : null;
          if (evidenceId && !evidence) throw new BadRequestException("This file does not belong to this case.");
          if (recorder === "sales" && !evidence) throw new BadRequestException("Attach the signed copy, email or message the client decided in.");
          const typed = decision as "accept" | "changes" | "decline";
          // PLM-146: a budget range is a guide given at the client's request; the client accepts the final quotation.
          if (typed === "accept" && await budgetRange(client, workspaceId, caseId, q.id))
            throw new ConflictException("This quotation is a budget range. Send the final quotation once the specifications are final, and record the client's acceptance on it.");
          q.decidedAt = now;
          q.decidedBy = clientName;
          q.clientDecision = { ...quoteDecisionEvidence(q, typed, b.selectedOptionLineIds ?? [], clientName, now, note), recordedBy: user.displayName, recordedById: user.userId,
            method: method as NonNullable<QuoteDecisionEvidence["method"]>, ...(evidence ? { evidence } : {}) };
          await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "commercial.quote_decision_recorded.v1", entityType: "pre_project_case", entityId: caseId,
            before: { quoteId: q.id, status: "issued" }, after: { quoteId: q.id, decision, method, clientName, recorder, evidenceAssetId: evidence?.id ?? null } });
          if (typed === "accept") validateDeduction(data, q);
          q.status = typed === "accept" ? "accepted" : typed === "changes" ? "changes_requested" : "declined";
          // The client asked for the changes; the team member recorded them for them.
          if (typed === "changes") newRequest(data, `Changes to quotation V${q.number}`, note, q.id, undefined, { name: clientName, client: true });
          // Acceptance is the sale: the opportunity is Won and the case moves on, with no manual step.
          if (typed === "accept" && q.kind === "quotation")
            await winOpportunityOnAcceptance(client, { workspaceId, caseId, quoteNumber: q.number, round: q.round ?? null, actorUserId: user.userId, source: "user" });
        } else throw new BadRequestException("Unknown commercial action.");
        await this.persist(
          client,
          workspaceId,
          caseId,
          data,
          user.displayName,
          action,
          q?.id,
          // The reviewer's reason for sending a quote back stays in the case history.
          action === "return" && typeof b.note === "string" ? b.note.trim().slice(0, 3000) : "",
          user.userId,
        );
        // A new design-fee quote starts with the fee Sales priced on the opportunity (one editable line), in this
        // same command; the Proposal 1 value only for someone who may see the opportunity's values.
        const prefilled = action === "create" && q?.kind === "quotation" && q.round === "design" && !q.lines.length
          ? await prefillDesignFeeQuote(client, { workspaceId, caseId, quoteId: q.id, actorUserId: user.userId,
            includeProposalValue: await this.access.hasPermission(client, workspaceId, user.userId, "crm.opportunities.sensitive_values") })
          : null;
        if (["submit_owner_review", "review_deal_finance", "decide_owner_review"].includes(action))
          await this.notifyDealReview(client, workspaceId, caseId, data, action, user.userId);
        // A new revision starts from the previous one: carry each line's build-up and the discounts.
        if (action === "revise" && typeof b.quoteId === "string" && q && q.id !== b.quoteId)
          await copyBuilderData(client, workspaceId, caseId, b.quoteId, q.id);
        if (q && ["submit", "qs_approve", "approve", "return", "record_decision"].includes(action))
          await noticeQuoteStep(client, { workspaceId, caseId, quoteId: q.id, number: q.number, title: q.title, action, actorUserId: user.userId, revision: data.revision, note: typeof b.note === "string" ? b.note : "", decision: typeof b.decision === "string" ? b.decision : undefined,
            recordedBySales: action === "record_decision" && recorder === "sales",
            reviewPermission: data.servicePath && q.kind === "quotation" ? "commercial.estimate" : "commercial.approve" });
        // PLM-147: the QS estimate confirms a price above the client's recorded budget: value engineering opens, led by
        // the lead designer. A version sent or a client decision may end the round that is open.
        if (q && action === "qs_approve") await checkOverBudget(client, { workspaceId, caseId, quoteId: q.id, actorUserId: user.userId });
        if (q && (action === "issue" || action === "record_decision")) await settleQuietly(client, workspaceId, caseId);
        // The payment hand-offs: Finance hears a receipt was reported; the reporter, the case owner, whoever
        // approves a waiting deal and the client hear it was verified.
        if (action === "report_payment_receipt" || action === "verify_payment") {
          const payment = data.payments.find((item) => item.id === b.paymentId);
          if (payment) await noticeReceiptStep(client, {
            workspaceId, caseId, payment, step: action === "report_payment_receipt" ? "reported" : "verified", actorUserId: user.userId, revision: data.revision,
            reporterUserId: data.receipts?.find((receipt) => receipt.paymentId === payment.id && receipt.status !== "rejected")?.reportedById ?? null,
            dealWaiting: data.ownerReview?.status === "pending_approval" || data.ownerReview?.status === "pending_finance", demo: this.testMode,
          });
        }
        // The answer shows the filled quote, under the same revision.
        const answer = prefilled ? await this.load(client, workspaceId, caseId) : data;
        return sent ? { data: answer, sent } : { data: answer };
      },
    );
  }

  private async notifyDealReview(client: PoolClient, workspaceId: string, caseId: string, data: CommercialData, action: string, actorUserId: string) {
    const review = data.ownerReview;
    if (!review) return;
    const pendingFinance = action === "submit_owner_review";
    const pendingOwner = action === "review_deal_finance" && review.status === "pending_approval";
    const recipientPermission = pendingFinance ? "commercial.finance.verify" : pendingOwner ? "commercial.deal.approve" : null;
    const eventType = pendingFinance ? "commercial.deal.pending_finance" : pendingOwner ? "commercial.deal.pending_approval" : "commercial.deal.decision";
    const subject = pendingFinance ? "Deal File needs Finance review" : pendingOwner ? "Deal File needs approval" : review.status === "approved" ? "Deal File approved" : "Deal File returned for correction";
    const body = pendingFinance ? "Verify payment evidence and final commission amounts." : pendingOwner ? "Review the Finance-confirmed Deal File." : review.decisionNote || review.financeNote || `Deal File status: ${review.status}.`;
    const recipients = recipientPermission
      ? await client.query<{ userId: string }>(
          `SELECT DISTINCT membership.user_id AS "userId"
           FROM workspace_memberships membership
           JOIN users account ON account.id=membership.user_id AND account.status='active'
           JOIN effective_member_roles assigned ON assigned.membership_id=membership.id
           JOIN role_permissions granted ON granted.role_id=assigned.role_id
           JOIN permissions permission ON permission.id=granted.permission_id
           WHERE membership.workspace_id=$1 AND membership.status='active'
             AND permission.code=$2 AND membership.user_id<>$3
             AND membership.user_id IS DISTINCT FROM $4::uuid`,
          // Whoever may act is told, by permission; the submitter never approves their own deal.
          [workspaceId, recipientPermission, actorUserId, pendingOwner ? review.submittedById ?? null : null],
        )
      : { rows: [{ userId: review.submittedById }] };
    for (const recipient of recipients.rows) {
      const preference = await client.query<{ enabled: boolean }>(
        `SELECT enabled FROM notification_preferences
         WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2
           AND channel='in_app' AND event_type IN ($3,'commercial.deal.*','*')
         ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'commercial.deal.*' THEN 1 ELSE 2 END LIMIT 1`,
        [workspaceId, recipient.userId, eventType],
      );
      if (preference.rows[0]?.enabled === false) continue;
      await client.query(
        `INSERT INTO notifications
          (workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,
           deep_link,idempotency_key,correlation_id,delivered_at)
         VALUES ($1,'user',$2,'in_app',$3,'delivered',$4,$5,$6,$7,$8,now())
         ON CONFLICT (workspace_id,idempotency_key) DO NOTHING`,
        [workspaceId, recipient.userId, eventType, subject, body,
          `/workspace/pre-projects/cases/${caseId}/approvals`,
          `deal:${review.id}:${action}:${data.revision}:${recipient.userId}`, randomUUID()],
      );
    }
  }
}
/**
 * Up to ten of the team's own uploads on this case (photos or PDFs, not the client's and not already attached to a
 * conversation) for a reply the client reads. An internal note carries no files.
 */
export async function teamReplyFiles(client: Pick<PoolClient, "query">, workspaceId: string, caseId: string, visibility: "client" | "internal", value: unknown): Promise<string[]> {
  if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return [];
  if (visibility !== "client") throw new BadRequestException("Files go with a reply the client reads, not an internal note.");
  const ids = Array.isArray(value) ? [...new Set(value)] : [];
  if (!ids.length || ids.length > 10 || !ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw new BadRequestException("Attach up to 10 photos or PDFs.");
  const rows = (await client.query<{ id: string; attached: boolean }>(
    `SELECT asset.id, EXISTS (SELECT 1 FROM client_portal_attachments attachment WHERE attachment.workspace_id = asset.workspace_id AND attachment.asset_id = asset.id) AS attached
       FROM pre_project_brief_assets asset
      WHERE asset.workspace_id = $1 AND asset.case_id = $2 AND asset.id = ANY($3::uuid[]) AND asset.client_grant_id IS NULL`, [workspaceId, caseId, ids])).rows;
  if (rows.length !== ids.length) throw new BadRequestException("One of the files isn't on this project any more. Upload it again.");
  if (rows.some((row) => row.attached)) throw new ConflictException("One of the files was already sent. Upload it again to send it here too.");
  return ids as string[];
}

function uuid(value: unknown, label: string) {
  const id = text(value, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException(`Choose a valid ${label}.`);
  return id;
}
function catalogSnapshotRate(snapshot: CatalogPriceSnapshot) {
  if (snapshot.status !== "resolved") return 0;
  return snapshot.override?.amount ?? snapshot.rateCard?.appliedUnitRate ?? 0;
}
function sameCatalogPriceSelection(
  snapshot: CatalogPriceSnapshot,
  line: import("./commercial.types").QuoteLine,
) {
  const selected = (role: string) =>
    line.catalogLinks?.find((selection) => selection.role === role);
  const work = selected("work"),
    variant = selected("variant"),
    unit = selected("unit");
  return Boolean(
    work &&
      snapshot.catalogId === work.snapshot.catalogId &&
      snapshot.work.id === work.recordId &&
      snapshot.work.version === work.version &&
      snapshot.variant?.id === variant?.recordId &&
      snapshot.variant?.version === variant?.version &&
      (!unit ||
        (snapshot.unit?.id === unit.recordId &&
          snapshot.unit?.version === unit.version)),
  );
}

/** Preserve the exact resolved evidence unless a quote basis changed. */
export function retainedCatalogPrice(
  previous: CatalogPriceSnapshot,
  line: QuoteLine,
  currencyCode: string,
  taxRate: number,
) {
  const snapshot = structuredClone(previous);
  const unchangedBasis =
    previous.quantity === line.quantity &&
    previous.currency === currencyCode &&
    previous.taxRate === taxRate &&
    (previous.unitLabel === undefined || previous.unitLabel === line.unit);
  if (unchangedBasis) return snapshot;
  return {
    ...snapshot,
    status: "stale" as const,
    issue: {
      code: "stale",
      message: "Refresh this price after changing quantity, currency or tax.",
    },
  };
}
