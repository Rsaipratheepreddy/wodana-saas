import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthError } from '../src/auth/client';
import { decodeFieldQueue, fieldSyncFailure, mergeFieldQueue, queueSummary, syncFieldSave, type PendingFieldSave } from '../src/pre-project/field-queue';

const operation = (): PendingFieldSave => ({
  id: 'record-1', userId: 'user-1', workspaceId: 'workspace-1', caseId: 'case-1', specificationVersion: 4,
  record: { id: 'record-1', version: 2, kind: 'measurement', title: 'Reception wall', note: '', status: 'measured', roomId: 'room-1', entryId: 'item-1', visitId: null, assetIds: [], assets: [{ id: 'existing', name: 'plan.pdf', mimeType: 'application/pdf', byteSize: 2, hasPreview: false }], dimensions: [] },
  media: [
    { id: 'photo-1', localUri: 'file:///photo-1.jpg', name: 'photo-1.jpg', mimeType: 'image/jpeg', byteSize: 10, uploaded: false },
    { id: 'photo-2', localUri: 'file:///photo-2.jpg', name: 'photo-2.jpg', mimeType: 'image/jpeg', byteSize: 12, uploaded: false },
  ], consentConfirmed: true, state: 'pending', attempts: 0, createdAt: 1, updatedAt: 1, error: '',
});

test('field sync checkpoints every media acknowledgement and preserves stable IDs in the record write', async () => {
  const uploads: string[] = [], checkpoints: PendingFieldSave[] = []; let saved: Record<string, unknown> | undefined;
  await syncFieldSave(operation(), () => ({ version: 2, assetIds: [] }), {
    upload: async media => { uploads.push(media.id); }, checkpoint: async row => { checkpoints.push(structuredClone(row)); },
    save: async (_path, body) => { saved = body; },
  });
  assert.deepEqual(uploads, ['photo-1', 'photo-2']);
  assert.equal(checkpoints.length, 3);
  assert.deepEqual(saved?.assetIds, ['existing', 'photo-1', 'photo-2']);
  assert.equal(saved?.evidenceConsentConfirmed, true);
});

test('field retry skips files already acknowledged before a lost record response', async () => {
  const row = operation(); row.media[0].uploaded = true; const uploads: string[] = [];
  await syncFieldSave(row, () => ({}), { upload: async media => { uploads.push(media.id); }, checkpoint: async () => {}, save: async () => ({}) });
  assert.deepEqual(uploads, ['photo-2']);
});

test('field failures stop for explicit review instead of overwriting or retrying blindly', () => {
  assert.equal(fieldSyncFailure(new ApiError('Revision changed', 409)).state, 'conflict');
  assert.equal(fieldSyncFailure(new ApiError('Forbidden', 403)).state, 'permission');
  assert.equal(fieldSyncFailure(new ApiError('Bad input', 422)).state, 'invalid');
  assert.equal(fieldSyncFailure(new AuthError('Offline', 'network')).state, 'pending');
  assert.deepEqual(queueSummary([{ ...operation(), state: 'pending' }, { ...operation(), id: 'two', state: 'conflict' }]), { pending: 1, attention: 1 });
});

test('persisted drafts are isolated by user, workspace and case and replace only the same record', () => {
  const row=operation(),scope={userId:row.userId,workspaceId:row.workspaceId,caseId:row.caseId};
  assert.deepEqual(decodeFieldQueue(JSON.stringify([row]),scope),[row]);
  assert.throws(()=>decodeFieldQueue(JSON.stringify([row]),{...scope,userId:'another-user'}),/safely/);
  assert.throws(()=>decodeFieldQueue(JSON.stringify([row]),{...scope,workspaceId:'another-workspace'}),/safely/);
  assert.throws(()=>decodeFieldQueue(JSON.stringify([row]),{...scope,caseId:'another-case'}),/safely/);
  const revised={...row,error:'offline',updatedAt:2};
  assert.deepEqual(mergeFieldQueue([row],revised),[revised]);
});
