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

export async function protectedUploadForm(input: {
  uri: string;
  encrypted?: boolean;
  id: string;
  name: string;
  mimeType: string;
  fieldName: string;
}) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(input.uri)).blob();
    form.append(input.fieldName, blob, input.name);
    return { form, cleanup: () => {} };
  }
  let uploadUri = input.uri;
  let temporary: File | null = null;
  if (input.encrypted) {
    const source = new File(input.uri);
    if (!source.exists) throw new Error('The protected evidence is no longer available. Capture it again.');
    const folder = new Directory(Paths.cache, 'wodana-protected-upload');
    folder.create({ idempotent: true, intermediates: true });
    temporary = new File(folder, `${Crypto.randomUUID()}-${input.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    temporary.create({ overwrite: true, intermediates: true });
    temporary.write(openOfflineBytes(await source.bytes(), await offlineKey(), input.id));
    uploadUri = temporary.uri;
  }
  form.append(input.fieldName, {
    uri: uploadUri,
    name: input.name,
    type: input.mimeType,
  } as unknown as Blob);
  return {
    form,
    cleanup: () => {
      try { if (temporary?.exists) temporary.delete(); } catch { /* Temporary decrypted bytes expire with the cache if cleanup is interrupted. */ }
    },
  };
}
