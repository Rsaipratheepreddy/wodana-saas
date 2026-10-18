import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthError } from '../src/auth/client';
import type { Api } from '../src/core/api';
import { createItem, due, enqueue, markRetry, markStep, remove, retryNow, type OutboxFile, type OutboxItem } from '../src/core/outbox-model';
import { sendItem } from '../src/core/outbox-send';
import { itemsIn, parseRoomsSnapshot, photoNoteCapture, roomsSnapshot } from '../src/features/capture/capture-model';
import { sendObservation, sendSiteAnswers } from '../src/features/survey/send';

const CASE = 'case-1';
const opener = async (_itemId: string, file: OutboxFile) => ({ file: { uri: `file:///cache/${file.key}.jpg`, name: file.name, type: file.type }, cleanup: () => undefined });

/** The photo note as the capture screen queues it: two photos, then the room (and an item in it) chosen. */
function queued(now = 1_000): OutboxItem {
  const capture = photoNoteCapture({
    operationId: 'op-1', recordId: 'note-1', caseId: CASE, title: 'Kitchen · Island', note: 'Damp by the window', roomId: 'room-kitchen', entryId: 'item-island',
    photos: [{ id: 'p1', uri: 'file:///camera/1.jpg', name: 'p1.jpg', type: 'image/jpeg' }, { id: 'p2', uri: 'file:///camera/2.jpg', name: 'p2.jpg', type: 'image/jpeg' }],
    listTitle: 'Photo note · Villa 402 · Kitchen',
  });
  return createItem({ ...capture.item, workspaceId: 'ws-1', files: capture.files }, now);
}

/** A server that records what it was asked; `failUploads` refuses the first uploads with a dropped connection. */
function server(options: { offline?: boolean; alreadyUp?: string[] } = {}) {
  const calls: string[] = [];
  let body: Record<string, unknown> | null = null;
  const api = {
    workspaceId: 'ws-1',
    get: async <T,>(path: string) => {
      if (options.offline) throw new AuthError('Unable to connect.', 'network');
      calls.push(`GET ${path}`);
      return { items: [] } as T;
    },
    send: async <T,>(path: string, method: string, sent?: unknown) => { calls.push(`${method} ${path}`); body = sent as Record<string, unknown>; return {} as T; },
    upload: async <T,>(path: string) => {
      if (options.offline) throw new AuthError('Unable to connect.', 'network');
      calls.push(`UPLOAD ${path}`);
      if (options.alreadyUp?.some((id) => path.endsWith(id))) throw new ApiError('Already uploaded', 409);
      return {} as T;
    },
    url: (path: string) => path,
  } as unknown as Api;
  return { api, calls, body: () => body };
}

test('a photo-first capture is queued on the phone with the room chosen after the photos', () => {
  const item = queued();
  assert.equal(item.kind, 'survey.photo');
  assert.equal(item.scope, `case:${CASE}`);
  assert.deepEqual(item.files.map((file) => file.key), ['p1', 'p2']);
  assert.deepEqual(item.payload, {
    caseId: CASE, photoIds: ['p1', 'p2'],
    record: { id: 'note-1', title: 'Kitchen · Island', note: 'Damp by the window', roomId: 'room-kitchen', entryId: 'item-island', category: 'condition' },
  });
  // The same operation is never queued twice.
  assert.equal(enqueue(enqueue([], item), queued(2_000)).length, 1);
  // An item without a room never keeps one.
  const noRoom = photoNoteCapture({ operationId: 'op-2', recordId: 'note-2', caseId: CASE, title: ' Site photo ', note: '', roomId: null, entryId: 'item-island', photos: [], listTitle: 'x' });
  assert.deepEqual([noRoom.item.payload.record], [{ id: 'note-2', title: 'Site photo', note: '', roomId: null, entryId: null, category: 'condition' }]);
});

test('offline, the capture waits and is retried later; back online it uploads the photos, then the note with its room, and leaves the queue', async () => {
  let queue = enqueue([], queued(1_000));
  // No connection: the send stops, nothing is lost, the item waits with a back-off.
  const offline = server({ offline: true });
  const first = await sendItem(due(queue, 'ws-1', 1_000)[0], sendObservation, { api: offline.api, open: opener, step: () => undefined });
  assert.deepEqual(first, { kind: 'retry', message: 'Unable to connect.', offline: true });
  queue = markRetry(queue, 'op-1', first.kind === 'retry' ? first.message : '', 2_000, () => 0.5);
  assert.equal(queue[0].status, 'pending');
  assert.equal(due(queue, 'ws-1', 2_000).length, 0, 'not tried again before its back-off');
  // The connection is back (the app retries at once when it regains one).
  queue = retryNow(queue, 'op-1', 20_000);
  const online = server();
  const steps: number[] = [];
  const sent = await sendItem(due(queue, 'ws-1', 20_000)[0], sendObservation, { api: online.api, open: opener, step: (done) => { steps.push(done); } });
  assert.deepEqual(sent, { kind: 'sent', keys: [['survey', 'ws-1', 'site', CASE]] });
  assert.deepEqual(online.calls, [
    `UPLOAD pre-projects/${CASE}/assets/p1`, `UPLOAD pre-projects/${CASE}/assets/p2`, `GET pre-projects/${CASE}/site`, `PUT pre-projects/${CASE}/site/observations`,
  ]);
  assert.deepEqual(steps, [1, 2]);
  assert.deepEqual(online.body(), {
    id: 'note-1', version: 0, title: 'Kitchen · Island', note: 'Damp by the window', assetIds: ['p1', 'p2'], roomId: 'room-kitchen', entryId: 'item-island',
    visitId: null, category: 'condition', status: 'open', resolution: '',
  });
  queue = remove(queue, 'op-1');
  assert.equal(queue.length, 0);
});

test('a retry picks up after the photos already sent, and a photo the server already has counts as sent', async () => {
  const item = markStep([queued()], 'op-1', 1)[0];
  const online = server({ alreadyUp: ['p2'] });
  const sent = await sendItem(item, sendObservation, { api: online.api, open: opener, step: () => undefined });
  assert.equal(sent.kind, 'sent');
  assert.deepEqual(online.calls.filter((call) => call.startsWith('UPLOAD')), [`UPLOAD pre-projects/${CASE}/assets/p2`]);
});

test('the rooms are kept on the phone so one can be chosen offline; a damaged copy reads as none', () => {
  const snapshot = roomsSnapshot({
    rooms: [{ id: 'room-kitchen', name: 'Kitchen' }, { id: 'room-bed', name: 'Bedroom' }],
    entries: [{ id: 'item-island', title: 'Island', kind: 'requirement', roomId: 'room-kitchen' }, { id: 'old', title: 'Old', kind: 'requirement', roomId: 'room-kitchen', archivedAt: '2026-01-01' },
      { id: 'file', title: 'Plan.pdf', kind: 'file', roomId: 'room-kitchen' }],
  });
  const kept = parseRoomsSnapshot(JSON.stringify(snapshot));
  assert.deepEqual(kept, snapshot);
  assert.deepEqual(itemsIn(kept, 'room-kitchen').map((item) => item.id), ['item-island']);
  assert.deepEqual(itemsIn(kept, null), []);
  assert.equal(parseRoomsSnapshot('{not json'), null);
  assert.equal(parseRoomsSnapshot(null), null);
});

test('site answers queued offline are sent against the visit as it is then: the kick-off while it is current, else the site visit', async () => {
  const answers = createItem({ id: 'op-a', kind: 'survey.answers', title: 'Questions', workspaceId: 'ws-1', payload: { caseId: CASE, answers: [{ key: 'access', answer: 'Lift to floor 4', status: null }] } }, 0);
  const at = (view: unknown) => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const api = { workspaceId: 'ws-1', get: async () => view, send: async (path: string, _method: string, body: unknown) => { calls.push({ path, body }); return {}; } } as unknown as Api;
    return { api, calls };
  };
  const visit = at({ stages: [{ stage: 'kickoff', status: 'done', version: 3 }], siteVisit: { within: 'task', open: true, done: false, version: 7 } });
  assert.equal((await sendItem(answers, sendSiteAnswers, { api: visit.api, open: opener, step: () => undefined })).kind, 'sent');
  assert.deepEqual(visit.calls, [{ path: `pre-projects/${CASE}/design-journey/site-visit/answers`, body: { version: 7, answers: [{ key: 'access', answer: 'Lift to floor 4', status: null }] } }]);
  const kickoff = at({ stages: [{ stage: 'kickoff', status: 'active', version: 4 }], siteVisit: null });
  await sendItem(answers, sendSiteAnswers, { api: kickoff.api, open: opener, step: () => undefined });
  assert.equal((kickoff.calls[0].body as { version: number }).version, 4);
  // A visit closed meanwhile is refused by the server: the item waits for the person instead of retrying for ever.
  const closed = { workspaceId: 'ws-1', get: async () => ({ siteVisit: { within: 'task', open: false, done: true, version: 9 } }),
    send: async () => { throw new ApiError('The design site measure is done', 409); } } as unknown as Api;
  assert.deepEqual(await sendItem(answers, sendSiteAnswers, { api: closed, open: opener, step: () => undefined }), { kind: 'blocked', message: 'The design site measure is done', issues: [] });
});
