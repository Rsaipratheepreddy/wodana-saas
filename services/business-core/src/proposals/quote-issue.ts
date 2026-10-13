import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { quotePricingSnapshot, readSettings } from "../quotation/quotation-builder.service";
import { markupDisclosure } from "./markup-disclosure";
import { pricingHash, qsStage } from "./qs-review.domain";
import { qsRequirement } from "./qs-requirement";
import { specificationGateProblem } from "../design/finishes.store";

type Db = Pick<PoolClient, "query">;

/** The legal entity that numbers a case's quotations: the opportunity's, else the workspace's first active one. */
export async function quotingEntity(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; countryCode: string }>(
    `SELECT entity.id, entity.country_code AS "countryCode" FROM legal_entities entity
      WHERE entity.workspace_id = $1 AND entity.status = 'active'
        AND entity.id = coalesce(
          (SELECT opportunity.legal_entity_id FROM pre_project_cases pre_case
             JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
            WHERE pre_case.workspace_id = $1 AND pre_case.id = $2),
          (SELECT first.id FROM legal_entities first WHERE first.workspace_id = $1 AND first.status = 'active' ORDER BY first.created_at LIMIT 1))`,
    [workspaceId, caseId])).rows[0] ?? null;
}

/** The business that issues a case's quotation (PLM-112): the one its number was allocated under, else the quoting entity. */
export async function quotationEntityId(db: Db, workspaceId: string, caseId: string, familyId: string) {
  const numbered = (await db.query<{ entityId: string | null }>(
    `SELECT legal_entity_id AS "entityId" FROM quotation_references WHERE workspace_id = $1 AND case_id = $2 AND family_id = $3`, [workspaceId, caseId, familyId])).rows[0]?.entityId;
  return numbered ?? (await quotingEntity(db, workspaceId, caseId))?.id ?? null;
}

/** The number a quote family carries (allocated or the firm's own), or null before it was first sent. */
export async function quotationReference(db: Db, workspaceId: string, caseId: string, familyId: string) {
  return (await db.query<{ reference: string; source: "allocated" | "external" }>(
    `SELECT reference, source FROM quotation_references WHERE workspace_id = $1 AND case_id = $2 AND family_id = $3`,
    [workspaceId, caseId, familyId])).rows[0] ?? null;
}

/**
 * Gives a quote family its quotation number the first time one of its revisions is sent: allocated from the
 * entity's QUOTATION sequence (prefix, number, suffix) under the sequence's row lock, in the sending
 * transaction, so a failed send returns the number and two sends never share one. Revisions keep the number.
 * Without a legal entity or a quotation sequence the quote keeps its plain revision label.
 */
export async function assignQuotationReference(db: Db, input: { workspaceId: string; caseId: string; familyId: string; actorUserId: string | null }) {
  const existing = await quotationReference(db, input.workspaceId, input.caseId, input.familyId);
  if (existing) return existing.reference;
  const entity = await quotingEntity(db, input.workspaceId, input.caseId);
  if (!entity) return null;
  const numbered = (await db.query(`SELECT 1 FROM document_sequences WHERE workspace_id = $1 AND legal_entity_id = $2 AND document_type = 'QUOTATION'`,
    [input.workspaceId, entity.id])).rowCount;
  if (!numbered) return null;
  const reference = (await db.query<{ number: string }>(`SELECT allocate_document_number($1, $2, 'QUOTATION') AS number`, [input.workspaceId, entity.id])).rows[0].number;
  try {
    await db.query(`SAVEPOINT quotation_reference`);
    await db.query(
      `INSERT INTO quotation_references (workspace_id, case_id, family_id, legal_entity_id, reference, source, created_by) VALUES ($1, $2, $3, $4, $5, 'allocated', $6)`,
      [input.workspaceId, input.caseId, input.familyId, entity.id, reference, input.actorUserId]);
    await db.query(`RELEASE SAVEPOINT quotation_reference`);
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT quotation_reference`);
    if ((error as { code?: string }).code === "23505")
      throw new ConflictException(`The next quotation number, ${reference}, is already used. Move the quotation numbering forward in Settings.`);
    throw error;
  }
  await recordAudit(db, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "quotation.number_assigned.v1", entityType: "pre_project_case",
    entityId: input.caseId, after: { familyId: input.familyId, reference, legalEntityId: entity.id } });
  return reference;
}

/** Whether the QS has confirmed this quote's current pricing (PLM-082), and who is holding it if not. */
export async function qsReviewFor(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  return (await db.query<{ id: string; status: "with_qs" | "confirmed" | "returned"; pricingHash: string | null; assigneeUserId: string }>(
    `SELECT id, status, pricing_hash AS "pricingHash", assignee_user_id AS "assigneeUserId" FROM quote_qs_reviews
      WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [workspaceId, caseId, quoteId])).rows[0] ?? null;
}

/**
 * Runs inside the commercial "issue" command, before the quote is marked sent: refuses a quotation the QS
 * hasn't confirmed at its current pricing (when the firm prices with QS), gives the family its number and
 * records the markup disclosure the client is shown. Idempotent per quote.
 */
export async function beforeQuoteIssued(db: Db, input: { workspaceId: string; caseId: string; quoteId: string; familyId: string | null; kind: string; actorUserId: string; qsEstimated?: boolean }) {
  // PLM-146: the final quotation (Proposal 2) goes once the design and specifications are final, where the firm asks for
  // it (Settings › Design); a budget range the client asked for may go before.
  if (input.kind === "quotation") {
    const waiting = await specificationGateProblem(db, input.workspaceId, input.caseId, input.quoteId);
    if (waiting) throw new ConflictException(waiting);
  }
  const settings = await readSettings(db as PoolClient, input.workspaceId);
  // PLM-082/083/084: the QS confirms the pricing where the firm's rules say this quotation needs it (qs-requirement.ts).
  // The QS estimate on this exact version (qsEstimated) is that confirmation too: the QS prices a quotation once.
  if (input.kind === "quotation" && !input.qsEstimated && (await qsRequirement(db, input.workspaceId, input.caseId, input.quoteId)).required) {
    const review = await qsReviewFor(db, input.workspaceId, input.caseId, input.quoteId);
    const snapshot = await quotePricingSnapshot(db as PoolClient, input.workspaceId, input.caseId, input.quoteId);
    const stage = qsStage(true, review, pricingHash(snapshot.lines));
    if (stage !== "confirmed")
      throw new ConflictException(stage === "with_qs" ? "This quotation is with the QS. It can be sent once they confirm the pricing."
        : stage === "stale" ? "The pricing changed after the QS confirmed it. Send it to the QS again before sending it to the client."
          : "Send this quotation to the QS to confirm the pricing before it goes to the client.");
  }
  const reference = input.kind === "quotation"
    ? await assignQuotationReference(db, { workspaceId: input.workspaceId, caseId: input.caseId, familyId: input.familyId ?? input.quoteId, actorUserId: input.actorUserId })
    : null;
  await db.query(
    `INSERT INTO quote_issue_snapshots (workspace_id, case_id, quote_id, reference, markup_disclosure, issued_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, case_id, quote_id) DO UPDATE SET reference = excluded.reference, markup_disclosure = excluded.markup_disclosure,
       issued_by = excluded.issued_by, issued_at = now()`,
    [input.workspaceId, input.caseId, input.quoteId, reference, markupDisclosure(settings.markupDisclosure), input.actorUserId]);
  return { reference };
}
