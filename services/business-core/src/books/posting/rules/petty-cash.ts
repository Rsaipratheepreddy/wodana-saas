import type { Db, JournalDraft, PendingEvent, PostingIssueResult } from "../../ledger/ledger";
import {
  accountId, isIssue, issue, journalExists, Lines, localDay, party, paymentAccount, pendingRows, projectCompany, role, type RuleAdapter, settingsFor, SINGLE_ENABLED, startOf,
} from "../support";

/**
 * Petty cash (P12, P13): an approved claim is a site expense of its project owed to the person who spent it; the
 * reimbursement pays them from cash. The company is the one that contracted the project.
 */

const source = (event: PendingEvent) => ({ type: event.sourceType, id: event.sourceId, event: event.sourceEvent, label: event.label, href: event.href });
const COMPANY = `coalesce(${projectCompany("claim.project_id")}, ${SINGLE_ENABLED})`;
const LABEL = `'PC-' || lpad(claim.number::text, 4, '0')`;
const HREF = `'/workspace/finance/petty-cash?claim=' || claim.id::text`;

type Claim = { id: string; projectId: string; claimedBy: string; amount: string; currency: string; description: string };

async function readClaim(db: Db, workspaceId: string, claimId: string) {
  return (await db.query<Claim>(
    `SELECT claim.id, claim.project_id AS "projectId", claim.claimed_by AS "claimedBy", claim.amount::text AS amount, btrim(claim.currency) AS currency, claim.description
       FROM petty_cash_claims claim WHERE claim.workspace_id = $1 AND claim.id = $2`, [workspaceId, claimId])).rows[0] ?? null;
}

async function approvedDraft(db: Db, workspaceId: string, event: PendingEvent): Promise<JournalDraft | PostingIssueResult> {
  const claim = await readClaim(db, workspaceId, event.sourceId);
  if (!claim) return issue("no_entity", "The claim is no longer there.");
  const settings = await settingsFor(db, workspaceId, event.legalEntityId);
  if (isIssue(settings)) return settings;
  const lines = new Lines(claim.currency)
    .debit(role("cost_site_expenses"), claim.amount, { projectId: claim.projectId, description: claim.description })
    .credit(role("employee_claims_payable"), claim.amount, { party: party("employee", claim.claimedBy), description: claim.description });
  return { legalEntityId: settings.legalEntityId, eventDate: event.eventDate, currency: claim.currency, description: event.label, lines: lines.lines, source: source(event) };
}

/** P12 petty cash approved (dated the day it was approved). */
export const pettyCashApproved: RuleAdapter = {
  rule: "P12",
  sourceType: "petty_cash",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "petty_cash", limit,
    `SELECT claim.id::text AS source_id, 'approved' AS source_event, ${COMPANY} AS entity_id, ${localDay("claim.decided_at")} AS event_date, claim.decided_at AS at,
            ${LABEL} AS label, ${HREF} AS href
       FROM petty_cash_claims claim WHERE claim.workspace_id = $1 AND claim.status IN ('approved', 'reimbursed') AND claim.decided_at IS NOT NULL`),
  build: (db, workspaceId, event) => approvedDraft(db, workspaceId, event),
};

/** P13 petty cash reimbursed (paid from cash). */
export const pettyCashReimbursed: RuleAdapter = {
  rule: "P13",
  sourceType: "petty_cash",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "petty_cash", limit,
    `SELECT claim.id::text AS source_id, 'reimbursed' AS source_event, ${COMPANY} AS entity_id, ${localDay("claim.reimbursed_at")} AS event_date,
            claim.reimbursed_at AS at, ${LABEL} AS label, ${HREF} AS href
       FROM petty_cash_claims claim WHERE claim.workspace_id = $1 AND claim.status = 'reimbursed' AND claim.reimbursed_at IS NOT NULL
        AND (${journalExists("petty_cash", "claim.id::text", "approved")} OR ${localDay("claim.decided_at")} < ${startOf(COMPANY)})`),
  build: async (db, workspaceId, event) => {
    const claim = await readClaim(db, workspaceId, event.sourceId);
    if (!claim) return issue("no_entity", "The claim is no longer there.");
    const settings = await settingsFor(db, workspaceId, event.legalEntityId);
    if (isIssue(settings)) return settings;
    const cash = await paymentAccount(db, workspaceId, settings.legalEntityId, "out", "cash");
    if (isIssue(cash)) return cash;
    const claimant = party("employee", claim.claimedBy);
    const lines = new Lines(claim.currency)
      .debit(role("employee_claims_payable"), claim.amount, { party: claimant, description: claim.description })
      .credit(accountId(cash), claim.amount, { party: claimant, description: claim.description });
    return { legalEntityId: settings.legalEntityId, eventDate: event.eventDate, currency: claim.currency, description: event.label, lines: lines.lines, source: source(event) };
  },
};
