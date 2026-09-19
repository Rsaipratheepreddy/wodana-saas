import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationLinkReference, notificationReference } from '../src/notifications/routing';

const notificationId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';

test('accepts only a scoped notification payload', () => {
  assert.deepEqual(notificationReference({ notificationId, workspaceId }), { notificationId, workspaceId });
  assert.equal(notificationReference({ notificationId: 'not-an-id', workspaceId }), null);
  assert.equal(notificationReference(null), null);
});

test('parses native and universal notification links', () => {
  assert.deepEqual(notificationLinkReference(`wodana://notification/${notificationId}?workspaceId=${workspaceId}`), { notificationId, workspaceId });
  assert.deepEqual(notificationLinkReference(`https://app.wodana.ai/notification/${notificationId}`), { notificationId, workspaceId: undefined });
  assert.equal(notificationLinkReference('wodana://projects/not-a-notification'), null);
});
