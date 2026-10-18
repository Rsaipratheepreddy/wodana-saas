import { ApiError } from '../../core/api';
import { registerOutboxHandler } from '../../core/outbox';
import { purchasingKeys } from './api';

/** A delivery received on site or at the warehouse: the goods-received note (its id is the operation id), then its photos. */
export type ReceiptPayload = { orderId: string; receipt: Record<string, unknown>; photoIds: string[] };

registerOutboxHandler('purchasing.receipt', async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as ReceiptPayload;
  if (item.step < 1) { await api.send('purchasing/receipts', 'POST', { ...payload.receipt, id: item.id }); step(1); }
  for (let index = Math.max(0, item.step - 1); index < payload.photoIds.length; index += 1) {
    const photoId = payload.photoIds[index];
    try { await withFile(photoId, (file) => api.upload(`purchasing/receipts/${item.id}/photos/${photoId}`, 'POST', 'file', file)); }
    catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
    step(index + 2);
  }
  return [purchasingKeys.all(api.workspaceId)];
});
