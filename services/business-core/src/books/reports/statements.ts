import { NotFoundException } from "@nestjs/common";
import type { AccountType } from "../books-contract";
import type { Db } from "../ledger/ledger";
import { add, fiscalYearStart, isZero, money, neg, sub, units, ZERO } from "./report-math";
import { partyNames } from "./parties";
import type {
  AccountBalance, BalanceSheetReport, BooksReportQuery, GeneralLedgerReport, ProfitAndLossReport, ReportEntity, StatementLine, StatementSection,
  TrialBalanceReport, TrialBalanceRow,
} from "./report-types";

/**
 * Trial balance, P&L, balance sheet, general ledger and the chart with balances, all from posted journal lines of one
 * company, by journal date. Income and expenses count from the start of the financial year; what they made before it
 * is carried in retained earnings (no closing journal is needed), so every view balances and agrees with the others.
 */

type BalanceRow = {
  accountId: string; code: string; name: string; type: AccountType; subtype: string; isControl: boolean; archived: boolean; parentId: string | null;
  roles: string[]; beforeAll: string; beforeInYear: string; debit: string; credit: string;
};

const isPnl = (type: AccountType) => type === "income" || type === "expense";

async function balanceRows(db: Db, workspaceId: string, scope: BooksReportQuery, yearStart: string, accountId?: string): Promise<BalanceRow[]> {
  return (await db.query<BalanceRow>(
    `WITH moves AS (
       SELECT line.account_id,
              coalesce(sum(line.debit - line.credit) FILTER (WHERE journal.journal_date < $4::date), 0) AS before_all,
              coalesce(sum(line.debit - line.credit) FILTER (WHERE journal.journal_date >= $3::date AND journal.journal_date < $4::date), 0) AS before_in_year,
              coalesce(sum(line.debit) FILTER (WHERE journal.journal_date >= $4::date), 0) AS debit,
              coalesce(sum(line.credit) FILTER (WHERE journal.journal_date >= $4::date), 0) AS credit
         FROM books_journal_lines line
         JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
        WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND journal.journal_date <= $5::date
          AND ($6::uuid IS NULL OR line.account_id = $6::uuid)
        GROUP BY line.account_id)
     SELECT account.id AS "accountId", account.code, account.name, account.type, account.subtype, account.is_control AS "isControl",
            account.archived_at IS NOT NULL AS archived, account.parent_id AS "parentId",
            coalesce((SELECT array_agg(mapping.role::text ORDER BY mapping.role) FROM books_account_roles mapping
                       WHERE mapping.workspace_id = account.workspace_id AND mapping.legal_entity_id = account.legal_entity_id
                         AND mapping.account_id = account.id), '{}') AS roles,
            coalesce(moves.before_all, 0)::numeric(24, 4)::text AS "beforeAll", coalesce(moves.before_in_year, 0)::numeric(24, 4)::text AS "beforeInYear",
            coalesce(moves.debit, 0)::numeric(24, 4)::text AS debit, coalesce(moves.credit, 0)::numeric(24, 4)::text AS credit
       FROM books_accounts account
       LEFT JOIN moves ON moves.account_id = account.id
      WHERE account.workspace_id = $1 AND account.legal_entity_id = $2
      ORDER BY account.code`,
    [workspaceId, scope.legalEntityId, yearStart, scope.from, scope.to, accountId ?? null])).rows;
}

/** The retained-earnings account that carries earlier years' results (its posting role, else its subtype). */
function retainedEarningsId(rows: readonly BalanceRow[]) {
  return rows.find((row) => row.roles.includes("retained_earnings"))?.accountId
    ?? rows.find((row) => row.type === "equity" && row.subtype === "retained_earnings")?.accountId ?? null;
}

/**
 * Every account with its opening (income and expenses from the start of the financial year; earlier results in
 * retained earnings), the period's debits and credits and its closing balance, debit positive.
 */
export async function accountBalances(db: Db, workspaceId: string, scope: BooksReportQuery, fiscalYearStartMonth: number): Promise<{ rows: AccountBalance[]; yearStart: string }> {
  const yearStart = fiscalYearStart(scope.from, fiscalYearStartMonth);
  const rows = await balanceRows(db, workspaceId, scope, yearStart);
  const priorResults = rows.filter((row) => isPnl(row.type)).reduce((sum, row) => sum + units(row.beforeAll) - units(row.beforeInYear), 0n);
  const retained = retainedEarningsId(rows);
  const out: AccountBalance[] = rows.map((row) => {
    let opening = units(isPnl(row.type) ? row.beforeInYear : row.beforeAll);
    if (row.accountId === retained) opening += priorResults;
    const closing = opening + units(row.debit) - units(row.credit);
    return {
      accountId: row.accountId, code: row.code, name: row.name, type: row.type, subtype: row.subtype, isControl: row.isControl, archived: row.archived,
      parentId: row.parentId, roles: row.roles, opening: money(opening), debit: row.debit, credit: row.credit, closing: money(closing),
    };
  });
  if (!retained && priorResults !== 0n) {
    out.push({ accountId: "", code: "", name: "Retained earnings", type: "equity", subtype: "retained_earnings", isControl: false, archived: false, parentId: null,
      roles: [], opening: money(priorResults), debit: ZERO, credit: ZERO, closing: money(priorResults) });
  }
  return { rows: out, yearStart };
}

const moved = (row: TrialBalanceRow) => !isZero(row.opening) || !isZero(row.debit) || !isZero(row.credit) || !isZero(row.closing);

export async function readTrialBalance(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery): Promise<TrialBalanceReport> {
  const { rows: balances, yearStart } = await accountBalances(db, workspaceId, scope, entity.fiscalYearStartMonth);
  const rows: TrialBalanceRow[] = balances.filter(moved).map(({ accountId, code, name, type, subtype, opening, debit, credit, closing }) =>
    ({ accountId, code, name, type, subtype, opening, debit, credit, closing }));
  const totals = { opening: add(...rows.map((row) => row.opening)), debit: add(...rows.map((row) => row.debit)), credit: add(...rows.map((row) => row.credit)),
    closing: add(...rows.map((row) => row.closing)) };
  return {
    report: "trial-balance", scope, entity, generatedAt: new Date().toISOString(), rows, totals, fiscalYearStart: yearStart,
    balanced: totals.debit === totals.credit && isZero(totals.closing) && isZero(totals.opening),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Statements.

function section(key: string, label: string, lines: StatementLine[], sections: StatementSection[] = []): StatementSection {
  return { key, label, lines, sections, total: add(...lines.map((line) => line.amount), ...sections.map((child) => child.total)) };
}

function linesOf(rows: readonly AccountBalance[], amount: (row: AccountBalance) => string): StatementLine[] {
  return rows.map((row) => ({ accountId: row.accountId || null, code: row.code || null, name: row.name, amount: amount(row) })).filter((line) => !isZero(line.amount));
}

/** Movement over the period of income (credit positive) and expenses (debit positive), by account. */
async function periodResult(db: Db, workspaceId: string, scope: BooksReportQuery, fiscalYearStartMonth: number) {
  const { rows } = await accountBalances(db, workspaceId, scope, fiscalYearStartMonth);
  const movement = (row: AccountBalance) => sub(row.debit, row.credit);
  const income = (row: AccountBalance) => neg(movement(row));
  const pick = (type: AccountType, subtypes: string[] | null, exclude: string[] = []) =>
    rows.filter((row) => row.type === type && (subtypes ? subtypes.includes(row.subtype) : !exclude.includes(row.subtype)));
  const revenue = section("revenue", "Revenue", linesOf(pick("income", null, ["other_income"]), income));
  const otherIncome = section("other_income", "Other income", linesOf(pick("income", ["other_income"]), income));
  const costOfSales = section("cost_of_sales", "Cost of sales", linesOf(pick("expense", ["cost_of_sales"]), movement));
  const otherExpenses = section("other_expenses", "Other expenses", linesOf(pick("expense", ["other_expense"]), movement));
  const operatingExpenses = section("operating_expenses", "Operating expenses", linesOf(pick("expense", null, ["cost_of_sales", "other_expense"]), movement));
  const grossProfit = sub(revenue.total, costOfSales.total);
  const operatingProfit = sub(grossProfit, operatingExpenses.total);
  const netProfit = sub(add(operatingProfit, otherIncome.total), otherExpenses.total);
  return {
    sections: [revenue, costOfSales, operatingExpenses, otherIncome, otherExpenses],
    totals: { revenue: revenue.total, costOfSales: costOfSales.total, grossProfit, operatingExpenses: operatingExpenses.total, operatingProfit,
      otherIncome: otherIncome.total, otherExpenses: otherExpenses.total, netProfit },
  };
}

export async function readProfitAndLoss(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery): Promise<ProfitAndLossReport> {
  return { report: "profit-and-loss", scope, entity, generatedAt: new Date().toISOString(), ...(await periodResult(db, workspaceId, scope, entity.fiscalYearStartMonth)) };
}

/** Profit or loss from the start of the financial year to `to`. */
export async function profitToDate(db: Db, workspaceId: string, legalEntityId: string, to: string, fiscalYearStartMonth: number) {
  const from = fiscalYearStart(to, fiscalYearStartMonth);
  return { from, to, profit: (await periodResult(db, workspaceId, { legalEntityId, from, to }, fiscalYearStartMonth)).totals.netProfit };
}

const CURRENT_ASSETS = ["bank", "cash", "receivable", "tax", "current_asset", "inventory"];
const CURRENT_LIABILITIES = ["payable", "tax", "current_liability"];

/**
 * The balance sheet at `to`: assets, liabilities and equity, with this financial year's earnings so far and the
 * earlier years' results (retained earnings) worked out from the journals.
 */
export async function readBalanceSheet(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery): Promise<BalanceSheetReport> {
  const yearStart = fiscalYearStart(scope.to, entity.fiscalYearStartMonth);
  // Balances at `to` with income and expenses from the year start: the openings at the year start carry the earlier years.
  const { rows } = await accountBalances(db, workspaceId, { legalEntityId: scope.legalEntityId, from: yearStart, to: scope.to }, entity.fiscalYearStartMonth);
  const debitSide = (row: AccountBalance) => row.closing;
  const creditSide = (row: AccountBalance) => neg(row.closing);
  const of = (type: AccountType, subtypes: string[] | null, exclude: string[] = []) =>
    rows.filter((row) => row.type === type && (subtypes ? subtypes.includes(row.subtype) : !exclude.includes(row.subtype)));
  const assets = section("assets", "Assets", [], [
    section("current_assets", "Current assets", linesOf(of("asset", CURRENT_ASSETS), debitSide)),
    section("non_current_assets", "Non-current assets", linesOf(of("asset", null, CURRENT_ASSETS), debitSide)),
  ]);
  const liabilities = section("liabilities", "Liabilities", [], [
    section("current_liabilities", "Current liabilities", linesOf(of("liability", CURRENT_LIABILITIES), creditSide)),
    section("non_current_liabilities", "Non-current liabilities", linesOf(of("liability", null, CURRENT_LIABILITIES), creditSide)),
  ]);
  const pnl = rows.filter((row) => isPnl(row.type));
  const currentYearEarnings = money(-pnl.reduce((sum, row) => sum + units(row.closing), 0n));
  // Earlier years' results sit in the retained-earnings opening (accountBalances); the account's own entries are on its line.
  const equityRows = of("equity", null);
  const retainedRow = equityRows.find((row) => row.roles.includes("retained_earnings")) ?? equityRows.find((row) => row.subtype === "retained_earnings");
  const equityLines = linesOf(equityRows, creditSide);
  const earnings: StatementLine[] = isZero(currentYearEarnings) ? [] : [{ accountId: null, code: null, name: "Current year earnings", amount: currentYearEarnings }];
  const equity = section("equity", "Equity", [...equityLines, ...earnings]);
  const liabilitiesAndEquity = add(liabilities.total, equity.total);
  return {
    report: "balance-sheet", scope, entity, generatedAt: new Date().toISOString(), sections: [assets, liabilities, equity],
    totals: { assets: assets.total, liabilities: liabilities.total, equity: equity.total, liabilitiesAndEquity },
    currentYearEarnings, retainedEarnings: retainedRow ? creditSide(retainedRow) : ZERO, fiscalYearStart: yearStart,
    balanced: assets.total === liabilitiesAndEquity,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// General ledger.

type LedgerLine = {
  lineId: string; journalId: string; journalNumber: string; journalDate: string; kind: string; description: string; journalDescription: string;
  sourceLabel: string; sourceHref: string; partyType: string | null; partyId: string | null; debit: string; credit: string;
};

/** One account's lines in the period with a running balance (debit positive), opening as the trial balance shows it. */
export async function readGeneralLedger(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery, accountId: string): Promise<GeneralLedgerReport> {
  const { rows } = await accountBalances(db, workspaceId, scope, entity.fiscalYearStartMonth);
  const account = rows.find((row) => row.accountId === accountId);
  if (!account) throw new NotFoundException("This account is not in the company's chart");
  const lines = (await db.query<LedgerLine>(
    `SELECT line.id AS "lineId", journal.id AS "journalId", journal.number AS "journalNumber", journal.journal_date::text AS "journalDate", journal.kind,
            line.description, journal.description AS "journalDescription", journal.source_label AS "sourceLabel", journal.source_href AS "sourceHref",
            line.party_type AS "partyType", line.party_id AS "partyId", line.debit::text AS debit, line.credit::text AS credit
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND line.account_id = $3
        AND journal.journal_date BETWEEN $4::date AND $5::date
      ORDER BY journal.journal_date, journal.number, line.position
      LIMIT 5001`, [workspaceId, scope.legalEntityId, accountId, scope.from, scope.to])).rows;
  const names = await partyNames(db, workspaceId, lines);
  let balance = units(account.opening);
  const out = lines.slice(0, 5000).map((line) => {
    balance += units(line.debit) - units(line.credit);
    return {
      lineId: line.lineId, journalId: line.journalId, journalNumber: line.journalNumber, journalDate: line.journalDate, kind: line.kind,
      description: line.description || line.journalDescription, sourceLabel: line.sourceLabel, sourceHref: line.sourceHref,
      partyName: line.partyType && line.partyId ? names.get(`${line.partyType}:${line.partyId}`) ?? null : null,
      debit: line.debit, credit: line.credit, balance: money(balance),
    };
  });
  return {
    report: "general-ledger", scope, entity, generatedAt: new Date().toISOString(),
    account: { id: account.accountId, code: account.code, name: account.name, type: account.type, subtype: account.subtype, isControl: account.isControl },
    opening: account.opening, debit: account.debit, credit: account.credit, closing: account.closing, rows: out,
  };
}
