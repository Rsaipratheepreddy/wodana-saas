import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthError } from '../src/auth/client';
import {
  decodeProjectFieldQueue,
  mergeProjectFieldQueue,
  projectFieldSyncFailure,
  syncProjectFieldOperation,
  type PendingProjectFieldOperation,
} from '../src/projects/field-queue';

const operation = (): PendingProjectFieldOperation => ({
  id: 'operation-1', userId: 'user-1', workspaceId: 'workspace-1', projectId: 'project-1',
  projectName: 'Villa', recordId: 'report-1', label: 'Daily report', kind: 'report',
  command: { action: 'draft_report_task', requestId: 'operation-1' }, submitRequestId: 'submit-1',
  revision: 3, media: [
    { id: 'photo-1', localUri: 'file:///photo-1.jpg', name: 'photo-1.jpg', mimeType: 'image/jpeg', byteSize: 10, uploaded: false },
    { id: 'photo-2', localUri: 'file:///photo-2.jpg', name: 'photo-2.jpg', mimeType: 'image/jpeg', byteSize: 12, uploaded: false },
  ], stage: 'command', state: 'pending', attempts: 0, createdAt: 1, updatedAt: 1, error: '',
});

test('project report sync checkpoints draft, each stable photo, and final submission', async () => {
  const calls: string[] = [], checkpoints: PendingProjectFieldOperation[] = [];
  const result = await syncProjectFieldOperation(operation(), {
    command: async (_projectId, body) => {
      calls.push(String(body.action));
      return { data: { revision: String(body.action) === 'submit_report' ? 7 : 4 } };
    },
    upload: async (_row, media) => {
      calls.push(media.id);
      return { data: { revision: media.id === 'photo-1' ? 5 : 6 } };
    },
    checkpoint: async row => { checkpoints.push(structuredClone(row)); },
  });
  assert.deepEqual(calls, ['draft_report_task', 'photo-1', 'photo-2', 'submit_report']);
  assert.equal(result.revision, 7);
  assert.equal(result.media.every(media => media.uploaded), true);
  assert.equal(checkpoints.at(-1)?.stage, 'submit');
});

test('project report retry resumes after acknowledged media without duplicate upload', async () => {
  const row = operation(); row.stage = 'media'; row.revision = 5; row.media[0].uploaded = true;
  const calls: string[] = [];
  await syncProjectFieldOperation(row, {
    command: async (_projectId, body) => { calls.push(String(body.action)); return { data: { revision: 7 } }; },
    upload: async (_operation, media) => { calls.push(media.id); return { data: { revision: 6 } }; },
    checkpoint: async () => {},
  });
  assert.deepEqual(calls, ['photo-2', 'submit_report']);
});

test('project field queue isolates users and surfaces optimistic conflicts', () => {
  const row = operation(), scope = { userId: row.userId, workspaceId: row.workspaceId };
  assert.deepEqual(decodeProjectFieldQueue(JSON.stringify([row]), scope), [row]);
  assert.throws(() => decodeProjectFieldQueue(JSON.stringify([row]), { ...scope, userId: 'other' }), /safely/);
  assert.equal(projectFieldSyncFailure(new ApiError('Project changed', 409)).state, 'conflict');
  assert.equal(projectFieldSyncFailure(new ApiError('Forbidden', 403)).state, 'permission');
  assert.equal(projectFieldSyncFailure(new AuthError('Offline', 'network')).state, 'pending');
  assert.deepEqual(mergeProjectFieldQueue([row], { ...row, error: 'offline', updatedAt: 2 })[0].error, 'offline');
});

test('handover evidence uses the same durable media checkpoints without a report submit stage', async () => {
  const row = operation();
  row.kind = 'handover_item';
  row.stage = 'command';
  row.command = { action: 'handover_outstanding_status', requestId: row.id };
  row.submitRequestId = undefined;
  const calls: string[] = [];
  const result = await syncProjectFieldOperation(row, {
    command: async (_projectId, body) => { calls.push(String(body.action)); return { data: { revision: 4 } }; },
    upload: async (_operation, media) => { calls.push(media.id); return { data: { revision: 5 } }; },
    checkpoint: async () => {},
  });
  assert.deepEqual(calls, ['handover_outstanding_status', 'photo-1', 'photo-2']);
  assert.equal(result.stage, 'media');
  assert.equal(result.media.every(media => media.uploaded), true);
});
