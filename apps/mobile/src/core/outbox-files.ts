import { key } from './i18n';
import { OutboxFileError, type OutboxFile } from './outbox-model';

/**
 * Queued photos in the browser preview. A picked photo arrives as a `blob:` URL that dies with the page (a reload,
 * a revoked object URL), so its bytes are read the moment it is queued and kept in IndexedDB until the item is
 * sent; the queue stores a reference. Without IndexedDB the bytes travel inline as a data URL. The phone's own
 * copy (files sealed in the app's documents) lives in `protected-storage.ts`. Pure, so node tests cover it.
 */
export type OpenedFile = { file: { uri: string; name: string; type: string }; cleanup: () => void };

/** Where the browser keeps the bytes of queued photos: IndexedDB in the app, a Map in tests. */
export type BlobStore = {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  /** Forget every blob whose id starts with `prefix`. */
  remove(prefix: string): Promise<void>;
};

export type WebFileIo = {
  /** Null where the browser has no IndexedDB: the bytes are then kept inline. */
  store: BlobStore | null;
  fetchBlob?: (uri: string) => Promise<Blob>;
  toDataUrl?: (blob: Blob) => Promise<string>;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
};

export const PHOTO_GONE = key('The photo saved for this is no longer on this device. Take it again.');
export const PHOTO_UNREADABLE = key('The photo could not be saved for sending. Choose it again.');

const KEPT = 'outbox-file:';
/** A URL that lives only as long as the page that made it (`blob:`), or carries its bytes itself (`data:`). */
export const isPageUri = (uri: string) => /^(blob|data):/i.test(uri);
export const keptFileId = (itemId: string, fileKey: string) => `${KEPT}${itemId}/${fileKey}`;
const isKept = (uri: string) => uri.startsWith(KEPT);

const fetchBlob = async (uri: string) => {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`The photo could not be read (${response.status}).`);
  return response.blob();
};

/** The blob's bytes as a data URL, without FileReader (so the same code runs in node). */
export async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Read a photo picked in the browser now and keep its bytes until the item is sent. */
export async function keepWebFile(itemId: string, file: Omit<OutboxFile, 'encrypted'>, io: WebFileIo): Promise<OutboxFile> {
  if (!isPageUri(file.uri)) return { ...file, encrypted: false };
  let blob: Blob;
  try { blob = await (io.fetchBlob ?? fetchBlob)(file.uri); } catch { throw new OutboxFileError(PHOTO_UNREADABLE); }
  if (io.store) {
    const id = keptFileId(itemId, file.key);
    try { await io.store.put(id, blob); return { ...file, uri: id, encrypted: false }; }
    catch { /* No room, or IndexedDB refused: the bytes go inline below. */ }
  }
  return { ...file, uri: await (io.toDataUrl ?? blobToDataUrl)(blob), encrypted: false };
}

/**
 * A kept photo as a fresh object URL for one send; `cleanup` releases it. A photo the browser has lost (dropped
 * from IndexedDB, or a `blob:` URL queued by an earlier version that no longer resolves) blocks the item.
 */
export async function openWebFile(file: OutboxFile, io: WebFileIo): Promise<OpenedFile> {
  const createUrl = io.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl = io.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  let blob: Blob | null = null;
  if (isKept(file.uri)) blob = io.store ? await io.store.get(file.uri).catch(() => null) : null;
  else if (isPageUri(file.uri)) blob = await (io.fetchBlob ?? fetchBlob)(file.uri).catch(() => null);
  else return { file: { uri: file.uri, name: file.name, type: file.type }, cleanup: () => {} };
  if (!blob) throw new OutboxFileError(PHOTO_GONE);
  const url = createUrl(blob);
  return { file: { uri: url, name: file.name, type: file.type }, cleanup: () => revokeUrl(url) };
}

export const removeWebFiles = (itemId: string, io: WebFileIo) => io.store?.remove(`${KEPT}${itemId}/`) ?? Promise.resolve();

/** The browser's IndexedDB as the blob store; null where there is none. */
export function indexedDbStore(name = 'wodana-outbox'): BlobStore | null {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return null;
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('files'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(request.error ?? new Error('IndexedDB is unavailable.')); };
      request.onblocked = () => { opening = null; reject(new Error('IndexedDB is blocked.')); };
    });
    return opening;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (files: IDBObjectStore) => IDBRequest<T>) => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const request = work(database.transaction('files', mode).objectStore('files'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'));
    });
  };
  return {
    put: async (id, blob) => { await run('readwrite', (files) => files.put(blob, id)); },
    get: async (id) => (await run<Blob | undefined>('readonly', (files) => files.get(id))) ?? null,
    remove: async (prefix) => {
      const ids = await run<IDBValidKey[]>('readonly', (files) => files.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
      for (const id of ids) await run('readwrite', (files) => files.delete(id));
    },
  };
}
