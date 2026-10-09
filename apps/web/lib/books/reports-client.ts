import type {
  AccountType, AgeingBucket, AgeingRow, BooksPartyType, IsoDay, Money, StatementSection, TrialBalanceRow, VatBox,
} from "@wodana/contracts";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * The Ledger area (users see "Ledger"; the engine is `books`): what business-core returns for the overview, the
 * company reports, accounts and journals (services/business-core/src/books/reports/report-types.ts), and how the
 * web asks for it through /api/books/reports. Figures are worked out server-side in exact decimals; the web only
 * lays them out. Row DTOs are the shared contracts' (packages/contracts/src/books.ts).
 */

export type { AgeingBucket, AgeingRow, Money, StatementSection, TrialBalanceRow, VatBox };

export type LedgerReportCode = "trial-balance" | "profit-and-loss" | "balance-sheet" | "vat" | "ar-ageing" | "ap-ageing" | "general-ledger" | "project-profit";
/** The reports offered in the picker, in reading order (the general ledger opens from an account). */
export const LEDGER_REPORTS: readonly LedgerReportCode[] = ["trial-balance", "profit-and-loss", "balance-sheet", "vat", "ar-ageing", "ap-ageing", "project-profit"];
export const LEDGER_REPORT_LABELS: Record<LedgerReportCode, MessageKey> = {
  "trial-balance": tKey("Trial balance"), "profit-and-loss": tKey("Profit and loss"), "balance-sheet": tKey("Balance sheet"), vat: tKey("VAT return"),
  "ar-ageing": tKey("Receivables ageing"), "ap-ageing": tKey("Payables ageing"), "general-ledger": tKey("General ledger"), "project-profit": tKey("Projects profit"),
};

/** Statement lines the server names itself (no account behind them), translated where they render. */
export const LEDGER_SERVER_LABELS: readonly MessageKey[] = [tKey("Current year earnings"), tKey("Retained earnings")];

/** The ageing columns, oldest last. */
export const AGEING_LABELS: ReadonlyArray<readonly [AgeingBucket, MessageKey]> = [
  ["current", tKey("Not due")], ["1_30", tKey("1–30 days")], ["31_60", tKey("31–60 days")], ["61_90", tKey("61–90 days")], ["over_90", tKey("Over 90 days")],
];

export const LEDGER_SECTIONS = ["overview", "reports", "journals", "accounts", "attention"] as const;
export type LedgerSection = (typeof LEDGER_SECTIONS)[number];

export type ReportEntity = {
  id: string; code: string; name: string; currency: string; locale: string; countryCode: string; timeZone: string; enabled: boolean;
  fiscalYearStartMonth: number; startDate: IsoDay; lockDate: IsoDay | null; templateCode: string | null; templateVersion: number | null; today: IsoDay;
};
export type ReportScope = { legalEntityId: string; from: IsoDay; to: IsoDay };
type Base<C extends LedgerReportCode> = { report: C; scope: ReportScope; entity: ReportEntity; generatedAt: string };

export type TrialBalanceReport = Base<"trial-balance"> & {
  rows: TrialBalanceRow[]; totals: { opening: Money; debit: Money; credit: Money; closing: Money }; balanced: boolean; fiscalYearStart: IsoDay;
};
export type ProfitAndLossReport = Base<"profit-and-loss"> & {
  sections: StatementSection[];
  totals: { revenue: Money; costOfSales: Money; grossProfit: Money; operatingExpenses: Money; operatingProfit: Money; otherIncome: Money; otherExpenses: Money; netProfit: Money };
};
export type BalanceSheetReport = Base<"balance-sheet"> & {
  sections: StatementSection[]; totals: { assets: Money; liabilities: Money; equity: Money; liabilitiesAndEquity: Money };
  currentYearEarnings: Money; retainedEarnings: Money; fiscalYearStart: IsoDay; balanced: boolean;
};
export type VatReviewReason = "zero_rate" | "advance_split" | "foreign_supplier_without_reverse_charge" | "missing_region";
export type VatReviewItem = {
  reason: VatReviewReason; journalId: string; journalNumber: string; journalDate: IsoDay; accountCode: string | null; accountName: string | null;
  taxCode: string | null; partyName: string | null; amount: Money; sourceLabel: string; sourceHref: string;
};
export type VatBoxLine = {
  box: string; lineId: string; journalId: string; journalNumber: string; journalDate: IsoDay; accountId: string; accountCode: string; accountName: string;
  taxCode: string; region: string | null; amount: Money; vat: Money; sourceLabel: string; sourceHref: string;
};
export type VatReport = Base<"vat"> & {
  layout: { code: string; name: string; regionLabel: string | null } | null; boxes: VatBox[]; review: VatReviewItem[]; lines: VatBoxLine[] | null;
};
export type AgeingReport = Base<"ar-ageing" | "ap-ageing"> & {
  side: "receivable" | "payable"; rows: AgeingRow[]; totals: Record<AgeingBucket, Money> & { total: Money };
  control: { accountId: string; code: string; name: string; balance: Money } | null; unlinked: Money; reconciled: boolean;
};
export type GeneralLedgerRow = {
  lineId: string; journalId: string; journalNumber: string; journalDate: IsoDay; kind: string; description: string; sourceLabel: string; sourceHref: string;
  partyName: string | null; debit: Money; credit: Money; balance: Money;
};
export type GeneralLedgerReport = Base<"general-ledger"> & {
  account: { id: string; code: string; name: string; type: AccountType; subtype: string; isControl: boolean };
  opening: Money; debit: Money; credit: Money; closing: Money; rows: GeneralLedgerRow[];
};
export type CompanyReport = TrialBalanceReport | ProfitAndLossReport | BalanceSheetReport | VatReport | AgeingReport | GeneralLedgerReport;

export type AccountBalance = TrialBalanceRow & { isControl: boolean; archived: boolean; parentId: string | null; roles: string[] };
export type AccountsList = { scope: ReportScope; entity: ReportEntity; accounts: AccountBalance[] };
export type JournalSummary = {
  id: string; number: string; journalDate: IsoDay; eventDate: IsoDay; late: boolean; kind: "auto" | "manual" | "opening" | "reversal";
  sourceType: string; sourceEvent: string; sourceLabel: string; sourceHref: string; description: string; currency: string; total: Money;
};
export type JournalList = { scope: ReportScope; entity: ReportEntity; project: string | null; journals: JournalSummary[]; total: number; limit: number; offset: number };
export type JournalLine = {
  id: string; position: number; accountId: string; accountCode: string; accountName: string; debit: Money; credit: Money; docAmount: Money | null;
  description: string; projectId: string | null; projectName: string | null; partyType: BooksPartyType | null; partyId: string | null; partyName: string | null;
  taxCode: string | null; taxBase: Money | null; taxRegion: string | null;
};
export type JournalDetail = {
  entity: ReportEntity;
  journal: JournalSummary & { functionalCurrency: string; rate: string; reversesJournalId: string | null; reversedByJournalId: string | null; postedByName: string | null; postedAt: string };
  lines: JournalLine[];
};
export type LedgerOverview = {
  entities: ReportEntity[]; entity: ReportEntity | null; canManage: boolean; canPost: boolean;
  balances: { cash: Money; receivables: Money; payables: Money; vatDue: Money | null; profitThisYear: Money } | null;
  vatPeriod: { from: IsoDay; to: IsoDay } | null; fiscalYear: { from: IsoDay; to: IsoDay } | null; openIssues: number;
  /** Tax lines this quarter in no regional box for want of a region (the VAT due leaves them out). */
  vatMissingRegion?: { lines: number; label: string | null } | null;
};

/** What a report reads: the company and the period, kept in the address. Empty means the server's default. */
export type LedgerScope = { entity: string; from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scopeFrom(params: URLSearchParams): LedgerScope {
  const day = (key: string) => (DAY.test(params.get(key) ?? "") ? params.get(key)! : "");
  return { entity: UUID.test(params.get("entity") ?? "") ? params.get("entity")! : "", from: day("from"), to: day("to") };
}

export function scopeQuery(scope: Partial<LedgerScope>, extra: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...scope, ...extra })) if (value) query.set(key, value);
  return query;
}

/** The Ledger's addresses (the same routes as `ledgerHref` in the shared contracts): report → account → journal → source. */
export const LEDGER_ROUTE = "/workspace/ledger";
const withQuery = (path: string, query: URLSearchParams) => (query.size ? `${path}?${query}` : path);
export const ledgerPaths = {
  overview: (scope: Partial<LedgerScope> = {}) => withQuery(LEDGER_ROUTE, scopeQuery({ entity: scope.entity })),
  reports: (scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/reports`, scopeQuery(scope)),
  report: (report: LedgerReportCode, scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/reports/${report}`, scopeQuery(scope)),
  account: (accountId: string, scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/accounts/${encodeURIComponent(accountId)}`, scopeQuery(scope)),
  accounts: (scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/accounts`, scopeQuery(scope)),
  journal: (journalId: string, scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/journals/${encodeURIComponent(journalId)}`, scopeQuery(scope)),
  journals: (scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/journals`, scopeQuery(scope)),
  attention: (scope: Partial<LedgerScope> = {}) => withQuery(`${LEDGER_ROUTE}/attention`, scopeQuery({ entity: scope.entity })),
  settings: () => "/workspace/settings/ledger",
};

export class LedgerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(workspaceId: string, path: string, query: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const search = new URLSearchParams(query);
  search.set("workspaceId", workspaceId);
  const response = await fetch(`/api/books/reports/${path}?${search}`, { cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LedgerRequestError(typeof data?.message === "string" ? data.message : tKey("The Ledger didn't load."), response.status);
  return data as T;
}

/** The Ledger's reads for one workspace. */
export function ledgerApi(workspaceId: string) {
  return {
    overview: (entity: string, signal?: AbortSignal) => request<LedgerOverview>(workspaceId, "overview", scopeQuery({ entity }), signal),
    report: <T extends CompanyReport>(report: Exclude<LedgerReportCode, "project-profit">, scope: LedgerScope, extra: Record<string, string | undefined> = {}, signal?: AbortSignal) =>
      request<T>(workspaceId, report, scopeQuery(scope, extra), signal),
    accounts: (scope: LedgerScope, signal?: AbortSignal) => request<AccountsList>(workspaceId, "accounts", scopeQuery(scope), signal),
    account: (accountId: string, scope: LedgerScope, signal?: AbortSignal) => request<GeneralLedgerReport>(workspaceId, `accounts/${encodeURIComponent(accountId)}`, scopeQuery(scope), signal),
    journals: (scope: LedgerScope, search: string, project: string, signal?: AbortSignal) =>
      request<JournalList>(workspaceId, "journals", scopeQuery(scope, { search, project }), signal),
    journal: (journalId: string, signal?: AbortSignal) => request<JournalDetail>(workspaceId, `journals/${encodeURIComponent(journalId)}`, new URLSearchParams(), signal),
  };
}
export type LedgerApi = ReturnType<typeof ledgerApi>;

/** The period presets of the report picker; "Custom dates" opens a date range. */
export const PERIOD_PRESETS = ["month", "last-month", "quarter", "last-quarter", "year", "last-year", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABELS: Record<PeriodPreset, MessageKey> = {
  month: tKey("Month to date"), "last-month": tKey("Last month"), quarter: tKey("Quarter to date"), "last-quarter": tKey("Last quarter"),
  year: tKey("Year to date"), "last-year": tKey("Last financial year"), custom: tKey("Custom dates"),
};

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/**
 * The period a preset means for a company, from its today and the month its financial year starts. The current
 * month, quarter and financial year run to today (the server's default is the year to date).
 */
export function presetPeriod(preset: Exclude<PeriodPreset, "custom">, today: string, fiscalYearStartMonth = 1): { from: string; to: string } {
  const [year, month] = today.split("-").map(Number);
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  const fyYear = month >= fiscalYearStartMonth ? year : year - 1;
  switch (preset) {
    case "month": return { from: iso(year, month, 1), to: today };
    case "last-month": return { from: iso(year, month - 1, 1), to: iso(year, month, 0) };
    case "quarter": return { from: iso(year, quarterStart, 1), to: today };
    case "last-quarter": return { from: iso(year, quarterStart - 3, 1), to: iso(year, quarterStart, 0) };
    case "year": return { from: iso(fyYear, fiscalYearStartMonth, 1), to: today };
    case "last-year": return { from: iso(fyYear - 1, fiscalYearStartMonth, 1), to: iso(fyYear, fiscalYearStartMonth, 0) };
  }
}

/** Which preset a period is, or "custom". */
export function presetOf(from: string, to: string, today: string, fiscalYearStartMonth = 1): PeriodPreset {
  for (const preset of PERIOD_PRESETS) {
    if (preset === "custom") continue;
    const period = presetPeriod(preset, today, fiscalYearStartMonth);
    if (period.from === from && period.to === to) return preset;
  }
  return "custom";
}
