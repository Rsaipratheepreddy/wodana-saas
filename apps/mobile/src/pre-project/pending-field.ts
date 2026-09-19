import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { decodeFieldQueue, mergeFieldQueue, type PendingFieldMedia, type PendingFieldSave } from './field-queue';
import { isOfflineDraftExpired } from '../security/offline-envelope';
import { protectOfflineFile, protectedUploadForm, readProtectedOfflineText, writeProtectedOfflineText } from '../security/protected-offline';

const prefix = 'wodana.pre-project.pending.v1';
const storageKey = (userId: string, workspaceId: string, caseId: string) => `${prefix}:${userId}:${workspaceId}:${caseId}`;
const safePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function readFieldQueue(userId: string, workspaceId: string, caseId: string): Promise<PendingFieldSave[]> {
  const key = storageKey(userId, workspaceId, caseId);
  const rows = decodeFieldQueue(await readProtectedOfflineText(key),{userId,workspaceId,caseId});
  const active = rows.filter(row => !isOfflineDraftExpired(row.createdAt));
  if (active.length !== rows.length) {
    for (const row of rows.filter(candidate => !active.includes(candidate)))
      for (const media of row.media) {
        try { const file = new File(media.localUri); if (file.exists) file.delete(); } catch { /* Expired evidence cleanup is best effort. */ }
      }
    await writeProtectedOfflineText(key, JSON.stringify(active));
  }
  return active;
}

export async function writeFieldQueue(operation: PendingFieldSave) {
  const rows = await readFieldQueue(operation.userId, operation.workspaceId, operation.caseId);
  const next = mergeFieldQueue(rows,operation);
  await writeProtectedOfflineText(storageKey(operation.userId, operation.workspaceId, operation.caseId), JSON.stringify(next));
  return operation;
}

export async function removeFieldQueue(operation: PendingFieldSave) {
  const rows = await readFieldQueue(operation.userId, operation.workspaceId, operation.caseId);
  await writeProtectedOfflineText(storageKey(operation.userId, operation.workspaceId, operation.caseId), JSON.stringify(rows.filter(row => row.id !== operation.id)));
  if (Platform.OS !== 'web') for (const media of operation.media) {
    try { const file = new File(media.localUri); if (file.exists) file.delete(); } catch { /* The server receipt is authoritative; cleanup must not replay the write. */ }
  }
}

export function discardFieldMedia(media: PendingFieldMedia) {
  if (Platform.OS === 'web') return;
  try { const file = new File(media.localUri); if (file.exists) file.delete(); } catch { /* Best-effort cleanup of an unsaved local choice. */ }
}

export async function persistFieldMedia(scope: { userId: string; workspaceId: string; caseId: string; recordId: string }, media: Omit<PendingFieldMedia, 'uploaded'>): Promise<PendingFieldMedia> {
  if (media.byteSize > 20 * 1024 * 1024) throw new Error('Each file must be 20 MB or smaller.');
  if (Platform.OS === 'web') return { ...media, uploaded: false };
  const folder = new Directory(Paths.document, 'pre-project-pending', safePart(scope.userId), safePart(scope.workspaceId), safePart(scope.caseId), safePart(scope.recordId));
  folder.create({ idempotent: true, intermediates: true });
  const destination = new File(folder, `${safePart(media.id)}.wde`);
  const source = new File(media.localUri);
  if (!source.exists) throw new Error('The selected file is no longer available. Choose it again.');
  if (!destination.exists) await protectOfflineFile(source.uri, destination, media.id);
  return { ...media, localUri: destination.uri, byteSize: destination.size, uploaded: false, encrypted: true };
}

export const fieldMediaForm = (media: PendingFieldMedia) => protectedUploadForm({
  uri: media.localUri,
  encrypted: media.encrypted,
  id: media.id,
  name: media.name,
  mimeType: media.mimeType,
  fieldName: 'file',
});
