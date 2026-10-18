import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import NetInfo, { useNetInfo } from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import { ApiError, AuthError } from '../auth/client';

/** Lists stay fresh for half a minute and refresh when the app comes back to the front or back online. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // A refusal (no access, not found, invalid) won't change on retry; a dropped connection might.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && !(error instanceof AuthError && error.code !== 'network') && count < 2,
      networkMode: 'offlineFirst',
    },
    mutations: { retry: false, networkMode: 'always' },
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
}
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(!!state.isConnected && state.isInternetReachable !== false)));

/** Whether the phone has a connection right now (true until known otherwise). */
export function useOnline() {
  const state = useNetInfo();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
