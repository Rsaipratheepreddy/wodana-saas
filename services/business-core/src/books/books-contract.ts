// Structural copy of the Ledger contract in packages/contracts/src/books.ts (business-core does not depend on
// contracts). books-contract.spec.ts keeps both in step.

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

export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];
export const PAYMENT_METHODS = ["bank", "cheque", "cash", "card", "other", "provider"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const JOURNAL_KINDS = ["auto", "manual", "opening", "reversal"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const PARTY_TYPES = ["client", "vendor", "employee", "team"] as const;
export type BooksPartyType = (typeof PARTY_TYPES)[number];

export const BOOKS_SOURCE_EVENTS = {
  client_invoice: ["issued"],
  client_credit_note: ["issued"],
  receipt: ["verified", "reversed"],
  supplier_bill: ["approved", "cancelled"],
  supplier_payment: ["paid", "reversed"],
  goods_receipt: ["received", "reversed"],
  stock_batch: ["moved"],
  petty_cash: ["approved", "reimbursed"],
  labour: ["costed", "recosted"],
  manual_journal: ["approved"],
} as const;
export type BooksSourceType = keyof typeof BOOKS_SOURCE_EVENTS;
export type BooksSourceEvent<T extends BooksSourceType = BooksSourceType> = (typeof BOOKS_SOURCE_EVENTS)[T][number];

export const POSTING_ISSUE_CODES = [
  "missing_rate", "missing_account", "unknown_tax", "no_cost", "no_entity", "currency_mismatch", "external_invoice", "entity_not_enabled",
] as const;
export type PostingIssueCode = (typeof POSTING_ISSUE_CODES)[number];

export const BOOKS_PERMISSIONS = { view: "books.view", post: "books.post", approve: "books.approve", manage: "books.manage" } as const;
