import AsyncStorage from '@react-native-async-storage/async-storage';
import { readProtectedOfflineText, writeProtectedOfflineText } from '../core/protected-storage';
import type { SessionStorage } from './client';

const key = 'wodana.mobile.profile.v1';

/**
 * The last verified profile (name, memberships, permissions), sealed with the device key like queued
 * captures, so the app opens without a connection. Cleared on sign-out; never holds a token.
 */
export const profileCache: SessionStorage = {
  read: () => readProtectedOfflineText(key),
  write: (value) => writeProtectedOfflineText(key, value),
  clear: () => AsyncStorage.removeItem(key),
};
