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
  const scopeToday = { legalEntityId: entity.id, from: yearFrom, to: today };
  const [receivable, payable] = [await readAgeing(db, workspaceId, entity, scopeToday, "receivable"), await readAgeing(db, workspaceId, entity, scopeToday, "payable")];
  const overdue = (report: typeof receivable) => add(report.totals["1_30"], report.totals["31_60"], report.totals["61_90"], report.totals.over_90);
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
    trend: await balanceTrend(db, workspaceId, entity.id, today),
    attention: {
      overdueReceivables: overdue(receivable),
      overduePayables: overdue(payable),
      manualWaiting: (await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM books_manual_journals WHERE workspace_id = $1 AND legal_entity_id = $2 AND status = 'submitted'`, [workspaceId, entity.id])).rows[0].count,
      unbalanced: !(await readTrialBalance(db, workspaceId, entity, scopeToday)).balanced,
    },
    recent: (await listJournals(db, workspaceId, entity, { legalEntityId: entity.id, from: entity.startDate, to: today }, { limit: 6 })).journals,
  };
}

/** Month ends of the last six months (the last one is `today`). */
export function trendDays(today: string): string[] {
  const days: string[] = [];
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  for (let back = 5; back >= 1; back -= 1) days.push(new Date(Date.UTC(year, month - back, 0)).toISOString().slice(0, 10));
  days.push(today);
  return days;
}

/** Cash, receivables, payables and VAT owed at each of the last six month ends (debit positive for cash and receivables, credit positive for the rest). */
async function balanceTrend(db: Db, workspaceId: string, legalEntityId: string, today: string) {
  const days = trendDays(today);
  const rows = (await db.query<{ day: string; cash: string; receivables: string; payables: string; vat: string }>(
    `WITH roles AS (SELECT mapping.account_id, mapping.role FROM books_account_roles mapping WHERE mapping.workspace_id = $1 AND mapping.legal_entity_id = $2)
     SELECT point.day::text AS day,
            coalesce(sum(line.debit - line.credit) FILTER (WHERE account.type = 'asset' AND account.subtype IN ('bank', 'cash')), 0)::numeric(24, 4)::text AS cash,
            coalesce(sum(line.debit - line.credit) FILTER (WHERE account.id IN (SELECT account_id FROM roles WHERE role = 'ar_control')), 0)::numeric(24, 4)::text AS receivables,
            coalesce(sum(line.credit - line.debit) FILTER (WHERE account.id IN (SELECT account_id FROM roles WHERE role = 'ap_control')), 0)::numeric(24, 4)::text AS payables,
            coalesce(sum(line.credit - line.debit) FILTER (WHERE account.id IN (SELECT account_id FROM roles WHERE role IN ('vat_output', 'vat_input', 'vat_advance_contra'))), 0)::numeric(24, 4)::text AS vat
       FROM unnest($3::date[]) AS point(day)
       LEFT JOIN books_journals journal ON journal.workspace_id = $1 AND journal.legal_entity_id = $2 AND journal.journal_date <= point.day
       LEFT JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id
       LEFT JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.account_id
      GROUP BY point.day ORDER BY point.day`, [workspaceId, legalEntityId, days])).rows;
  return { days, cash: rows.map((row) => row.cash), receivables: rows.map((row) => row.receivables), payables: rows.map((row) => row.payables), vat: rows.map((row) => row.vat) };
}
