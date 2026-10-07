import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** The Ledger's labels kept in constants (translated where they render: `t(ROLE_LABELS[role])`). */

export const ROLE_LABELS: Record<string, MessageKey> = {
  ar_control: tKey("Trade receivables"),
  ap_control: tKey("Trade payables"),
  client_advances: tKey("Client advances"),
  vat_output: tKey("Tax on sales"),
  vat_input: tKey("Tax on purchases"),
  vat_advance_contra: tKey("Tax on advances"),
  grni: tKey("Goods received not invoiced"),
  inventory: tKey("Inventory"),
  stock_in_transit: tKey("Stock in transit"),
  stock_adjustments: tKey("Stock adjustments"),
  employee_claims_payable: tKey("Employee claims"),
  revenue_project: tKey("Project revenue"),
  revenue_other: tKey("Other income"),
  cost_materials: tKey("Project materials"),
  cost_subcontract: tKey("Subcontract"),
  cost_labour: tKey("Labour"),
  cost_site_expenses: tKey("Site expenses"),
  cost_price_variance: tKey("Price variance"),
  cost_other: tKey("Other project costs"),
  cogs_goods: tKey("Cost of goods sold"),
  general_expense: tKey("General expenses"),
  labour_absorbed: tKey("Labour absorbed"),
  fx_gain_loss: tKey("Exchange gain or loss"),
  rounding: tKey("Rounding"),
  retained_earnings: tKey("Retained earnings"),
  opening_balance_equity: tKey("Opening balance equity"),
};

export const ACCOUNT_TYPE_LABELS: Record<string, MessageKey> = {
  asset: tKey("Asset"), liability: tKey("Liability"), equity: tKey("Equity"), income: tKey("Income"), expense: tKey("Expense"),
};

export const METHOD_LABELS: Record<string, MessageKey> = {
  bank: tKey("Bank transfer"), cheque: tKey("Cheque"), cash: tKey("Cash"), card: tKey("Card"), provider: tKey("Payment provider"), other: tKey("Other"),
};

export const TREATMENT_LABELS: Record<string, MessageKey> = {
  standard: tKey("Standard rated"), zero: tKey("Zero rated"), exempt: tKey("Exempt"), out_of_scope: tKey("Out of scope"),
  reverse_charge: tKey("Reverse charge"), import_reverse_charge: tKey("Imported goods"),
};

export const DIRECTION_LABELS: Record<string, MessageKey> = { sales: tKey("Sales"), purchases: tKey("Purchases") };

export const JOURNAL_STATUS_LABELS: Record<string, MessageKey> = {
  draft: tKey("Draft"), submitted: tKey("Waiting for approval"), returned: tKey("Returned"), approved: tKey("Posted"), cancelled: tKey("Cancelled"),
};

export const PARTY_LABELS: Record<string, MessageKey> = { client: tKey("Client"), vendor: tKey("Supplier"), employee: tKey("Employee"), team: tKey("Crew") };

/** The settings and journal screens' own labels. */
export const L = {
  ledger: tKey("Ledger"),
  general: tKey("General"),
  accounts: tKey("Accounts"),
  taxCodes: tKey("Tax codes"),
  paymentAccounts: tKey("Payment accounts"),
  company: tKey("Company"),
  turnOn: tKey("Turn on Ledger"),
  chartTemplate: tKey("Chart of accounts"),
  startDate: tKey("Start date"),
  lockDate: tKey("Lock date"),
  lockDateHint: tKey("Nothing dated on or before it can be entered by hand."),
  ledgerOn: tKey("Ledger on"),
  currency: tKey("Currency"),
  fiscalYearStarts: tKey("Fiscal year starts"),
  taxOnPayment: tKey("Tax due when paid"),
  taxOnPaymentHint: tKey("Advances count for tax when they are received."),
  region: tKey("Region"),
  startFixed: tKey("Fixed once journals are posted."),
  confirmLockTitle: tKey("Lock the books up to {date}?"),
  confirmUnlockTitle: tKey("Remove the lock date?"),
  confirmLockBody: tKey("Everyone who sets up the Ledger is told."),
  lock: tKey("Lock"),
  noCompanies: tKey("No company yet"),
  addCompany: tKey("Add a company"),
  addAccount: tKey("Add account"),
  editAccount: tKey("Edit account"),
  code: tKey("Code"),
  name: tKey("Name"),
  type: tKey("Type"),
  group: tKey("Group"),
  parent: tKey("Parent account"),
  none: tKey("None"),
  control: tKey("Control account"),
  controlHint: tKey("Posted only by its own records, such as invoices and bills."),
  manualEntries: tKey("Manual entries"),
  archived: tKey("Archived"),
  archive: tKey("Archive"),
  restore: tKey("Restore"),
  usedHint: tKey("It has entries: code, type and control stay as they are."),
  postingRoles: tKey("Posting roles"),
  roles: tKey("Roles"),
  moneyIn: tKey("Money in"),
  moneyOut: tKey("Money out"),
  addTaxCode: tKey("Add tax code"),
  editTaxCode: tKey("Edit tax code"),
  direction: tKey("Direction"),
  rate: tKey("Rate"),
  treatment: tKey("Treatment"),
  recoverable: tKey("Recoverable"),
  baseBox: tKey("Base box"),
  taxBox: tKey("Tax box"),
  outputBox: tKey("Output box"),
  effectiveFrom: tKey("Effective from"),
  effectiveTo: tKey("Effective to"),
  taxUsedHint: tKey("It has been used: end it and add the new rate from the day it starts."),
  saved: tKey("Saved"),
  save: tKey("Save"),
  couldNotLoad: tKey("Settings didn't load"),
  retry: tKey("Retry"),
  status: tKey("Status"),
  boxes: tKey("Boxes"),
  effective: tKey("Effective"),
} as const;
