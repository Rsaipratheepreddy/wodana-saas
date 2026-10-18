import assert from 'node:assert/strict';
import test from 'node:test';
import { OFFLINE_DRAFT_TTL_MS, isOfflineDraftExpired, openOfflineBytes, openOfflineText, sealOfflineBytes, sealOfflineText } from '../src/core/offline-envelope';

const key = new Uint8Array(32).fill(7);
const nonce = new Uint8Array(24).fill(3);

test('offline drafts are authenticated to their queue scope', () => {
  const sealed = sealOfflineText('[{"private":"evidence"}]', key, nonce, 'user:workspace');
  assert.equal(sealed.includes('private'), false);
  assert.equal(openOfflineText(sealed, key, 'user:workspace'), '[{"private":"evidence"}]');
  assert.throws(() => openOfflineText(sealed, key, 'other:workspace'), /verified/);
});

test('offline evidence rejects ciphertext changes', () => {
  const sealed = sealOfflineBytes(new Uint8Array([1, 2, 3]), key, nonce, 'photo-id');
  sealed[sealed.length - 1] ^= 1;
  assert.throws(() => openOfflineBytes(sealed, key, 'photo-id'), /verified/);
});

test('offline drafts expire after seven days', () => {
  const now = 1_000_000_000;
  assert.equal(isOfflineDraftExpired(now - OFFLINE_DRAFT_TTL_MS, now), false);
  assert.equal(isOfflineDraftExpired(now - OFFLINE_DRAFT_TTL_MS - 1, now), true);
  assert.equal(isOfflineDraftExpired(Number.NaN, now), true);
});
