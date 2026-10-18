import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthError } from '../src/auth/client';
import type { Api } from '../src/core/api';
import { createItem, OutboxFileError, type OutboxFile } from '../src/core/outbox-model';
import { outcomeOf, sendItem, type OutboxHandler } from '../src/core/outbox-send';

const api = { workspaceId: 'ws-1' } as unknown as Api;
const item = () => createItem<Record<string, unknown>>({
  id: 'report-1', kind: 'site.report', title: 'Daily report', workspaceId: 'ws-1', payload: {},
  files: [
    // Picked in the browser: its bytes were kept in IndexedDB when it was queued.
    { key: 'web-photo', uri: 'outbox-file:report-1/web-photo', name: 'photo-1.jpg', type: 'image/jpeg', encrypted: false },
    // Taken on the phone: sealed in the app's documents.
    { key: 'phone-photo', uri: 'file:///data/wodana-outbox/report-1/phone-photo.bin', name: 'photo-2.jpg', type: 'image/jpeg', encrypted: true },
  ],
});
/** Opens like the app does: a fresh object URL for a browser photo, a decrypted copy for a phone photo. */
const opener = (log: string[]) => async (_itemId: string, file: OutboxFile) => {
  const uri = file.uri.startsWith('outbox-file:') ? 'blob:http://localhost:8082/fresh' : 'file:///cache/wodana-upload/plain.jpg';
  log.push(`open ${file.key}`);
  return { file: { uri, name: file.name, type: file.type }, cleanup: () => { log.push(`close ${file.key}`); } };
};

test('a send hands the handler each photo as a readable file, browser and phone photos alike, and releases it after', async () => {
  const log: string[] = [];
  const handler: OutboxHandler = async ({ withFile, step, item: current }) => {
    for (const [index, file] of current.files.entries()) {
      await withFile(file.key, async (plain) => { log.push(`upload ${plain.uri}`); });
      step(index + 1);
    }
    return [['site', 'ws-1']];
  };
  const steps: number[] = [];
  const outcome = await sendItem(item(), handler, { api, open: opener(log), step: (done) => { steps.push(done); } });
  assert.deepEqual(outcome, { kind: 'sent', keys: [['site', 'ws-1']] });
  assert.deepEqual(log, [
    'open web-photo', 'upload blob:http://localhost:8082/fresh', 'close web-photo',
    'open phone-photo', 'upload file:///cache/wodana-upload/plain.jpg', 'close phone-photo',
  ]);
  assert.deepEqual(steps, [1, 2]);
});

test('a photo the device no longer has blocks the item with its reason instead of retrying for ever', async () => {
  const reason = 'The photo saved for this is no longer on this device. Take it again.';
  const gone = await sendItem(item(), async ({ withFile }) => { await withFile('web-photo', async () => undefined); },
    { api, open: async () => { throw new OutboxFileError(reason); }, step: () => {} });
  assert.deepEqual(gone, { kind: 'blocked', message: reason, issues: [] });
  const log: string[] = [];
  const missing = await sendItem(item(), async ({ withFile }) => { await withFile('not-queued', async () => undefined); }, { api, open: opener(log), step: () => {} });
  assert.equal(missing.kind, 'blocked');
  assert.deepEqual(log, [], 'nothing is opened for a photo that was never queued');
});

test('the server’s refusal blocks with its issues; no connection and server hiccups retry; signed out waits', () => {
  assert.deepEqual(outcomeOf(new ApiError('Give a reason', 422, ['Location missing'])), { kind: 'blocked', message: 'Give a reason', issues: ['Location missing'] });
  assert.deepEqual(outcomeOf(new ApiError('', 503)), { kind: 'retry', message: 'No connection', offline: false });
  assert.deepEqual(outcomeOf(new AuthError('Unable to connect.', 'network')), { kind: 'retry', message: 'Unable to connect.', offline: true });
  assert.deepEqual(outcomeOf(new AuthError('Your session has expired.', 'expired')), { kind: 'signedOut', message: 'Your session has expired.' });
  // A failure nothing classifies (the browser's "Failed to fetch") is tried again later, never dropped.
  assert.deepEqual(outcomeOf(new TypeError('Failed to fetch')), { kind: 'retry', message: 'Failed to fetch', offline: false });
});
