import * as SecureStore from 'expo-secure-store';
import type { PortalStorage } from './client';

/** The client's portal and session token, in the phone's keychain / keystore (never in plain app storage). */
const key = 'wodana.mobile.client-portal.v1';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const portalStorage: PortalStorage = {
  read: () => SecureStore.getItemAsync(key, options),
  write: (value) => SecureStore.setItemAsync(key, value, options),
  clear: () => SecureStore.deleteItemAsync(key, options),
};
