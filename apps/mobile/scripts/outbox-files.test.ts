import assert from 'node:assert/strict';
import test from 'node:test';
import { blobToDataUrl, keepWebFile, keptFileId, openWebFile, PHOTO_GONE, PHOTO_UNREADABLE, removeWebFiles, type BlobStore } from '../src/core/outbox-files';
import { OutboxFileError } from '../src/core/outbox-model';

function memoryStore(): BlobStore & { blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>();
  return {
    blobs,
    put: async (id, blob) => { blobs.set(id, blob); },
    get: async (id) => blobs.get(id) ?? null,
    remove: async (prefix) => { for (const id of [...blobs.keys()]) if (id.startsWith(prefix)) blobs.delete(id); },
  };
}
const picked = { key: 'photo-1', uri: 'blob:http://localhost:8082/4f1c', name: 'photo-1.jpg', type: 'image/jpeg' };
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const dead = async () => { throw new TypeError('Failed to fetch'); };
const isGone = (error: unknown) => error instanceof OutboxFileError && error.message === PHOTO_GONE;

test('a photo picked in the browser is read as soon as it is queued and kept until it is sent', async () => {
  const store = memoryStore();
  const reads: string[] = [];
  const kept = await keepWebFile('item-1', picked, { store, fetchBlob: async (uri) => { reads.push(uri); return jpeg(); } });
  assert.deepEqual(reads, [picked.uri]);
  assert.equal(kept.uri, keptFileId('item-1', 'photo-1'));
  assert.equal(kept.encrypted, false);
  assert.equal(store.blobs.size, 1);
  // Sending later, after the page's blob: URL is long gone, opens the kept bytes as a fresh URL and releases it afterwards.
  const revoked: string[] = [];
  const opened = await openWebFile(kept, { store, fetchBlob: dead, createUrl: () => 'blob:http://localhost:8082/fresh', revokeUrl: (url) => { revoked.push(url); } });
  assert.deepEqual(opened.file, { uri: 'blob:http://localhost:8082/fresh', name: 'photo-1.jpg', type: 'image/jpeg' });
  opened.cleanup();
  assert.deepEqual(revoked, ['blob:http://localhost:8082/fresh']);
  await removeWebFiles('item-1', { store });
  assert.equal(store.blobs.size, 0);
});

test('a browser photo that cannot be read when queued is refused with a reason instead of being queued', async () => {
  await assert.rejects(keepWebFile('item-1', picked, { store: memoryStore(), fetchBlob: dead }),
    (error: unknown) => error instanceof OutboxFileError && error.message === PHOTO_UNREADABLE);
});

test('without IndexedDB the bytes travel inline, so a reload keeps them', async () => {
  const kept = await keepWebFile('item-1', picked, { store: null, fetchBlob: async () => jpeg() });
  assert.equal(kept.uri, 'data:image/jpeg;base64,/9j/4A==');
  assert.equal(await blobToDataUrl(jpeg()), kept.uri);
  const opened = await openWebFile(kept, { store: null, fetchBlob: async (uri) => { assert.equal(uri, kept.uri); return jpeg(); }, createUrl: () => 'blob:fresh', revokeUrl: () => {} });
  assert.equal(opened.file.uri, 'blob:fresh');
  // A store that refuses (no room) falls back the same way.
  const full = { ...memoryStore(), put: async () => { throw new DOMException('QuotaExceededError'); } };
  assert.equal((await keepWebFile('item-1', picked, { store: full, fetchBlob: async () => jpeg() })).uri, kept.uri);
});

test('a photo the browser has lost blocks the item with a reason, rather than failing to fetch for ever', async () => {
  const store = memoryStore();
  // Kept, then dropped by the browser (site data cleared).
  await assert.rejects(openWebFile({ ...picked, uri: keptFileId('item-1', 'photo-1'), encrypted: false }, { store }), isGone);
  // Queued by an earlier version with the page's own blob: URL, which the page no longer has.
  await assert.rejects(openWebFile({ ...picked, encrypted: false }, { store, fetchBlob: dead }), isGone);
});

test('a photo that is not the page’s own (an http URL) is kept and opened as it is', async () => {
  const file = { ...picked, uri: 'https://files.example/photo.jpg' };
  const kept = await keepWebFile('item-1', file, { store: memoryStore(), fetchBlob: dead });
  assert.equal(kept.uri, file.uri);
  const opened = await openWebFile(kept, { store: null, fetchBlob: dead });
  assert.equal(opened.file.uri, file.uri);
});
