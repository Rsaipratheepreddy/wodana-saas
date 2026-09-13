import * as SecureStore from 'expo-secure-store';
import type { SessionStorage } from './client';

const key = 'wodana.mobile.refresh.v1';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const sessionStorage: SessionStorage = {
  read: () => SecureStore.getItemAsync(key, options),
  write: (value) => SecureStore.setItemAsync(key, value, options),
  clear: () => SecureStore.deleteItemAsync(key, options),
};
