// What the Ledger reports return (plan §6.21b). The row DTOs follow packages/contracts/src/books.ts (TrialBalanceRow,
// StatementSection, VatBox, AgeingRow); the envelopes around them are this module's and are mirrored by the web in
// apps/web/lib/books/reports-client.ts. Money is decimal text with 4 places, in the company's functional currency.

import type { AccountType, BooksPartyType } from "../books-contract";

export type Money = string;
export type IsoDay = string;

export type BooksReportCode = "trial-balance" | "profit-and-loss" | "balance-sheet" | "vat" | "ar-ageing" | "ap-ageing" | "general-ledger";
export const COMPANY_REPORTS: readonly BooksReportCode[] = ["trial-balance", "profit-and-loss", "balance-sheet", "vat", "ar-ageing", "ap-ageing", "general-ledger"];

export type BooksReportQuery = { legalEntityId: string; from: IsoDay; to: IsoDay };

/** A company the Ledger keeps books for, with what its reports are formatted by. */
export type ReportEntity = {
  id: string;
  code: string;
  name: string;
  currency: string;
  locale: string;
  countryCode: string;
  timeZone: string;
  enabled: boolean;
  fiscalYearStartMonth: number;
  startDate: IsoDay;
  lockDate: IsoDay | null;
  templateCode: string | null;
  templateVersion: number | null;
  /** Today in the company's time zone. */
  today: IsoDay;
};

export type ReportBase<C extends BooksReportCode = BooksReportCode> = { report: C; scope: BooksReportQuery; entity: ReportEntity; generatedAt: string };

export type TrialBalanceRow = {
  accountId: string; code: string; name: string; type: AccountType; subtype: string;
  opening: Money; debit: Money; credit: Money; closing: Money;
};
export type TrialBalanceReport = ReportBase<"trial-balance"> & {
  rows: TrialBalanceRow[];
  totals: { opening: Money; debit: Money; credit: Money; closing: Money };
  /** Σ debits = Σ credits in the period and the closing balances net to zero. */
  balanced: boolean;
  /** The first day of the financial year the period starts in: income and expenses count from it. */
  fiscalYearStart: IsoDay;
};

export type StatementLine = { accountId: string | null; code: string | null; name: string; amount: Money };
export type StatementSection = { key: string; label: string; lines: StatementLine[]; sections: StatementSection[]; total: Money };

export type ProfitAndLossReport = ReportBase<"profit-and-loss"> & {
  sections: StatementSection[];
  totals: { revenue: Money; costOfSales: Money; grossProfit: Money; operatingExpenses: Money; operatingProfit: Money; otherIncome: Money; otherExpenses: Money; netProfit: Money };
};

export type BalanceSheetReport = ReportBase<"balance-sheet"> & {
  sections: StatementSection[];
  totals: { assets: Money; liabilities: Money; equity: Money; liabilitiesAndEquity: Money };
  currentYearEarnings: Money;
  retainedEarnings: Money;
  fiscalYearStart: IsoDay;
  balanced: boolean;
};

export type VatBoxColumn = "amount" | "vat" | "adjustment";
export type VatBox = {
  box: string; label: string; section: "sales" | "purchases" | "net";
  amount: Money | null; vat: Money | null; adjustment: Money | null;
  computed: boolean;
};
export type VatReviewReason = "zero_rate" | "advance_split" | "foreign_supplier_without_reverse_charge" | "missing_region";
export type VatReviewItem = {
  reason: VatReviewReason;
  journalId: string; journalNumber: string; journalDate: IsoDay;
  accountCode: string | null; accountName: string | null;
  taxCode: string | null; partyName: string | null;
  amount: Money; sourceLabel: string; sourceHref: string;
};
/** One journal line behind a box (drill-down). */
export type VatBoxLine = {
  box: string; lineId: string; journalId: string; journalNumber: string; journalDate: IsoDay;
  accountId: string; accountCode: string; accountName: string; taxCode: string; region: string | null;
  amount: Money; vat: Money; sourceLabel: string; sourceHref: string;
};
export type VatReport = ReportBase<"vat"> & {
  layout: { code: string; name: string; regionLabel: string | null } | null;
  boxes: VatBox[];
  review: VatReviewItem[];
  /** The lines behind one box, when the query names it (`box=`). */
  lines: VatBoxLine[] | null;
};

export const AGEING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export type AgeingRow = { partyType: BooksPartyType; partyId: string; partyName: string; buckets: Record<AgeingBucket, Money>; total: Money };
export type AgeingReport = ReportBase<"ar-ageing" | "ap-ageing"> & {
  side: "receivable" | "payable";
  rows: AgeingRow[];
  totals: Record<AgeingBucket, Money> & { total: Money };
  control: { accountId: string; code: string; name: string; balance: Money } | null;
  /** Control-account entries without a party (opening balances, manual journals): the line that reconciles the parties to the account. */
  unlinked: Money;
  reconciled: boolean;
};

export type GeneralLedgerRow = {
  lineId: string; journalId: string; journalNumber: string; journalDate: IsoDay; kind: string;
  description: string; sourceLabel: string; sourceHref: string; partyName: string | null;
  debit: Money; credit: Money; balance: Money;
};
export type GeneralLedgerReport = ReportBase<"general-ledger"> & {
  account: { id: string; code: string; name: string; type: AccountType; subtype: string; isControl: boolean };
  opening: Money; debit: Money; credit: Money; closing: Money;
  rows: GeneralLedgerRow[];
};

export type AccountBalance = TrialBalanceRow & { isControl: boolean; archived: boolean; parentId: string | null; roles: string[] };
export type AccountsList = { scope: BooksReportQuery; entity: ReportEntity; accounts: AccountBalance[] };

export type JournalSummary = {
  id: string; number: string; journalDate: IsoDay; eventDate: IsoDay; late: boolean; kind: string;
  sourceType: string; sourceEvent: string; sourceLabel: string; sourceHref: string; description: string;
  currency: string; total: Money;
  /** Whom it is about: the first client, supplier, employee or team on its lines ("Invoice issued: Omar and Layla Haddad"). */
  partyName?: string | null;
};
export type JournalList = { scope: BooksReportQuery; entity: ReportEntity; project: string | null; journals: JournalSummary[]; total: number; limit: number; offset: number };
export type JournalLineDetail = {
  id: string; position: number; accountId: string; accountCode: string; accountName: string;
  debit: Money; credit: Money; docAmount: Money | null; description: string;
  projectId: string | null; projectName: string | null; partyType: BooksPartyType | null; partyId: string | null; partyName: string | null;
  taxCode: string | null; taxBase: Money | null; taxRegion: string | null;
};
export type JournalDetail = {
  entity: ReportEntity;
  journal: JournalSummary & {
    functionalCurrency: string; rate: string; reversesJournalId: string | null; reversedByJournalId: string | null;
    postedByName: string | null; postedAt: string;
  };
  lines: JournalLineDetail[];
};

export type LedgerOverview = {
  entities: ReportEntity[];
  entity: ReportEntity | null;
  canManage: boolean;
  /** Prepares manual journals and imports opening balances (books.post). */
  canPost: boolean;
  balances: { cash: Money; receivables: Money; payables: Money; vatDue: Money | null; profitThisYear: Money } | null;
  vatPeriod: { from: IsoDay; to: IsoDay } | null;
  /** Tax lines this quarter in no regional box because neither the line nor the company has a region (the VAT due leaves them out). */
  vatMissingRegion?: { lines: number; label: string | null } | null;
  fiscalYear: { from: IsoDay; to: IsoDay } | null;
  openIssues: number;
  /** Balances at the last six month ends (the last at today), for the home's sparklines. */
  trend?: { days: IsoDay[]; cash: Money[]; receivables: Money[]; payables: Money[]; vat: Money[] };
  /** What needs someone: overdue money both ways, manual journals waiting for approval, a trial balance that doesn't balance. */
  attention?: { overdueReceivables: Money; overduePayables: Money; manualWaiting: number; unbalanced: boolean };
  /** The latest journals. */
  recent?: JournalSummary[];
};
