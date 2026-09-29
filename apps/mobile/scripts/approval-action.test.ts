import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthError } from '../src/auth/client';
import { afterRetry, approvalKey, enqueue, MAX_TRIES, outcomeOf, parsePending, partitionDue, PENDING_TTL_MS, pushApproval } from '../src/features/shell/approval-action-model';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const order = '22222222-2222-4222-8222-222222222222';
const data = { notificationId: '33333333-3333-4333-8333-333333333333', workspaceId, deepLink: `/workspace/purchasing/orders?order=${order}`, approval: { kind: 'order', id: order, version: 5 } };

test('a push names the row its Approve decides; anything else opens the app', () => {
  assert.deepEqual(pushApproval({ title: 'PO-0042 needs approval', body: 'Al Noor Timber', data }),
    { workspaceId, kind: 'order', id: order, version: 5, title: 'PO-0042 needs approval', deepLink: data.deepLink });
  // Android can hand the data over as a JSON string.
  assert.equal(pushApproval({ title: 'x', data: { dataString: JSON.stringify(data) } })?.id, order);
  assert.equal(pushApproval({ title: 'x', data: { ...data, approval: { kind: 'bill', id: order, version: 1 } } }), null, 'a bill needs a note');
  assert.equal(pushApproval({ title: 'x', data: { ...data, approval: { kind: 'order', id: '../x', version: 1 } } }), null);
  assert.equal(pushApproval({ title: 'x', data: { ...data, approval: { kind: 'order', id: order } } }), null, 'no version, no Approve: a changed record is never approved unseen');
  assert.equal(pushApproval({ title: 'x', data: { ...data, workspaceId: 'nope' } }), null);
  assert.equal(pushApproval({ title: 'x', data: { notificationId: data.notificationId, workspaceId } }), null);
  assert.equal(pushApproval({ title: 'x', data: null }), null);
});

test('a tap is held one per row for a few minutes only, and survives the app being paused', () => {
  const item = pushApproval({ title: 'PO-0042', data })!;
  const once = enqueue([], item, 1000);
  const twice = enqueue(once, item, 2000);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].at, 2000);
  assert.equal(approvalKey(twice[0]), `${workspaceId}:order:${order}`);
  assert.ok(PENDING_TTL_MS <= 15 * 60 * 1000, 'approvals never wait long (plan §6.29)');
  assert.deepEqual(partitionDue(twice, 2000 + PENDING_TTL_MS - 1), { due: twice, stale: [] });
  assert.deepEqual(partitionDue(twice, 2000 + PENDING_TTL_MS), { due: [], stale: twice });
  assert.deepEqual(parsePending(JSON.stringify(twice)), twice);
  assert.deepEqual(parsePending('{"not":"a list"}'), []);
  assert.deepEqual(parsePending(JSON.stringify([{ ...twice[0], kind: 'bill' }, { junk: true }])), []);
  assert.deepEqual(parsePending(null), []);
});

test('what the server says decides the next step: done, gone, open the app, no connection, or try again in a moment', () => {
  assert.equal(outcomeOf(new ApiError('This is no longer waiting for you.', 404)), 'gone');
  assert.equal(outcomeOf(new ApiError('Open it to decide.', 400)), 'open');
  assert.equal(outcomeOf(new ApiError('Add a note.', 422)), 'open');
  assert.equal(outcomeOf(new ApiError('Changed.', 409)), 'open');
  assert.equal(outcomeOf(new ApiError('Not yours.', 403)), 'open');
  assert.equal(outcomeOf(new ApiError('Down.', 503)), 'retry');
  assert.equal(outcomeOf(new AuthError('Offline', 'network')), 'offline', 'approvals never wait for a connection');
  assert.equal(outcomeOf(new AuthError('Busy', 'server')), 'retry');
  assert.equal(outcomeOf(new AuthError('Sign in again', 'expired')), 'open');
  const item = { ...pushApproval({ title: 'PO-0042', data })!, at: 0, tries: 0 };
  assert.deepEqual(afterRetry(item), { ...item, tries: 1 });
  assert.equal(afterRetry({ ...item, tries: MAX_TRIES - 1 }), 'open');
});
