import type { BooksPartyType } from "../books-contract";
import type { Db } from "../settings/books-common";

/** Reading manual and opening journals and their lines (books_manual_journals), shared by the commands and the approval outcome. */

export type ManualJournalStatus = "draft" | "submitted" | "returned" | "approved" | "cancelled";

export const journalLink = (id: string) => `/workspace/ledger/journals?manual=${id}`;

export type ManualJournalRow = {
  id: string; legalEntityId: string; companyName: string; reference: string; kind: "manual" | "opening"; journalDate: string; currency: string; memo: string;
  status: ManualJournalStatus; preparedBy: string; preparedByName: string; submittedAt: string | null; returnedReason: string | null; approvedBy: string | null;
  approvedByName: string | null; approvedAt: string | null; cancelledAt: string | null; postedJournalId: string | null; postedNumber: string | null;
  debit: string; credit: string; lineCount: number; version: number; updatedAt: string;
};

export type ManualLineView = {
  id: string; position: number; accountId: string; accountCode: string; accountName: string; debit: string; credit: string; description: string;
  projectId: string | null; projectName: string | null; partyType: BooksPartyType | null; partyId: string | null; partyName: string | null; taxCodeId: string | null;
};

export async function readJournalRows(db: Db, workspaceId: string, filter: { id?: string; legalEntityId?: string; status?: string; forUpdate?: boolean } = {}) {
  if (filter.forUpdate && filter.id) await db.query(`SELECT 1 FROM books_manual_journals WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, filter.id]);
  return (await db.query<ManualJournalRow>(
    `SELECT journal.id, journal.legal_entity_id AS "legalEntityId", entity.display_name AS "companyName", journal.reference, journal.kind,
            journal.journal_date::text AS "journalDate", journal.currency, journal.memo, journal.status, journal.prepared_by AS "preparedBy",
            coalesce(nullif(btrim(preparer.display_name), ''), preparer.primary_email) AS "preparedByName", journal.submitted_at AS "submittedAt",
            journal.returned_reason AS "returnedReason", journal.approved_by AS "approvedBy",
            coalesce(nullif(btrim(approver.display_name), ''), approver.primary_email) AS "approvedByName", journal.approved_at AS "approvedAt",
            journal.cancelled_at AS "cancelledAt", journal.posted_journal_id AS "postedJournalId", posted.number AS "postedNumber",
            coalesce(totals.debit, 0)::text AS debit, coalesce(totals.credit, 0)::text AS credit, coalesce(totals.lines, 0)::int AS "lineCount",
            journal.version, journal.updated_at AS "updatedAt"
       FROM books_manual_journals journal
       JOIN legal_entities entity ON entity.workspace_id = journal.workspace_id AND entity.id = journal.legal_entity_id
       JOIN users preparer ON preparer.id = journal.prepared_by
       LEFT JOIN users approver ON approver.id = journal.approved_by
       LEFT JOIN books_journals posted ON posted.workspace_id = journal.workspace_id AND posted.id = journal.posted_journal_id
       LEFT JOIN LATERAL (SELECT sum(line.debit) AS debit, sum(line.credit) AS credit, count(*) AS lines FROM books_manual_journal_lines line
                           WHERE line.workspace_id = journal.workspace_id AND line.manual_journal_id = journal.id) totals ON true
      WHERE journal.workspace_id = $1 AND ($2::uuid IS NULL OR journal.id = $2) AND ($3::uuid IS NULL OR journal.legal_entity_id = $3)
        AND ($4::text IS NULL OR journal.status = $4)
      ORDER BY journal.created_at DESC LIMIT 500`,
    [workspaceId, filter.id ?? null, filter.legalEntityId ?? null, filter.status ?? null])).rows;
}

export async function readLines(db: Db, workspaceId: string, journalId: string): Promise<ManualLineView[]> {
  return (await db.query<ManualLineView>(
    `SELECT line.id, line.position, line.account_id AS "accountId", account.code AS "accountCode", account.name AS "accountName", line.debit::text AS debit,
            line.credit::text AS credit, line.description, line.project_id AS "projectId",
            CASE WHEN project.id IS NULL THEN NULL ELSE concat_ws(' · ', project.reference, project.name) END AS "projectName",
            line.party_type AS "partyType", line.party_id AS "partyId",
            CASE line.party_type
              WHEN 'client' THEN (SELECT party.display_name FROM crm_parties party WHERE party.workspace_id = line.workspace_id AND party.id = line.party_id)
              WHEN 'vendor' THEN (SELECT vendor.display_name FROM workspace_vendors vendor WHERE vendor.workspace_id = line.workspace_id AND vendor.id = line.party_id)
              WHEN 'employee' THEN (SELECT coalesce(nullif(btrim(person.display_name), ''), person.primary_email) FROM users person WHERE person.id = line.party_id)
              WHEN 'team' THEN (SELECT crew.name FROM hrms_crews crew WHERE crew.workspace_id = line.workspace_id AND crew.id = line.party_id)
            END AS "partyName", line.tax_code_id AS "taxCodeId"
       FROM books_manual_journal_lines line
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.account_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.manual_journal_id = $2 ORDER BY line.position`, [workspaceId, journalId])).rows;
}
