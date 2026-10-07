/**
 * Wodana Ledger (engine E7, code name `books`): the shared contract every Ledger slice builds on (plan §6.21b).
 * Users see "Ledger"; tables, permissions and code keep `books`. Money is decimal text (never a float), in the
 * company's functional currency unless a field says otherwise.
 */

/** The posting roles: what each posting rule debits or credits. Each company maps every role to one account. */
export const ACCOUNT_ROLES = [
  "ar_control", "ap_control", "client_advances", "vat_output", "vat_input", "vat_advance_contra", "grni", "inventory",
  "stock_in_transit", "stock_adjustments", "employee_claims_payable", "revenue_project", "revenue_other", "cost_materials",
  "cost_subcontract", "cost_labour", "cost_site_expenses", "cost_price_variance", "cost_other", "cogs_goods", "general_expense",
  "labour_absorbed", "fx_gain_loss", "rounding", "retained_earnings", "opening_balance_equity",
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TAX_TREATMENTS = ["standard", "zero", "exempt", "out_of_scope", "reverse_charge", "import_reverse_charge"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const TAX_DIRECTIONS = ["sales", "purchases"] as const;
export type TaxDirection = (typeof TAX_DIRECTIONS)[number];

/** Where money comes in and goes out (books_payment_accounts). */
export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];
export const PAYMENT_METHODS = ["bank", "cheque", "cash", "card", "other", "provider"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const JOURNAL_KINDS = ["auto", "manual", "opening", "reversal"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const MANUAL_JOURNAL_STATUSES = ["draft", "submitted", "returned", "approved", "cancelled"] as const;
export type ManualJournalStatus = (typeof MANUAL_JOURNAL_STATUSES)[number];

export const BILL_CAPTURE_STATUSES = ["reading", "read", "failed", "drafted", "discarded"] as const;
export type BillCaptureStatus = (typeof BILL_CAPTURE_STATUSES)[number];

export const PARTY_TYPES = ["client", "vendor", "employee", "team"] as const;
export type BooksPartyType = (typeof PARTY_TYPES)[number];

/**
 * Source types and their events. A journal is unique per (source type, source id, source event), which is what
 * makes every sweep idempotent. Events are the past-tense facts the rules P1 to P15 post.
 */
export const BOOKS_SOURCE_EVENTS = {
  /** P1 client invoice issued. */
  client_invoice: ["issued"],
  /** P2 credit note issued. */
  client_credit_note: ["issued"],
  /** P3 receipt finance-verified (dated verifiedAt); P4 receipt reversed. */
  receipt: ["verified", "reversed"],
  /** P5 supplier bill approved (invoice date); P6 bill cancelled. */
  supplier_bill: ["approved", "cancelled"],
  /** P7 supplier payment, payment runs included; P8 payment reversed. */
  supplier_payment: ["paid", "reversed"],
  /** P9 services or outside work received; P10 goods receipt reversed. */
  goods_receipt: ["received", "reversed"],
  /** P11 stock movements, one journal per batch (source id = batch id). */
  stock_batch: ["moved"],
  /** P12 petty cash approved; P13 petty cash reimbursed. */
  petty_cash: ["approved", "reimbursed"],
  /** P14 labour costed; a rate change posts only the delta as `recosted` (source id = entry id + ":" + revision). */
  labour: ["costed", "recosted"],
  /** P15 manual or opening journal approved (E3). */
  manual_journal: ["approved"],
} as const;
export type BooksSourceType = keyof typeof BOOKS_SOURCE_EVENTS;
export type BooksSourceEvent<T extends BooksSourceType = BooksSourceType> = (typeof BOOKS_SOURCE_EVENTS)[T][number];
export const BOOKS_SOURCE_TYPES = Object.keys(BOOKS_SOURCE_EVENTS) as BooksSourceType[];

/** The posting rules by number (plan §6.21b): the source and event each one posts. */
export const POSTING_RULES = {
  P1: { sourceType: "client_invoice", event: "issued" },
  P2: { sourceType: "client_credit_note", event: "issued" },
  P3: { sourceType: "receipt", event: "verified" },
  P4: { sourceType: "receipt", event: "reversed" },
  P5: { sourceType: "supplier_bill", event: "approved" },
  P6: { sourceType: "supplier_bill", event: "cancelled" },
  P7: { sourceType: "supplier_payment", event: "paid" },
  P8: { sourceType: "supplier_payment", event: "reversed" },
  P9: { sourceType: "goods_receipt", event: "received" },
  P10: { sourceType: "goods_receipt", event: "reversed" },
  P11: { sourceType: "stock_batch", event: "moved" },
  P12: { sourceType: "petty_cash", event: "approved" },
  P13: { sourceType: "petty_cash", event: "reimbursed" },
  P14: { sourceType: "labour", event: "costed" },
  P15: { sourceType: "manual_journal", event: "approved" },
} as const satisfies Record<string, { sourceType: BooksSourceType; event: string }>;
export type PostingRule = keyof typeof POSTING_RULES;

/** Why a source event could not post yet (books_posting_issues.code). */
export const POSTING_ISSUE_CODES = [
  "missing_rate", "missing_account", "unknown_tax", "no_cost", "no_entity", "currency_mismatch", "external_invoice", "entity_not_enabled",
] as const;
export type PostingIssueCode = (typeof POSTING_ISSUE_CODES)[number];

/** Permission codes. */
export const BOOKS_PERMISSIONS = { view: "books.view", post: "books.post", approve: "books.approve", manage: "books.manage" } as const;
export type BooksPermission = (typeof BOOKS_PERMISSIONS)[keyof typeof BOOKS_PERMISSIONS];

/** Decimal text, e.g. "105000.0000". */
export type Money = string;
/** A calendar day, YYYY-MM-DD. */
export type IsoDay = string;

/** A report's scope: one company and a period (inclusive). Balance-sheet style reports read `to` only. */
export type BooksReportQuery = { legalEntityId: string; from: IsoDay; to: IsoDay };

export type BooksReportCode =
  | "trial-balance" | "profit-and-loss" | "balance-sheet" | "vat" | "ar-ageing" | "ap-ageing" | "general-ledger" | "project-profit";
export const BOOKS_REPORT_CODES: readonly BooksReportCode[] = [
  "trial-balance", "profit-and-loss", "balance-sheet", "vat", "ar-ageing", "ap-ageing", "general-ledger", "project-profit",
];

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  /** Balance before the period (debit positive). */
  opening: Money;
  debit: Money;
  credit: Money;
  /** opening + debit - credit (debit positive). */
  closing: Money;
};

export type StatementLine = { accountId: string | null; code: string | null; name: string; amount: Money };
/** A section of the P&L or balance sheet (revenue, cost of sales, current assets...), possibly nested. */
export type StatementSection = { key: string; label: string; lines: StatementLine[]; sections: StatementSection[]; total: Money };

export type VatBoxColumn = "amount" | "vat" | "adjustment";
/** One box of a tax return laid out by the template's taxReport (AE: VAT 201 boxes 1a to 14). */
export type VatBox = {
  box: string;
  label: string;
  section: "sales" | "purchases" | "net";
  amount: Money | null;
  vat: Money | null;
  adjustment: Money | null;
  /** Worked out from other boxes (8, 11, 12, 13, 14), not drilled into. */
  computed: boolean;
};

export const AGEING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export type AgeingRow = {
  partyType: BooksPartyType;
  partyId: string;
  partyName: string;
  buckets: Record<AgeingBucket, Money>;
  total: Money;
};

export type ProjectPnlCosts = { materials: Money; subcontract: Money; labour: Money; siteExpenses: Money; priceVariance: Money; other: Money };
export type ProjectPnl = {
  projectId: string;
  reference: string;
  name: string;
  currency: string;
  /** Invoiced revenue net of credit notes and tax. */
  revenue: Money;
  costs: ProjectPnlCosts;
  totalCost: Money;
  profit: Money;
  /** profit / revenue × 100, null without revenue. */
  marginPercent: string | null;
  /** The accepted quote's value and planned margin, when known. */
  quotedValue: Money | null;
  quotedMarginPercent: string | null;
};

/** Drill-down routes: report → account → journal → source (the source keeps its own `source_href`). */
export const LEDGER_ROUTE = "/workspace/ledger";
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const ledgerHref = {
  overview: () => LEDGER_ROUTE,
  report: (report: BooksReportCode, scope?: Partial<BooksReportQuery>) =>
    `${LEDGER_ROUTE}/reports/${report}${query({ entity: scope?.legalEntityId, from: scope?.from, to: scope?.to })}`,
  account: (accountId: string, scope?: Partial<BooksReportQuery>) =>
    `${LEDGER_ROUTE}/accounts/${encodeURIComponent(accountId)}${query({ entity: scope?.legalEntityId, from: scope?.from, to: scope?.to })}`,
  journal: (journalId: string) => `${LEDGER_ROUTE}/journals/${encodeURIComponent(journalId)}`,
  journals: () => `${LEDGER_ROUTE}/journals`,
  accounts: () => `${LEDGER_ROUTE}/accounts`,
  attention: () => `${LEDGER_ROUTE}/attention`,
  settings: () => "/workspace/settings/ledger",
};

/**
 * The fixed account codes of the AE template (0283). Template data identifiers only: posting logic resolves
 * accounts by role, never by code.
 */
export const AE_ACCOUNT_CODES = {
  bank: "1100",
  pettyCash: "1150",
  tradeReceivables: "1200",
  vatRecoverable: "1210",
  inventory: "1300",
  stockInTransit: "1310",
  tradePayables: "2100",
  grni: "2110",
  employeeClaims: "2120",
  vatOutput: "2200",
  vatOnAdvances: "2210",
  clientAdvances: "2300",
  retainedEarnings: "3100",
  openingBalanceEquity: "3900",
  projectRevenue: "4100",
  otherIncome: "4900",
  projectMaterials: "5100",
  subcontract: "5200",
  labour: "5300",
  siteExpenses: "5400",
  priceVariance: "5500",
  otherProjectCosts: "5600",
  cogs: "5700",
  generalExpenses: "6100",
  stockAdjustments: "6200",
  labourAbsorbed: "6300",
  fxGainLoss: "6900",
  rounding: "6990",
} as const;

/** Chart templates shipped so far as setup profiles of kind 'books' (more are data rows, not code). */
export const BOOKS_TEMPLATE_CODES: readonly string[] = ["AE", "IFRS"];
