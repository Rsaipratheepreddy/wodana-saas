import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { AuthClient } from './client';
import { authConfig } from './config';
import { profileCache } from './profile-cache';
import { sessionStorage } from './storage';

export const authClient = new AuthClient({ ...authConfig, storage: sessionStorage, profileCache, credentials: Platform.OS === 'web' ? 'include' : 'omit' });
const AuthContext = createContext<AuthClient>(authClient);
export function AuthProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void authClient.restore();
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active' && authClient.getSnapshot().status === 'signedIn') void authClient.restore();
      previous = next;
    });
    // Opened without a connection: verify the saved sign-in as soon as the phone is back online.
    const online = NetInfo.addEventListener((state) => {
      const snapshot = authClient.getSnapshot();
      if (state.isConnected && state.isInternetReachable !== false && snapshot.status === 'signedIn' && snapshot.offline) void authClient.restore();
    });
    return () => { listener.remove(); online(); };
  }, []);
  return <AuthContext.Provider value={authClient}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const client = useContext(AuthContext);
  return { client, state: useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot) };
}
