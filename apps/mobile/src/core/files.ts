import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { AuthClient } from '../auth/client';

/**
 * Open a workspace file (a document scan, a delivery note): downloaded with the person's sign-in, then
 * handed to the phone's viewer and share sheet. In the browser it opens in a new tab.
 */
export async function openWorkspaceFile(client: AuthClient, url: string, name: string) {
  const authorization = await client.authorization();
  if (!authorization) throw new Error('Sign in again to open this file.');
  if (Platform.OS === 'web') {
    const response = await fetch(url, { headers: { authorization } });
    if (!response.ok) throw new Error('The file could not be opened.');
    const objectUrl = URL.createObjectURL(await response.blob());
    globalThis.open?.(objectUrl, '_blank');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }
  const folder = new Directory(Paths.cache, 'wodana-files');
  folder.create({ idempotent: true, intermediates: true });
  const file = await File.downloadFileAsync(url, new File(folder, name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file'), { headers: { authorization }, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { dialogTitle: name });
}
