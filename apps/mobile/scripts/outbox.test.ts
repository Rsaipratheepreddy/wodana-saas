import assert from 'node:assert/strict';
import test from 'node:test';
import { amend, backoff, classify, createItem, due, enqueue, expired, markBlocked, markRetry, markSending, markStep, nextWake, recover, remove, retryNow, OUTBOX_TTL_MS } from '../src/core/outbox-model';

const item = (id: string, createdAt: number, workspaceId = 'ws-1') => createItem<Record<string, unknown>>({ id, kind: 'hrms.attendance', title: 'Check in', workspaceId, payload: { n: id } }, createdAt);

test('an operation is queued once, whatever the retries', () => {
  const first = enqueue([], item('a', 1));
  assert.equal(enqueue(first, item('a', 2)).length, 1);
  assert.equal(enqueue(first, item('b', 2)).length, 2);
});

test('only this workspace\'s due items are sent, oldest first', () => {
  const list = [item('late', 30), item('early', 10), item('other', 5, 'ws-2')];
  assert.deepEqual(due(list, 'ws-1', 100).map((entry) => entry.id), ['early', 'late']);
  const waiting = markRetry(list, 'early', 'offline', 100, () => 0.5);
  assert.deepEqual(due(waiting, 'ws-1', 100).map((entry) => entry.id), ['late']);
  assert.equal(nextWake(waiting, 'ws-1'), 30);
});

test('retries back off exponentially and stop growing at thirty minutes', () => {
  const mid = () => 0.5;
  assert.equal(backoff(1, mid), 15_000);
  assert.equal(backoff(2, mid), 30_000);
  assert.equal(backoff(3, mid), 60_000);
  assert.equal(backoff(20, mid), 30 * 60_000);
  assert.ok(backoff(1, () => 0) < backoff(1, () => 1), 'a little spread so phones do not sync in step');
  const retried = markRetry([item('a', 0)], 'a', 'No connection', 1_000, mid)[0];
  assert.deepEqual([retried.status, retried.attempts, retried.nextAttemptAt, retried.error], ['pending', 1, 16_000, 'No connection']);
});

test('a refusal blocks the item until the person amends or discards it', () => {
  let list = markBlocked([item('a', 0)], 'a', 'Retry the capture or provide an exception reason.', ['Location missing']);
  assert.equal(list[0].status, 'blocked');
  assert.equal(due(list, 'ws-1', 10).length, 0);
  list = amend(list, 'a', { exceptionReason: 'GPS off in the basement' }, 50);
  assert.deepEqual([list[0].status, list[0].payload, list[0].issues, list[0].nextAttemptAt], ['pending', { n: 'a', exceptionReason: 'GPS off in the basement' }, undefined, 50]);
  assert.equal(remove(list, 'a').length, 0);
});

test('steps only move forward, a send interrupted by a restart is retried, and send-now makes it due', () => {
  let list = markStep([item('a', 0)], 'a', 2);
  list = markStep(list, 'a', 1);
  assert.equal(list[0].step, 2);
  list = markSending(list, 'a');
  assert.equal(recover(list)[0].status, 'pending');
  list = markRetry(recover(list), 'a', 'offline', 0, () => 0.5);
  assert.equal(retryNow(list, 'a', 5)[0].nextAttemptAt, 5);
});

test('refusals the person can act on block; connection and server failures retry', () => {
  for (const status of [400, 403, 404, 409, 413, 422]) assert.equal(classify(status), 'blocked', String(status));
  for (const status of [0, null, 408, 429, 500, 502, 503]) assert.equal(classify(status), 'retry', String(status));
  assert.equal(expired(item('a', 0), OUTBOX_TTL_MS + 1), true);
  assert.equal(expired(item('a', 0), OUTBOX_TTL_MS - 1), false);
});
