import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Db } from "../ledger/ledger";
import { readAgeing } from "./ageing";
import { listJournals, readJournalDetail } from "./journals";
import { add, isDay, neg, quarterOf } from "./report-math";
import { isUuid, listReportEntities, resolveScope } from "./report-scope";
import { COMPANY_REPORTS, type AccountsList, type BooksReportCode, type JournalList, type LedgerOverview, type ReportEntity } from "./report-types";
import { accountBalances, profitToDate, readBalanceSheet, readGeneralLedger, readProfitAndLoss, readTrialBalance } from "./statements";
import { missingRegion, payableOf, readVatReport } from "./vat-report";
import type { CsvReport } from "./report-csv";

/** The Ledger area's reads, each inside the member's tenant transaction (forced RLS). */

export function isCompanyReport(code: string): code is BooksReportCode {
  return (COMPANY_REPORTS as readonly string[]).includes(code);
}

export async function readCompanyReport(db: Db, workspaceId: string, code: string, query: Record<string, unknown>): Promise<CsvReport> {
  if (!isCompanyReport(code)) throw new NotFoundException("Unknown report");
  const { entity, scope } = await resolveScope(db, workspaceId, query);
  switch (code) {
    case "trial-balance": return readTrialBalance(db, workspaceId, entity, scope);
    case "profit-and-loss": return readProfitAndLoss(db, workspaceId, entity, scope);
    case "balance-sheet": return readBalanceSheet(db, workspaceId, entity, scope);
    case "vat": return readVatReport(db, workspaceId, entity, scope, { box: typeof query.box === "string" && /^[0-9]{1,3}[a-z]?$/.test(query.box) ? query.box : null });
    case "ar-ageing": return readAgeing(db, workspaceId, entity, scope, "receivable");
    case "ap-ageing": return readAgeing(db, workspaceId, entity, scope, "payable");
    case "general-ledger": {
      if (!isUuid(query.account)) throw new BadRequestException("Choose an account");
      return readGeneralLedger(db, workspaceId, entity, scope, query.account);
    }
  }
}

export async function readAccountLedger(db: Db, workspaceId: string, accountId: string, query: Record<string, unknown>) {
  if (!isUuid(accountId)) throw new NotFoundException("Account not found");
  // The account's own company, unless the query names one (then it must be that company's).
  const owner = (await db.query<{ legalEntityId: string }>(`SELECT legal_entity_id AS "legalEntityId" FROM books_accounts WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, accountId])).rows[0];
  if (!owner) throw new NotFoundException("Account not found");
  const { entity, scope } = await resolveScope(db, workspaceId, { ...query, entity: typeof query.entity === "string" && query.entity ? query.entity : owner.legalEntityId });
  if (entity.id !== owner.legalEntityId) throw new NotFoundException("Account not found");
  return readGeneralLedger(db, workspaceId, entity, scope, accountId);
}

export async function readAccounts(db: Db, workspaceId: string, query: Record<string, unknown>): Promise<AccountsList> {
  const { entity, scope } = await resolveScope(db, workspaceId, query);
  const { rows } = await accountBalances(db, workspaceId, scope, entity.fiscalYearStartMonth);
  return { scope, entity, accounts: rows.filter((row) => row.accountId) };
}

/**
 * Journals for a company and period. With `project` (project profit's links), the company defaults to the one the
 * project's journals are in, and the period to everything since the Ledger started.
 */
export async function readJournals(db: Db, workspaceId: string, query: Record<string, unknown>): Promise<JournalList> {
  const project = isUuid(query.project) ? query.project : null;
  let scoped = query;
  if (project && !(typeof query.entity === "string" && query.entity)) {
    const owner = (await db.query<{ legalEntityId: string }>(
      `SELECT legal_entity_id AS "legalEntityId" FROM books_journal_lines WHERE workspace_id = $1 AND project_id = $2 LIMIT 1`, [workspaceId, project])).rows[0];
    if (owner) scoped = { ...scoped, entity: owner.legalEntityId };
  }
  const { entity, scope } = await resolveScope(db, workspaceId, scoped);
  if (project && !(typeof query.from === "string" && query.from) && entity.startDate < scope.from) scope.from = entity.startDate;
  return listJournals(db, workspaceId, entity, scope, query);
}

export async function readJournal(db: Db, workspaceId: string, journalId: string) {
  if (!isUuid(journalId)) throw new NotFoundException("Journal not found");
  return readJournalDetail(db, workspaceId, journalId);
}

/**
 * The Ledger at a glance for one company (the requested one, else the first with books): cash, what clients owe,
 * what is owed to suppliers, VAT due for this quarter and profit for this financial year, all at today (or `to`).
 */
export async function readOverview(db: Db, workspaceId: string, query: Record<string, unknown>, can: { canManage: boolean; canPost: boolean }): Promise<LedgerOverview> {
  const { canManage, canPost } = can;
  const entities = await listReportEntities(db, workspaceId);
  const openIssues = (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM books_posting_issues WHERE workspace_id = $1 AND resolved_at IS NULL`,
    [workspaceId])).rows[0].count;
  const requested = typeof query.entity === "string" ? query.entity : "";
  const entity: ReportEntity | undefined = entities.find((row) => row.id === requested) ?? entities[0];
  if (!entity) return { entities, entity: null, canManage, canPost, balances: null, vatPeriod: null, fiscalYear: null, openIssues };
  // At today in the company's time zone, or the day asked for.
  const today = isDay(query.to) ? query.to : entity.today;
  const { from: yearFrom, profit } = await profitToDate(db, workspaceId, entity.id, today, entity.fiscalYearStartMonth);
  const { rows } = await accountBalances(db, workspaceId, { legalEntityId: entity.id, from: yearFrom, to: today }, entity.fiscalYearStartMonth);
  const sumOf = (pick: (row: (typeof rows)[number]) => boolean, creditSide = false) => {
    const total = add(...rows.filter(pick).map((row) => row.closing));
    return creditSide ? neg(total) : total;
  };
  const quarter = quarterOf(today);
  const vat = await readVatReport(db, workspaceId, entity, { legalEntityId: entity.id, from: quarter.from, to: today });
  return {
    entities, entity, canManage, canPost, openIssues,
    balances: {
      cash: sumOf((row) => row.type === "asset" && (row.subtype === "bank" || row.subtype === "cash")),
      receivables: sumOf((row) => row.roles.includes("ar_control")),
      payables: sumOf((row) => row.roles.includes("ap_control"), true),
      vatDue: payableOf(vat),
      profitThisYear: profit,
    },
    vatPeriod: vat.layout ? { from: quarter.from, to: quarter.to } : null,
    // Lines the return can't place without a region: the VAT due shown leaves them out, so the overview says so.
    vatMissingRegion: missingRegion(vat),
    fiscalYear: { from: yearFrom, to: today },
  };
}
