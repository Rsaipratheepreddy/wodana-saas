import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { BooksPartyType } from "../books-contract";
import type { Db } from "../ledger/ledger";
import { partyNames } from "./parties";
import { listReportEntities } from "./report-scope";
import type { BooksReportQuery, JournalDetail, JournalLineDetail, JournalList, JournalSummary, ReportEntity } from "./report-types";

/** Posted journals: the list for a company and period, and one journal with its lines and the record it came from. */

const SUMMARY = `journal.id, journal.number, journal.journal_date::text AS "journalDate", journal.event_date::text AS "eventDate", journal.late, journal.kind,
  journal.source_type AS "sourceType", journal.source_event AS "sourceEvent", journal.source_label AS "sourceLabel", journal.source_href AS "sourceHref",
  journal.description, journal.currency, journal.total::text AS total`;

const KINDS = ["auto", "manual", "opening", "reversal"];

export async function listJournals(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery, query: Record<string, unknown>): Promise<JournalList> {
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const kind = typeof query.kind === "string" && query.kind ? query.kind : null;
  if (kind && !KINDS.includes(kind)) throw new BadRequestException("Unknown journal kind");
  // A project's journals: those with any line for the project (project profit links here).
  const project = typeof query.project === "string" && query.project ? query.project : null;
  if (project && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project)) throw new BadRequestException("Unknown project");
  const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 1000);
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
  const params = [workspaceId, scope.legalEntityId, scope.from, scope.to, search ? `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null, kind, project];
  const where = `journal.workspace_id = $1 AND journal.legal_entity_id = $2 AND journal.journal_date BETWEEN $3::date AND $4::date
    AND ($5::text IS NULL OR journal.number ILIKE $5 OR journal.source_label ILIKE $5 OR journal.description ILIKE $5)
    AND ($6::text IS NULL OR journal.kind = $6)
    AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM books_journal_lines line WHERE line.workspace_id = journal.workspace_id AND line.journal_id = journal.id
                                       AND line.project_id = $7::uuid))`;
  const journals = (await db.query<JournalSummary>(
    `SELECT ${SUMMARY} FROM books_journals journal WHERE ${where} ORDER BY journal.journal_date DESC, journal.number DESC LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM books_journals journal WHERE ${where}`, params)).rows[0].count;
  return { scope, entity, project, journals: await withPartyNames(db, workspaceId, journals), total, limit, offset };
}

/** Each journal's party: the first line that names a client, supplier, employee or team, by position. */
async function withPartyNames(db: Db, workspaceId: string, journals: JournalSummary[]): Promise<JournalSummary[]> {
  if (!journals.length) return journals;
  const parties = (await db.query<{ journalId: string; partyType: BooksPartyType; partyId: string }>(
    `SELECT DISTINCT ON (line.journal_id) line.journal_id AS "journalId", line.party_type AS "partyType", line.party_id AS "partyId"
       FROM books_journal_lines line
      WHERE line.workspace_id = $1 AND line.journal_id = ANY($2::uuid[]) AND line.party_type IS NOT NULL AND line.party_id IS NOT NULL
      ORDER BY line.journal_id, line.position`, [workspaceId, journals.map((journal) => journal.id)])).rows;
  const names = await partyNames(db, workspaceId, parties);
  const byJournal = new Map(parties.map((party) => [party.journalId, names.get(`${party.partyType}:${party.partyId}`) ?? null]));
  return journals.map((journal) => ({ ...journal, partyName: byJournal.get(journal.id) ?? null }));
}

type LineRow = Omit<JournalLineDetail, "partyName" | "partyType"> & { partyType: BooksPartyType | null };

export async function readJournalDetail(db: Db, workspaceId: string, journalId: string): Promise<JournalDetail> {
  const journal = (await db.query<JournalDetail["journal"] & { legalEntityId: string }>(
    `SELECT ${SUMMARY}, journal.legal_entity_id AS "legalEntityId", journal.functional_currency AS "functionalCurrency", journal.rate::text AS rate,
            journal.reverses_journal_id AS "reversesJournalId", journal.posted_at::text AS "postedAt",
            (SELECT reversal.id FROM books_journals reversal WHERE reversal.workspace_id = journal.workspace_id AND reversal.reverses_journal_id = journal.id) AS "reversedByJournalId",
            (SELECT coalesce(nullif(btrim(person.display_name), ''), person.primary_email) FROM users person WHERE person.id = journal.posted_by) AS "postedByName"
       FROM books_journals journal WHERE journal.workspace_id = $1 AND journal.id = $2`, [workspaceId, journalId])).rows[0];
  if (!journal) throw new NotFoundException("Journal not found");
  const entity = (await listReportEntities(db, workspaceId)).find((row) => row.id === journal.legalEntityId);
  if (!entity) throw new NotFoundException("Journal not found");
  const lines = (await db.query<LineRow>(
    `SELECT line.id, line.position, line.account_id AS "accountId", account.code AS "accountCode", account.name AS "accountName",
            line.debit::text AS debit, line.credit::text AS credit, line.doc_amount::text AS "docAmount", line.description,
            line.project_id AS "projectId", nullif(concat_ws(' · ', nullif(btrim(project.reference), ''), project.name), '') AS "projectName",
            line.party_type AS "partyType", line.party_id AS "partyId", tax.code AS "taxCode", line.tax_base::text AS "taxBase", line.tax_region AS "taxRegion"
       FROM books_journal_lines line
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.legal_entity_id = line.legal_entity_id AND account.id = line.account_id
       LEFT JOIN books_tax_codes tax ON tax.workspace_id = line.workspace_id AND tax.legal_entity_id = line.legal_entity_id AND tax.id = line.tax_code_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.journal_id = $2 ORDER BY line.position`, [workspaceId, journalId])).rows;
  const names = await partyNames(db, workspaceId, lines);
  const { legalEntityId: _legalEntityId, ...summary } = journal;
  void _legalEntityId;
  return {
    entity, journal: summary,
    lines: lines.map((line) => ({ ...line, partyName: line.partyType && line.partyId ? names.get(`${line.partyType}:${line.partyId}`) ?? null : null })),
  };
}
