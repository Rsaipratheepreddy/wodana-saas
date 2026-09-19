import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { isOfflineDraftExpired } from '../security/offline-envelope';
import { protectOfflineFile, protectedUploadForm, readProtectedOfflineText, writeProtectedOfflineText } from '../security/protected-offline';
import {
  decodeProjectFieldQueue,
  mergeProjectFieldQueue,
  type PendingProjectFieldOperation,
  type ProjectFieldMedia,
} from './field-queue';

const prefix = 'wodana.projects.field.pending.v1';
const storageKey = (userId: string, workspaceId: string) =>
  `${prefix}:${userId}:${workspaceId}`;
const safePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function readProjectFieldQueue(userId: string, workspaceId: string) {
  const key = storageKey(userId, workspaceId);
  const rows = decodeProjectFieldQueue(
    await readProtectedOfflineText(key),
    { userId, workspaceId },
  );
  const active = rows.filter((row) => !isOfflineDraftExpired(row.createdAt));
  if (active.length !== rows.length) {
    for (const row of rows.filter((candidate) => !active.includes(candidate)))
      for (const media of row.media) {
        try { const file = new File(media.localUri); if (file.exists) file.delete(); } catch { /* Expired evidence cleanup is best effort. */ }
      }
    await writeProtectedOfflineText(key, JSON.stringify(active));
  }
  return active;
}

export async function writeProjectFieldQueue(operation: PendingProjectFieldOperation) {
  const rows = await readProjectFieldQueue(operation.userId, operation.workspaceId);
  await writeProtectedOfflineText(
    storageKey(operation.userId, operation.workspaceId),
    JSON.stringify(mergeProjectFieldQueue(rows, operation)),
  );
  return operation;
}

export async function removeProjectFieldQueue(operation: PendingProjectFieldOperation) {
  const rows = await readProjectFieldQueue(operation.userId, operation.workspaceId);
  await writeProtectedOfflineText(
    storageKey(operation.userId, operation.workspaceId),
    JSON.stringify(rows.filter((row) => row.id !== operation.id)),
  );
  if (Platform.OS !== 'web')
    for (const media of operation.media) {
      try {
        const file = new File(media.localUri);
        if (file.exists) file.delete();
      } catch {
        // The server receipt is authoritative; cleanup must not replay a write.
      }
    }
}

export async function persistProjectFieldMedia(
  scope: { userId: string; workspaceId: string; projectId: string; operationId: string },
  media: Omit<ProjectFieldMedia, 'uploaded'>,
): Promise<ProjectFieldMedia> {
  if (media.byteSize > 10 * 1024 * 1024)
    throw new Error('Each project photo must be 10 MB or smaller.');
  if (Platform.OS === 'web') return { ...media, uploaded: false };
  const folder = new Directory(
    Paths.document,
    'project-field-pending',
    safePart(scope.userId),
    safePart(scope.workspaceId),
    safePart(scope.projectId),
    safePart(scope.operationId),
  );
  folder.create({ idempotent: true, intermediates: true });
  const destination = new File(folder, `${safePart(media.id)}.wde`);
  const source = new File(media.localUri);
  if (!source.exists)
    throw new Error('The captured photo is no longer available. Take it again.');
  if (!destination.exists) await protectOfflineFile(source.uri, destination, media.id);
  return {
    ...media,
    localUri: destination.uri,
    byteSize: destination.size,
    uploaded: false,
    encrypted: true,
  };
}

export const projectFieldMediaForm = (media: ProjectFieldMedia) => protectedUploadForm({
  uri: media.localUri,
  encrypted: media.encrypted,
  id: media.id,
  name: media.name,
  mimeType: media.mimeType,
  fieldName: 'file',
});
