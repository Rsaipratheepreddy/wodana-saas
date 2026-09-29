import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, useApi } from '../../core/api';
import { key } from '../../core/i18n';

/**
 * "Waiting for you" (AP-1): one list across modules from `GET approvals/mine`, decided in the row through
 * `POST approvals/decide`, which runs each module's own command and returns the refreshed list.
 */
export const APPROVAL_GROUPS = ['quotes', 'payments', 'deals', 'orders', 'factory', 'site', 'stock', 'finance'] as const;
export type ApprovalGroup = (typeof APPROVAL_GROUPS)[number];
export type ApprovalKind =
  | 'quote_review' | 'receipt' | 'deal_finance' | 'deal_approval' | 'order' | 'output' | 'material_swap'
  | 'site_report' | 'petty_cash' | 'snag' | 'warranty' | 'stock_correction' | 'bill' | 'payment_run' | 'reimbursement' | 'invoice';
export type ApprovalRow = {
  kind: ApprovalKind;
  group: ApprovalGroup;
  id: string;
  title: string;
  subject: string | null;
  project: { id: string; reference: string | null; name: string } | null;
  amount: string | null;
  currency: string | null;
  since: string;
  href: string;
  canDecide: boolean;
  reason: string | null;
  /** In-row decision; null means it opens (the evidence or a form is needed). */
  decide: { approve: string; other: 'return' | 'reject' | null; approveNeedsNote: boolean } | null;
  version: number | null;
  parentId: string | null;
};
export type WaitingForYou = { rows: ApprovalRow[]; count: number; counts: Record<ApprovalGroup, number> };
export type Decision = 'approve' | 'return' | 'reject';

export const GROUP_LABEL: Record<ApprovalGroup, string> = {
  quotes: key('Quotes'), payments: key('Payments'), deals: key('Deals'), orders: key('Orders'),
  factory: key('Factory'), site: key('Site'), stock: key('Stock'), finance: key('Finance'),
};
/** What the row asks for, in a word or two (the web's words). */
export const KIND_LABEL: Record<ApprovalKind, string> = {
  quote_review: key('Quote to review'), receipt: key('Payment to verify'), deal_finance: key('Deal to check'), deal_approval: key('Deal to approve'),
  order: key('Order to approve'), output: key('Output to approve'), material_swap: key('Material swap'), site_report: key('Site report'),
  petty_cash: key('Petty cash'), snag: key('Snag to close'), warranty: key('Warranty claim'), stock_correction: key('Stock correction'),
  bill: key('Held bill'), payment_run: key('Payment run'), reimbursement: key('To reimburse'), invoice: key('To invoice'),
};
export const approveLabel = (kind: ApprovalKind) => (kind === 'receipt' ? key('Verify') : key('Approve'));
export const otherLabel = (other: 'return' | 'reject') => (other === 'return' ? key('Return') : key('Refuse'));
/** A return or refusal always says why; some approvals do too. */
export const needsNote = (row: ApprovalRow, decision: Decision) => decision !== 'approve' || !!row.decide?.approveNeedsNote;

export const approvalsKey = (workspaceId: string) => ['approvals', workspaceId] as const;
export const approvalCountKey = (workspaceId: string) => ['approvals', workspaceId, 'count'] as const;
// A server without the list yet (older release) answers 404: the app hides the entry instead of retrying.
const unavailable = (error: unknown) => error instanceof ApiError && error.status === 404;

export function useWaitingForYou() {
  const api = useApi();
  return useQuery({
    queryKey: approvalsKey(api.workspaceId),
    queryFn: () => api.get<WaitingForYou>('approvals/mine'),
    refetchInterval: 60_000,
    retry: (count, error) => !unavailable(error) && count < 2,
  });
}

/** How many things wait for me (Today's row); null when the server has no list. */
export function useWaitingCount() {
  const api = useApi();
  const query = useQuery({
    queryKey: approvalCountKey(api.workspaceId),
    queryFn: () => api.get<{ count: number }>('approvals/mine/count'),
    refetchInterval: 60_000,
    retry: (count, error) => !unavailable(error) && count < 2,
  });
  return { ...query, count: query.data?.count ?? null };
}

export function useDecide() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ row, decision, note }: { row: ApprovalRow; decision: Decision; note: string }) =>
      api.send<WaitingForYou>('approvals/decide', 'POST', { kind: row.kind, id: row.id, decision, note: note.trim() }),
    onSuccess: (list) => {
      queryClient.setQueryData(approvalsKey(api.workspaceId), list);
      queryClient.setQueryData(approvalCountKey(api.workspaceId), { count: list.count, counts: list.counts });
    },
    // Whatever happened, the list shows what still waits (someone else may have decided it).
    onSettled: () => queryClient.invalidateQueries({ queryKey: approvalsKey(api.workspaceId) }),
  });
}
