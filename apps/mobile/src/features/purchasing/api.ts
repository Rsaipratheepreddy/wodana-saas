import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';

export type OrderStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'confirmed' | 'partly_received' | 'received' | 'closed' | 'cancelled';
export type OrderRow = {
  id: string; number: string; status: OrderStatus; vendorId: string; supplierName: string; currency: string; total: string;
  expectedDate: string | null; promisedDate: string | null; createdAt: string; createdByName: string | null;
  projects: Array<{ id: string; reference: string }>; lines: number; revision: number; version: number;
};
export type ExpectedOrder = OrderRow & { deliverTo: string; linesLeft: number; due: string | null };
export type OrderLine = {
  id: string; position: number; projectId: string | null; projectReference: string | null; description: string; specification: string;
  quantity: string; unit: string; unitPrice: string; total: string; accepted: string; rejected: string; pending: string; credited: string; returned: string;
  promisedDate: string | null; cancelled: string; due: string | null;
};
export type Receipt = {
  id: string; number: number; orderId: string | null; orderNumber: string | null; supplierName: string; locationId: string; locationName: string; locationKind: string;
  receivedOn: string; receivedBy: string; receivedByName: string; deliveryNote: string; notes: string; inspectedByName: string | null; inspectedAt: string | null;
  received: string; accepted: string; rejected: string; pending: string; missing: string; createdAt: string; reversedAt: string | null; photos: number;
};
export type ReceiptLine = {
  id: string; orderLineId: string; description: string; specification: string; unit: string; projectReference: string | null;
  received: string; accepted: string; rejected: string; pending: string; rejectReason: string; rejectKind: string | null; noted: string | null; inspectedByName: string | null;
};
export type ReceiptDetail = {
  receipt: Receipt; lines: ReceiptLine[]; photos: Array<{ id: string; name: string; byName: string; at: string }>;
  canReceive: boolean; canInspect: boolean; needsPhoto: boolean; canInspectThis: boolean;
};
export type DeliveriesState = {
  expected: ExpectedOrder[]; inspection: Receipt[]; received: Receipt[]; requireSitePhoto: boolean; canBuy: boolean; canReceive: boolean; canInspect: boolean; userId: string;
};
export type OrderDetail = {
  order: OrderRow & { deliverTo: string; deliveryAddress: string; supplierReference: string; notes: string };
  lines: OrderLine[]; receipts: Receipt[]; canReceive: boolean;
  supplier: { id: string; name: string; email: string | null; phone: string | null; contactName: string | null } | null;
};
/** Where goods can be received: a location, or one made on first use (`site:<project>`, `warehouse`, `factory`), which has no name yet. */
export type Place = { key: string; kind: 'warehouse' | 'factory' | 'site' | 'other'; name: string | null; projectReference: string | null; projectName: string | null };
export type ReceivingForm = {
  order: OrderRow & { deliverTo: string };
  lines: Array<OrderLine & { outstanding: string; receivable: string }>;
  places: Place[];
  defaultPlace: string | null; requireInspection: boolean; receiveTolerancePercent: number; requireSitePhoto: boolean;
};
export type TransferDetail = {
  transfer: { id: string; number: number; status: 'in_transit' | 'received' | 'cancelled'; fromLocationName?: string; toLocationName?: string; sentOn?: string | null; note?: string };
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; projectId: string | null; projectReference: string | null; quantity: string; received: string | null; lossReason: string }>;
  canReceiveThis: boolean;
};

export const purchasingKeys = {
  all: (ws: string) => ['purchasing', ws] as const,
  deliveries: (ws: string) => ['purchasing', ws, 'deliveries'] as const,
  orders: (ws: string) => ['purchasing', ws, 'orders'] as const,
  order: (ws: string, id: string) => ['purchasing', ws, 'order', id] as const,
  receiving: (ws: string, id: string) => ['purchasing', ws, 'receiving', id] as const,
  receipt: (ws: string, id: string) => ['purchasing', ws, 'receipt', id] as const,
  transfer: (ws: string, id: string) => ['purchasing', ws, 'transfer', id] as const,
};

const useOn = () => useSession().has('projects');

/** Deliveries: what's expected, what waits for inspection, and what came in lately. */
export function useDeliveries(enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.deliveries(api.workspaceId), queryFn: () => api.get<DeliveriesState>('purchasing/deliveries'), enabled: on && enabled });
}
export function useOrders(enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.orders(api.workspaceId), queryFn: () => api.get<{ orders: OrderRow[]; canReceive: boolean }>('purchasing/orders'), enabled: on && enabled });
}
export function useOrder(id: string) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.order(api.workspaceId, id), queryFn: () => api.get<OrderDetail>(`purchasing/orders/${id}`), enabled: on && !!id });
}
export function useReceivingForm(orderId: string) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.receiving(api.workspaceId, orderId), queryFn: () => api.get<ReceivingForm>(`purchasing/orders/${orderId}/receiving`), enabled: on && !!orderId });
}
export function useReceipt(id: string) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.receipt(api.workspaceId, id), queryFn: () => api.get<ReceiptDetail>(`purchasing/receipts/${id}`), enabled: on && !!id });
}
export function useTransfer(id: string) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: purchasingKeys.transfer(api.workspaceId, id), queryFn: () => api.get<TransferDetail>(`inventory/transfers/${id}`), enabled: on && !!id });
}

export const receiptPhotoPath = (photoId: string, preview = true) => `purchasing/photos/${photoId}${preview ? '?preview=1' : ''}`;
