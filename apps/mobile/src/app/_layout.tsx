import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/provider';
import { fontAssets } from '../design-system/fonts';
import { I18nProvider } from '../core/i18n';
import { queryClient } from '../core/query';
import { OrganizationProvider, useOrganization } from '../features/auth/organization';
import { SessionGate } from '../features/auth/session-gate';
import { ThemeProvider, useTheme } from '../ui/theme';
import { ToastProvider } from '../ui/toast';
import '../features/outbox-handlers';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <I18nProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <OrganizationProvider>
            <Branded>{fontsLoaded || fontError ? <Navigation /> : null}</Branded>
          </OrganizationProvider>
        </QueryClientProvider>
      </AuthProvider>
    </I18nProvider>
  </SafeAreaProvider>;
}

/** The theme follows the signed-in workspace's co-branding, or the last workspace used on this phone before sign-in. */
function Branded({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const { remembered } = useOrganization();
  const membership = state.status === 'signedIn' ? state.profile.memberships.find((item) => item.workspaceId === state.workspaceId) : undefined;
  const brand = membership
    ? { primaryColor: membership.workspacePrimaryColor, secondaryColor: membership.workspaceSecondaryColor }
    : remembered ? { primaryColor: remembered.primaryColor, secondaryColor: remembered.secondaryColor } : null;
  return <ThemeProvider brand={brand}><ToastProvider>{children}</ToastProvider></ThemeProvider>;
}

function Navigation() {
  const theme = useTheme();
  const { state } = useAuth();
  const { ready } = useOrganization();
  const settled = ready && state.status !== 'checking';
  useEffect(() => { if (settled) void SplashScreen.hideAsync().catch(() => undefined); }, [settled]);
  if (!settled) return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }} />;
  const signedIn = state.status === 'signedIn';
  return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
    <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
    <SessionGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas }, animation: 'default' }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </SessionGate>
  </View>;
}
