import { useQuery } from '@tanstack/react-query';
import { ApiError, useApi } from '../../core/api';

/**
 * Finance and supplier records on the phone (FD-6): what a notice about a client invoice, a supplier's
 * invoice, a payment run or a supplier leads to. Read-only; deciding happens in Approvals, editing on the web.
 * Each reads the same endpoint as the web, under the same permission.
 */
export type ClientInvoice = {
  id: string; projectId: string; projectReference: string; number: string; issueDate: string; dueDate: string; currency: string; total: string;
  milestoneTitle: string; customerName: string; status: 'issued' | 'credited'; paid: string; balance: string; overdue: boolean; creditNoteNumber: string | null;
};
export type Bill = {
  id: string; vendorId: string; supplierName: string; companyName: string; number: string; invoiceDate: string; dueDate: string | null; currency: string;
  total: string; status: 'draft' | 'held' | 'approved' | 'cancelled'; holdReasons: string; paid: string; balance: string; retentionHeld: string;
};
export type SupplierBalance = { vendorId: string; supplierName: string; companyName: string; currency: string; owed: string; overdue: string; held: string; retention: string };
export type PaymentRun = {
  id: string; number: number; note: string; status: 'draft' | 'submitted' | 'approved' | 'paid' | 'cancelled'; preparedByName: string; approvedByName: string | null;
  paidOn: string | null; invoices: number; suppliers: number; totals: Array<{ currency: string; amount: string }>;
};
export type Supplier = {
  id: string; name: string; approval: 'pending' | 'approved' | 'not_approved' | 'on_hold'; approvalNote: string; contactName: string | null; phone: string | null;
  email: string | null; status: 'draft' | 'active' | 'archived';
};
export type SupplierDocument = { id: string; kind: string; label: string; expiresOn: string | null; required: boolean; replacedAt: string | null };

export type InvoiceState = { invoice: ClientInvoice };
export type BillState = { bill: Bill; canApproveThis: boolean };
export type RunState = { run: PaymentRun; canApproveThis: boolean };
export type SupplierAccountState = { supplier: { id: string; name: string }; balances: SupplierBalance[]; bills: Bill[] };
export type SupplierState = { supplier: Supplier; documents: SupplierDocument[]; openOrders: Array<{ id: string; number: string; status: string; total: string; currency: string }> };
export type FinanceOverview = { invoices: ClientInvoice[] | null; bills: Bill[] | null };

function useRecord<T>(key: string, path: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['finance', api.workspaceId, key, path],
    queryFn: () => api.get<T>(path!),
    enabled: Boolean(path),
    // A missing or forbidden record doesn't get better by asking again.
    retry: (count, error) => !(error instanceof ApiError && [403, 404].includes(error.status)) && count < 2,
  });
}

const uuid = (value: string | undefined) => (value && /^[0-9a-fA-F-]{36}$/.test(value) ? value : null);

export const useClientInvoice = (id?: string) => useRecord<InvoiceState>('invoice', uuid(id) && `receivables/invoices/${id}`);
export const useBill = (id?: string) => useRecord<BillState>('bill', uuid(id) && `payables/bills/${id}`);
export const usePaymentRun = (id?: string) => useRecord<RunState>('run', uuid(id) && `payables/runs/${id}`);
export const useSupplierAccount = (id?: string) => useRecord<SupplierAccountState>('supplier-account', uuid(id) && `payables/suppliers/${id}`);
export const useSupplier = (id?: string) => useRecord<SupplierState>('supplier', uuid(id) && `purchasing/suppliers/${id}`);

/** What's open on both sides: client invoices with money still due and supplier invoices still to pay. Either side is null without its permission. */
export function useFinanceOverview() {
  const api = useApi();
  const allowed = async <T,>(path: string) => {
    try { return await api.get<T>(path); } catch (error) { if (error instanceof ApiError && error.status === 403) return null; throw error; }
  };
  return useQuery({
    queryKey: ['finance', api.workspaceId, 'overview'],
    queryFn: async (): Promise<FinanceOverview> => {
      const [receivables, payables] = await Promise.all([allowed<{ invoices: ClientInvoice[] }>('receivables'), allowed<{ bills: Bill[] }>('payables')]);
      return {
        invoices: receivables ? openInvoices(receivables.invoices) : null,
        bills: payables ? openBills(payables.bills) : null,
      };
    },
  });
}

/** Client invoices with money still due, overdue first, then by due date. */
export function openInvoices(invoices: ClientInvoice[]) {
  return invoices.filter((invoice) => invoice.status === 'issued' && Number(invoice.balance) > 0)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate));
}

/** Supplier invoices still to pay: held ones first (they need someone), then by due date. */
export function openBills(bills: Bill[]) {
  return bills.filter((bill) => ['held', 'approved'].includes(bill.status) && Number(bill.balance) > 0)
    .sort((a, b) => Number(b.status === 'held') - Number(a.status === 'held') || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}
