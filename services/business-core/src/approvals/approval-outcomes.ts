import type { PoolClient } from "pg";
import { applyManualJournalDecision } from "../books/journals/manual-journal-approval";
import { applyChangeApproval } from "../change-requests/change-request.store";
import { applyLedgerChangeOutcome } from "../change-requests/ledger-change-approval";
import { applyValueDecision } from "../crm/opportunities/opportunity-proposals";
import { applyDesignRateDecision } from "../crm/opportunities/design-rate-approval";
import { applyFinanceRequestDecision } from "../finance-requests/finance-request-approval";
import type { ApprovalDecision, ApprovalStatus } from "./approval-policy";

type Db = Pick<PoolClient, "query">;
type Outcome = (db: Db, workspaceId: string, approval: ApprovalStatus, decision: ApprovalDecision, actorUserId: string, note: string | null) => Promise<void>;

/**
 * What a decision made in the Approvals inbox does to its subject, per kind, in the same transaction as the
 * decision. A kind decided only on its own screen (see KINDS_WITH_OWN_INBOX_ROW) needs no entry here.
 */
export const APPROVAL_OUTCOMES: Partial<Record<string, Outcome>> = {
  opportunity_value: applyValueDecision,
  change_request: applyChangeApproval,
  ledger_change: applyLedgerChangeOutcome,
  refund: applyFinanceRequestDecision,
  payable_request: applyFinanceRequestDecision,
  manual_journal: applyManualJournalDecision,
  design_rate: applyDesignRateDecision,
};
