import { UnprocessableEntityException } from "@nestjs/common";
import { recordAudit } from "../../audit/record-audit";
import type { ApprovalDecision, ApprovalStatus } from "../../approvals/approval-policy";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";
import { postJournal, type DraftLine, type PostedJournal } from "../ledger/ledger";
import { ledgerHttp, personName, units, type Db } from "../settings/books-common";
import { journalLink, readJournalRows, readLines, type ManualJournalRow } from "./manual-journal-store";

/**
 * What a final decision on a manual or opening journal does, in the decision's transaction (from the journal or the
 * Approvals inbox): approved, it posts through the Ledger core with its JV number (a refusal there, such as a lock
 * date moved since it was submitted, undoes the decision); returned or rejected, it goes back to its preparer with
 * the reason. The preparer hears either way (books.journal_decided). Earlier steps change nothing.
 */
export async function applyManualJournalDecision(db: Db, workspaceId: string, approval: ApprovalStatus, _decision: ApprovalDecision, actorUserId: string, note: string | null) {
  if (!["approved", "returned", "rejected"].includes(approval.status)) return;
  const journal = (await readJournalRows(db, workspaceId, { id: approval.subjectId, forUpdate: true }))[0];
  if (!journal || journal.status !== "submitted") return;
  const said = (note ?? "").trim();
  if (approval.status === "approved") {
    const posted = await postManualJournal(db, workspaceId, journal, actorUserId);
    await db.query(
      `UPDATE books_manual_journals SET status = 'approved', approved_by = $3, approved_at = now(), posted_journal_id = $4, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, journal.id, actorUserId, posted.id]);
    await recordAudit(db, { workspaceId, actorUserId, action: "books.manual_journal_approved", entityType: "books_manual_journal", entityId: journal.id,
      before: { status: journal.status }, after: { status: "approved", journalId: posted.id, number: posted.number, approvalId: approval.id, note: said || null } });
    await tellPreparer(db, workspaceId, journal, "approved", actorUserId, `Posted as ${posted.number}.${said ? ` ${said}` : ""}`, approval.id);
    return;
  }
  const reason = said || "Sent back.";
  await db.query(`UPDATE books_manual_journals SET status = 'returned', returned_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, journal.id, reason.slice(0, 1000)]);
  await recordAudit(db, { workspaceId, actorUserId, action: "books.manual_journal_returned", entityType: "books_manual_journal", entityId: journal.id,
    before: { status: journal.status }, after: { status: "returned", reason, approvalId: approval.id, decision: approval.status } });
  await tellPreparer(db, workspaceId, journal, "returned", actorUserId, reason, approval.id);
}

/** P15: the journal as entered, posted by the Ledger core (kind manual or opening), once per journal (its source key). */
export async function postManualJournal(db: Db, workspaceId: string, journal: ManualJournalRow, approverId: string): Promise<PostedJournal> {
  const lines = await readLines(db, workspaceId, journal.id);
  const draftLines: DraftLine[] = lines.map((line) => {
    const debit = units(line.debit) > 0n;
    return {
      account: { accountId: line.accountId }, side: debit ? "debit" : "credit", amount: debit ? line.debit : line.credit, description: line.description,
      projectId: line.projectId, party: line.partyType && line.partyId ? { type: line.partyType, id: line.partyId } : null, taxCodeId: line.taxCodeId,
    };
  });
  try {
    const outcome = await postJournal(db, workspaceId, {
      legalEntityId: journal.legalEntityId, kind: journal.kind, eventDate: journal.journalDate, currency: journal.currency, description: journal.memo,
      source: { type: "manual_journal", id: journal.id, event: "approved", label: journal.reference, href: journalLink(journal.id) },
      lines: draftLines, postedBy: approverId,
    });
    if (outcome.status === "posted" || outcome.status === "existing") return outcome.journal;
    // Manual and opening journals throw instead of returning an issue; a skip means a date before the start.
    throw new UnprocessableEntityException(outcome.status === "issue" ? outcome.detail : "The journal is dated before the Ledger starts.");
  } catch (error) {
    return ledgerHttp(error);
  }
}

/** books.journal_decided: the preparer, in the app and by email, once per decision; never the person who decided. */
async function tellPreparer(db: Db, workspaceId: string, journal: ManualJournalRow, outcome: "approved" | "returned", actorUserId: string, note: string, decisionKey: string) {
  if (journal.preparedBy === actorUserId) return;
  const code = "books.journal_decided";
  const variables = { reference: journal.reference, company: journal.companyName, outcome, note: note.slice(0, 480), actor: await personName(db, actorUserId) || "Wodana" };
  const key = `${code}:${decisionKey}:${journal.preparedBy}`;
  const link = journalLink(journal.id);
  await notifyUserInApp(db, { workspaceId, recipientUserId: journal.preparedBy, code, eventType: code, variables, deepLink: link, idempotencyKey: key });
  await queueUserEmail(db, { workspaceId, recipientUserId: journal.preparedBy, code, eventType: code, variables, deepLink: link, idempotencyKey: `${key}:email` });
}
