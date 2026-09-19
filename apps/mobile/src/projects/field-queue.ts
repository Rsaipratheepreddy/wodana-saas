import { ApiError, AuthError } from '../auth/client';

export type ProjectFieldMedia = {
  id: string;
  localUri: string;
  name: string;
  mimeType: string;
  byteSize: number;
  uploaded: boolean;
  encrypted?: boolean;
};

export type ProjectFieldQueueState = 'pending' | 'syncing' | 'conflict' | 'permission' | 'invalid';
export type ProjectFieldQueueStage = 'command' | 'media' | 'submit';

export type PendingProjectFieldOperation = {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  recordId: string;
  label: string;
  kind: 'report' | 'snag' | 'snag_status' | 'warranty_snag' | 'handover_item';
  command: Record<string, unknown>;
  submitRequestId?: string;
  revision: number;
  media: ProjectFieldMedia[];
  stage: ProjectFieldQueueStage;
  state: ProjectFieldQueueState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  error: string;
};

export type ProjectFieldQueueTransport = {
  command: (projectId: string, body: Record<string, unknown>) => Promise<unknown>;
  upload: (operation: PendingProjectFieldOperation, media: ProjectFieldMedia) => Promise<unknown>;
  checkpoint: (operation: PendingProjectFieldOperation) => Promise<void>;
};

function revisionFrom(result: unknown, fallback: number) {
  if (!result || typeof result !== 'object') return fallback;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return fallback;
  const revision = (data as { revision?: unknown }).revision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) ? revision : fallback;
}

/**
 * Syncs one field operation in idempotent checkpoints. Daily reports are first
 * saved as drafts so stable evidence IDs can be attached before submission.
 */
export async function syncProjectFieldOperation(
  operation: PendingProjectFieldOperation,
  transport: ProjectFieldQueueTransport,
) {
  let current: PendingProjectFieldOperation = {
    ...operation,
    state: 'syncing',
    attempts: operation.attempts + 1,
    updatedAt: Date.now(),
    error: '',
  };
  await transport.checkpoint(current);

  if (current.stage === 'command') {
    const result = await transport.command(current.projectId, {
      ...current.command,
      revision: current.revision,
    });
    current = {
      ...current,
      revision: revisionFrom(result, current.revision),
      stage: 'media',
      updatedAt: Date.now(),
    };
    await transport.checkpoint(current);
  }

  if (current.stage === 'media') {
    for (let index = 0; index < current.media.length; index += 1) {
      const media = current.media[index];
      if (media.uploaded) continue;
      const result = await transport.upload(current, media);
      current = {
        ...current,
        revision: revisionFrom(result, current.revision),
        media: current.media.map((item, position) =>
          position === index ? { ...item, uploaded: true } : item,
        ),
        updatedAt: Date.now(),
      };
      await transport.checkpoint(current);
    }
    if (current.kind === 'report') {
      current = { ...current, stage: 'submit', updatedAt: Date.now() };
      await transport.checkpoint(current);
    }
  }

  if (current.stage === 'submit') {
    const result = await transport.command(current.projectId, {
      action: 'submit_report',
      requestId: current.submitRequestId,
      recordId: current.recordId,
      revision: current.revision,
    });
    current = {
      ...current,
      revision: revisionFrom(result, current.revision),
      updatedAt: Date.now(),
    };
  }
  return current;
}

export function projectFieldSyncFailure(error: unknown): {
  state: Exclude<ProjectFieldQueueState, 'syncing'>;
  message: string;
} {
  const message = error instanceof Error
    ? error.message
    : 'Sync stopped. Your local field update is still available.';
  if (error instanceof ApiError) {
    if (error.status === 409) return { state: 'conflict', message };
    if (error.status === 401 || error.status === 403)
      return { state: 'permission', message };
    if ([400, 404, 422].includes(error.status))
      return { state: 'invalid', message };
  }
  if (error instanceof AuthError && ['access', 'expired'].includes(error.code))
    return { state: 'permission', message };
  return { state: 'pending', message };
}

export function decodeProjectFieldQueue(
  raw: string | null,
  scope: { userId: string; workspaceId: string },
): PendingProjectFieldOperation[] {
  if (!raw) return [];
  const rows = JSON.parse(raw) as PendingProjectFieldOperation[];
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        row.userId !== scope.userId ||
        row.workspaceId !== scope.workspaceId ||
        !row.projectId ||
        !row.recordId ||
        !row.id ||
        !['report', 'snag', 'snag_status', 'warranty_snag', 'handover_item'].includes(row.kind),
    )
  )
    throw new Error('The saved project field queue could not be read safely.');
  return rows;
}

export function mergeProjectFieldQueue(
  rows: PendingProjectFieldOperation[],
  operation: PendingProjectFieldOperation,
) {
  const next = [
    ...rows.filter((row) => row.id !== operation.id),
    operation,
  ].sort((left, right) => left.createdAt - right.createdAt);
  if (next.length > 50)
    throw new Error('Sync or remove an older project draft before saving another one.');
  return next;
}

export const projectFieldQueueSummary = (rows: PendingProjectFieldOperation[]) => ({
  pending: rows.filter((row) => ['pending', 'syncing'].includes(row.state)).length,
  attention: rows.filter((row) => !['pending', 'syncing'].includes(row.state)).length,
});
