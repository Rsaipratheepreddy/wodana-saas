import { toCsv } from "./report-math";
import { AGEING_BUCKETS, type AccountsList, type AgeingReport, type BalanceSheetReport, type GeneralLedgerReport, type JournalList, type ProfitAndLossReport,
  type StatementSection, type TrialBalanceReport, type VatReport } from "./report-types";

/** Every Ledger report as a CSV file: the same figures as the screen, exact decimals, one row per line. */

export type CsvReport = TrialBalanceReport | ProfitAndLossReport | BalanceSheetReport | VatReport | AgeingReport | GeneralLedgerReport;

function statementRows(sections: readonly StatementSection[], depth = 0): string[][] {
  return sections.flatMap((section) => [
    [`${"  ".repeat(depth)}${section.label}`, "", ""],
    ...section.lines.map((line) => [`${"  ".repeat(depth + 1)}${line.name}`, line.code ?? "", line.amount]),
    ...statementRows(section.sections, depth + 1),
    [`${"  ".repeat(depth)}Total ${section.label.toLocaleLowerCase()}`, "", section.total],
  ]);
}

export function reportCsv(report: CsvReport): string {
  const head = [[report.entity.name, report.entity.currency, report.scope.from, report.scope.to]];
  switch (report.report) {
    case "trial-balance":
      return toCsv([...head, ["Code", "Account", "Type", "Opening", "Debit", "Credit", "Closing"],
        ...report.rows.map((row) => [row.code, row.name, row.type, row.opening, row.debit, row.credit, row.closing]),
        ["", "Total", "", report.totals.opening, report.totals.debit, report.totals.credit, report.totals.closing]]);
    case "profit-and-loss":
      return toCsv([...head, ["Line", "Code", "Amount"], ...statementRows(report.sections), ["Net profit", "", report.totals.netProfit]]);
    case "balance-sheet":
      return toCsv([...head, ["Line", "Code", "Amount"], ...statementRows(report.sections), ["Liabilities and equity", "", report.totals.liabilitiesAndEquity]]);
    case "vat":
      return toCsv([...head, ["Box", "Description", "Amount", "VAT", "Adjustment"],
        ...report.boxes.map((box) => [box.box, box.label, box.amount ?? "", box.vat ?? "", box.adjustment ?? ""]),
        ...(report.review.length ? [[], ["Review", "Journal", "Date", "Code", "Amount", "Source"],
          ...report.review.map((item) => [item.reason, item.journalNumber, item.journalDate, item.taxCode ?? "", item.amount, item.sourceLabel])] : [])]);
    case "ar-ageing":
    case "ap-ageing":
      return toCsv([...head, ["Party", "Current", "1-30", "31-60", "61-90", "Over 90", "Total"],
        ...report.rows.map((row) => [row.partyName, ...AGEING_BUCKETS.map((bucket) => row.buckets[bucket]), row.total]),
        ["Total", ...AGEING_BUCKETS.map((bucket) => report.totals[bucket]), report.totals.total],
        ["Not linked to a party", "", "", "", "", "", report.unlinked],
        [report.control ? `${report.control.code} ${report.control.name}` : "", "", "", "", "", "", report.control?.balance ?? ""]]);
    case "general-ledger":
      return toCsv([...head, [report.account.code, report.account.name], ["Date", "Journal", "Description", "Source", "Party", "Debit", "Credit", "Balance"],
        ["", "", "Opening balance", "", "", "", "", report.opening],
        ...report.rows.map((row) => [row.journalDate, row.journalNumber, row.description, row.sourceLabel, row.partyName ?? "", row.debit, row.credit, row.balance]),
        ["", "", "Closing balance", "", "", report.debit, report.credit, report.closing]]);
  }
}

export function accountsCsv(list: AccountsList) {
  return toCsv([[list.entity.name, list.entity.currency, list.scope.from, list.scope.to], ["Code", "Account", "Type", "Opening", "Debit", "Credit", "Closing"],
    ...list.accounts.map((row) => [row.code, row.name, row.type, row.opening, row.debit, row.credit, row.closing])]);
}

export function journalsCsv(list: JournalList) {
  return toCsv([[list.entity.name, list.entity.currency, list.scope.from, list.scope.to], ["Date", "Journal", "Kind", "Source", "Description", "Total"],
    ...list.journals.map((row) => [row.journalDate, row.number, row.kind, row.sourceLabel, row.description, row.total])]);
}

export function csvFileName(name: string, scope: { from: string; to: string }) {
  return `${name}-${scope.from}-${scope.to}.csv`.replace(/[^A-Za-z0-9._-]/g, "-");
}
