import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "./orders";
import { readBills, type BillRow } from "./payables";
import { maskAccountNumber } from "./suppliers";

type Db = Pick<PoolClient, "query">;

export type RunStatus = "draft" | "submitted" | "approved" | "paid" | "cancelled";
export type PaymentRunRow = {
  id: string; number: number; note: string; status: RunStatus; createdBy: string; preparedBy: string; preparedByName: string; submittedAt: string | null;
  approvedBy: string | null; approvedByName: string | null; approvedAt: string | null; returnNote: string | null; paidByName: string | null; paidAt: string | null; paidOn: string | null;
  cancelReason: string | null; createdAt: string; version: number;
  /** How many invoices and suppliers it pays, the earliest due date among them, and its total per currency. */
  invoices: number; suppliers: number; dueFrom: string | null; totals: Array<{ currency: string; amount: string }>;
};

const RUN_SELECT = `SELECT run.id, run.number, run.note, run.status, run.created_by AS "createdBy", run.prepared_by AS "preparedBy", preparer.display_name AS "preparedByName",
  run.submitted_at AS "submittedAt", run.approved_by AS "approvedBy", approver.display_name AS "approvedByName", run.approved_at AS "approvedAt", run.return_note AS "returnNote",
  payer.display_name AS "paidByName", run.paid_at AS "paidAt", run.paid_on::text AS "paidOn", run.cancel_reason AS "cancelReason", run.created_at AS "createdAt", run.version,
  coalesce(listed.invoices, 0)::int AS invoices, coalesce(listed.suppliers, 0)::int AS suppliers, listed.due_from::text AS "dueFrom"
  FROM payment_runs run
  JOIN users preparer ON preparer.id = run.prepared_by
  LEFT JOIN users approver ON approver.id = run.approved_by
  LEFT JOIN users payer ON payer.id = run.paid_by
  LEFT JOIN LATERAL (SELECT count(*) AS invoices, count(DISTINCT bill.vendor_id) AS suppliers, min(bill.due_date) AS due_from FROM payment_run_items item
                       JOIN supplier_invoices bill ON bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id
                      WHERE item.workspace_id = run.workspace_id AND item.run_id = run.id) listed ON true`;

export async function readRuns(db: Db, workspaceId: string, filter: { id?: string } = {}): Promise<PaymentRunRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["run.workspace_id = $1"];
  if (filter.id) { values.push(filter.id); where.push(`run.id = $${values.length}`); }
  const rows = (await db.query<Omit<PaymentRunRow, "totals">>(`${RUN_SELECT} WHERE ${where.join(" AND ")} ORDER BY run.number DESC LIMIT 500`, values)).rows;
  if (!rows.length) return [];
  const totals = (await db.query<{ runId: string; currency: string; amount: string }>(
    `SELECT item.run_id AS "runId", bill.currency, sum(item.amount)::numeric(18, 4)::text AS amount
       FROM payment_run_items item JOIN supplier_invoices bill ON bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id
      WHERE item.workspace_id = $1 AND item.run_id = ANY($2::uuid[]) GROUP BY item.run_id, bill.currency ORDER BY bill.currency`, [workspaceId, rows.map((row) => row.id)])).rows;
  return rows.map((row) => ({ ...row, totals: totals.filter((item) => item.runId === row.id).map(({ runId: _runId, ...item }) => item) }));
}

export type RunItem = { id: string; invoiceId: string; amount: string; bankAccountId: string | null; bill: BillRow };

/** A run's invoices, each with what the run pays on it and the invoice as it stands now. */
export async function readRunItems(db: Db, workspaceId: string, runId: string): Promise<RunItem[]> {
  const items = (await db.query<Omit<RunItem, "bill">>(
    `SELECT id, invoice_id AS "invoiceId", amount::text AS amount, bank_account_id AS "bankAccountId" FROM payment_run_items WHERE workspace_id = $1 AND run_id = $2`,
    [workspaceId, runId])).rows;
  if (!items.length) return [];
  const bills = new Map((await readBills(db, workspaceId, { runId })).map((bill) => [bill.id, bill]));
  return items.map((item) => ({ ...item, bill: bills.get(item.invoiceId)! }))
    .sort((a, b) => a.bill.supplierName.localeCompare(b.bill.supplierName) || (a.bill.dueDate ?? a.bill.invoiceDate).localeCompare(b.bill.dueDate ?? b.bill.invoiceDate)
      || a.bill.number.localeCompare(b.bill.number));
}

export type RunPayment = {
  key: string; vendorId: string; supplierName: string; legalEntityId: string; companyName: string; currency: string; amount: string;
  invoices: Array<{ invoiceId: string; number: string; amount: string }>;
};

/** The payments a run makes: one per supplier, buying company and currency, adding up its invoices' amounts exactly. */
export function runPayments(items: Array<Pick<RunItem, "invoiceId" | "amount"> & { bill: Pick<BillRow, "vendorId" | "supplierName" | "legalEntityId" | "companyName" | "currency" | "number"> }>) {
  const groups = new Map<string, Omit<RunPayment, "amount"> & { sum: Dec }>();
  for (const item of items) {
    const key = `${item.bill.vendorId}|${item.bill.legalEntityId}|${item.bill.currency}`;
    const group = groups.get(key) ?? { key, vendorId: item.bill.vendorId, supplierName: item.bill.supplierName, legalEntityId: item.bill.legalEntityId, companyName: item.bill.companyName,
      currency: item.bill.currency, invoices: [], sum: Dec.ZERO };
    group.sum = group.sum.add(item.amount);
    group.invoices.push({ invoiceId: item.invoiceId, number: item.bill.number, amount: item.amount });
    groups.set(key, group);
  }
  return [...groups.values()].map(({ sum, ...group }): RunPayment => ({ ...group, amount: sum.toFixed(currencyDecimals(group.currency)) }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.companyName.localeCompare(b.companyName) || a.currency.localeCompare(b.currency));
}

/**
 * What the supplier sees on a run's transfer: the run and the invoices it pays ("Run 3: INV-1, INV-2"), at
 * most 120 characters; invoices that don't fit are counted ("+4").
 */
export function runReference(runNumber: number, invoices: string[]) {
  const text = (count: number) => `Run ${runNumber}: ${[invoices.slice(0, count).join(", "), count < invoices.length ? `+${invoices.length - count}` : ""].filter(Boolean).join(" ")}`;
  let count = invoices.length;
  while (count > 0 && text(count).length > 120) count -= 1;
  return text(count).slice(0, 120);
}

export type BankLine = { supplier: string; accountName: string; bank: string; accountNumber: string; swift: string; amount: string; currency: string; reference: string };

/**
 * An approved run's file for the bank, one row per payment, amounts in the currency's minor units. Only
 * people who may see whole account numbers get them; everyone else gets the last four digits. Cells are
 * quoted when they need it (RFC 4180), and text a spreadsheet would read as a formula is kept as text.
 */
export function bankFile(lines: BankLine[], fullNumbers: boolean) {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [["Supplier", "Account name", "Bank", "Account number", "SWIFT", "Amount", "Currency", "Reference"],
    ...lines.map((line) => [line.supplier, line.accountName, line.bank, fullNumbers ? line.accountNumber : maskAccountNumber(line.accountNumber), line.swift,
      Dec.of(line.amount).toFixed(currencyDecimals(line.currency)), line.currency, line.reference])];
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export type SupplierBank = {
  vendorId: string;
  /** The supplier's approved account now, if any. */
  approved: { id: string; accountName: string; bankName: string; accountNumber: string; swift: string } | null;
  /** New details wait for approval: no run pays the supplier until they're decided. */
  pending: boolean;
};

/** Each supplier's approved bank account and whether new details are waiting. */
export async function readSupplierBanks(db: Db, workspaceId: string, vendorIds: string[]): Promise<Map<string, SupplierBank>> {
  const rows = (await db.query<{ vendorId: string; id: string | null; accountName: string | null; bankName: string | null; accountNumber: string | null; swift: string | null; pending: boolean }>(
    `SELECT vendor.id AS "vendorId", account.id, account.account_name AS "accountName", account.bank_name AS "bankName", account.account_number AS "accountNumber", account.swift,
            EXISTS (SELECT 1 FROM vendor_bank_accounts waiting WHERE waiting.workspace_id = vendor.workspace_id AND waiting.vendor_id = vendor.id AND waiting.status = 'pending') AS pending
       FROM workspace_vendors vendor
       LEFT JOIN LATERAL (SELECT id, account_name, bank_name, account_number, swift FROM vendor_bank_accounts
                           WHERE workspace_id = vendor.workspace_id AND vendor_id = vendor.id AND status = 'approved' ORDER BY decided_at DESC LIMIT 1) account ON true
      WHERE vendor.workspace_id = $1 AND vendor.id = ANY($2::uuid[])`, [workspaceId, [...new Set(vendorIds)]])).rows;
  return new Map(rows.map((row) => [row.vendorId, {
    vendorId: row.vendorId, pending: row.pending,
    approved: row.id ? { id: row.id, accountName: row.accountName!, bankName: row.bankName!, accountNumber: row.accountNumber!, swift: row.swift ?? "" } : null,
  }]));
}
