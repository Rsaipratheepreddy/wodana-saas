import { ApiError, AuthError } from '../auth/client';
import type { SiteRecord } from './api';

export type PendingFieldMedia = {
  id: string;
  localUri: string;
  name: string;
  mimeType: string;
  byteSize: number;
  uploaded: boolean;
  encrypted?: boolean;
};
export type FieldQueueState = 'pending' | 'syncing' | 'conflict' | 'permission' | 'invalid';
export type PendingFieldSave = {
  id: string;
  userId: string;
  workspaceId: string;
  caseId: string;
  record: SiteRecord;
  specificationVersion: number;
  media: PendingFieldMedia[];
  consentConfirmed: boolean;
  state: FieldQueueState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  error: string;
};
export type FieldQueueTransport = {
  upload: (media: PendingFieldMedia) => Promise<unknown>;
  save: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  checkpoint: (operation: PendingFieldSave) => Promise<void>;
};

export const fieldRecordPath = (kind: SiteRecord['kind']) =>
  `site/${kind === 'visit' ? 'visits' : kind === 'measurement' ? 'measurements' : 'observations'}`;

/** Uploads are checkpointed individually. A retry never creates a second asset or record. */
export async function syncFieldSave(
  operation: PendingFieldSave,
  payload: (record: SiteRecord, specificationVersion: number) => Record<string, unknown>,
  transport: FieldQueueTransport,
) {
  let current = { ...operation, state: 'syncing' as const, attempts: operation.attempts + 1, updatedAt: Date.now(), error: '' };
  await transport.checkpoint(current);
  for (let index = 0; index < current.media.length; index += 1) {
    const media = current.media[index];
    if (media.uploaded) continue;
    await transport.upload(media);
    current = { ...current, media: current.media.map((item, position) => position === index ? { ...item, uploaded: true } : item), updatedAt: Date.now() };
    await transport.checkpoint(current);
  }
  const body = { ...payload(current.record, current.specificationVersion),
    assetIds: [...current.record.assets.map(asset => asset.id), ...current.media.map(media => media.id)],
    evidenceConsentConfirmed: current.consentConfirmed };
  return transport.save(fieldRecordPath(current.record.kind), body);
}

export function fieldSyncFailure(error: unknown): { state: Exclude<FieldQueueState, 'syncing'>; message: string } {
  const message = error instanceof Error ? error.message : 'Sync stopped. Your local copy is still available.';
  if (error instanceof ApiError) {
    if (error.status === 409) return { state: 'conflict', message };
    if (error.status === 401 || error.status === 403) return { state: 'permission', message };
    if (error.status === 400 || error.status === 404 || error.status === 422) return { state: 'invalid', message };
  }
  if (error instanceof AuthError && ['access', 'expired'].includes(error.code)) return { state: 'permission', message };
  return { state: 'pending', message };
}

export const queueSummary = (operations: PendingFieldSave[]) => ({
  pending: operations.filter(operation => operation.state === 'pending' || operation.state === 'syncing').length,
  attention: operations.filter(operation => !['pending', 'syncing'].includes(operation.state)).length,
});

export function decodeFieldQueue(raw: string | null, scope: { userId: string; workspaceId: string; caseId: string }): PendingFieldSave[] {
  if (!raw) return [];
  const rows = JSON.parse(raw) as PendingFieldSave[];
  if (!Array.isArray(rows) || rows.some(row => row.userId !== scope.userId || row.workspaceId !== scope.workspaceId || row.caseId !== scope.caseId || !row.record?.id || row.id !== row.record.id)) {
    throw new Error('The saved field queue could not be read safely.');
  }
  return rows;
}

export function mergeFieldQueue(rows: PendingFieldSave[], operation: PendingFieldSave) {
  const next = [...rows.filter(row => row.id !== operation.id), operation].sort((a, b) => a.createdAt - b.createdAt);
  if (next.length > 50) throw new Error('Sync or remove an older field draft before saving another one.');
  return next;
}
