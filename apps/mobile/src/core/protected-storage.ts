import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils';
import { openOfflineBytes, openOfflineText, sealOfflineBytes, sealOfflineText } from './offline-envelope';

const keyName = 'wodana.mobile.offline-key.v1';
const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function offlineKey() {
  const saved = await SecureStore.getItemAsync(keyName, keyOptions);
  if (saved) {
    const key = hexToBytes(saved);
    if (key.length !== 32) throw new Error('Offline protection must be reset by signing out.');
    return key;
  }
  const key = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(keyName, bytesToHex(key), keyOptions);
  return key;
}

export async function readProtectedOfflineText(storageKey: string) {
  const saved = await AsyncStorage.getItem(storageKey);
  if (!saved || Platform.OS === 'web' || !saved.startsWith('wd1:')) return saved;
  return openOfflineText(saved, await offlineKey(), storageKey);
}

export async function writeProtectedOfflineText(storageKey: string, value: string) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(storageKey, value);
  const sealed = sealOfflineText(value, await offlineKey(), Crypto.getRandomBytes(24), storageKey);
  return AsyncStorage.setItem(storageKey, sealed);
}

export async function protectOfflineFile(sourceUri: string, destination: File, context: string) {
  const source = new File(sourceUri);
  if (!source.exists) throw new Error('The selected evidence is no longer available. Choose it again.');
  const bytes = await source.bytes();
  destination.create({ overwrite: true, intermediates: true });
  destination.write(sealOfflineBytes(bytes, await offlineKey(), Crypto.getRandomBytes(24), context));
  return destination;
}

const outboxFolder = (itemId: string) => new Directory(Paths.document, 'wodana-outbox', itemId);

/**
 * Keep a photo for a queued capture: copied out of the camera's temporary files and sealed with the
 * device key, so it survives restarts and can't be read outside the app. The browser preview keeps the
 * page's own URL instead.
 */
export async function storeOutboxFile(itemId: string, file: { key: string; uri: string; name: string; type: string }) {
  if (Platform.OS === 'web') return { ...file, encrypted: false };
  const destination = new File(outboxFolder(itemId), `${file.key.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`);
  await protectOfflineFile(file.uri, destination, `${itemId}:${file.key}`);
  return { ...file, uri: destination.uri, encrypted: true };
}

/** A queued photo as a plain file to upload; `cleanup` removes the plain copy afterwards. */
export async function openOutboxFile(itemId: string, file: { key: string; uri: string; name: string; type: string; encrypted?: boolean }) {
  if (!file.encrypted || Platform.OS === 'web') return { file: { uri: file.uri, name: file.name, type: file.type }, cleanup: () => {} };
  const source = new File(file.uri);
  if (!source.exists) throw new Error('The saved photo is no longer on this phone. Take it again.');
  const folder = new Directory(Paths.cache, 'wodana-upload');
  folder.create({ idempotent: true, intermediates: true });
  const plain = new File(folder, `${Crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  plain.create({ overwrite: true, intermediates: true });
  plain.write(openOfflineBytes(await source.bytes(), await offlineKey(), `${itemId}:${file.key}`));
  return {
    file: { uri: plain.uri, name: file.name, type: file.type },
    cleanup: () => { try { if (plain.exists) plain.delete(); } catch { /* the cache is cleared by the system */ } },
  };
}

export function removeOutboxFiles(itemId: string) {
  if (Platform.OS === 'web') return;
  try { const folder = outboxFolder(itemId); if (folder.exists) folder.delete(); } catch { /* nothing to remove */ }
}
