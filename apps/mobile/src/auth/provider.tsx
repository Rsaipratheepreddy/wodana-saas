import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { AuthClient } from './client';
import { authConfig } from './config';
import { sessionStorage } from './storage';

export const authClient = new AuthClient({ ...authConfig, storage: sessionStorage, credentials: Platform.OS === 'web' ? 'include' : 'omit' });
const AuthContext = createContext<AuthClient>(authClient);
export function AuthProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void authClient.restore();
    let previous = AppState.currentState;
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active' && authClient.getSnapshot().status === 'signedIn') void authClient.restore();
      previous = next;
    });
    return () => listener.remove();
  }, []);
  return <AuthContext.Provider value={authClient}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const client = useContext(AuthContext);
  return { client, state: useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot) };
}
