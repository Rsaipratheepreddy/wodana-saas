import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFonts } from 'expo-font';
import * as NativeSplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { DesignSystemProvider } from './src/design-system';
import { fontAssets } from './src/design-system/fonts';
import { SplashScreen } from './src/screens/splash-screen';
import { LoginScreen } from './src/screens/login-screen';
import { HomeScreen } from './src/screens/home-screen';
import { SessionScreen } from './src/screens/session-screen';
import { AuthProvider, useAuth } from './src/auth/provider';
import type { OrganizationBranding } from './src/auth/client';
import { organizationStorage } from './src/auth/organization-storage';
import { OperationalErrorBoundary } from './src/operational/error-boundary';

void NativeSplashScreen.preventAutoHideAsync().catch(() => {});

function AppContent() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [screen, setScreen] = useState<'welcome' | 'login'>('welcome');
  const [organization, setOrganization] = useState<OrganizationBranding | null>(null);
  const [organizationReady, setOrganizationReady] = useState(false);
  const { client, state } = useAuth();
  const signedIn = state.status === 'signedIn';
  const onboardingPending = signedIn && state.profile.nextAction !== 'enter_workspace';
  useEffect(() => {
    let mounted = true;
    void organizationStorage.read().then((saved) => {
      if (!mounted) return;
      if (saved) { setOrganization(saved); setScreen('login'); }
    }).catch(() => {}).finally(() => { if (mounted) setOrganizationReady(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.status === 'authenticating') return true;
      if (state.status === 'mfa') { client.cancelMfa(); return true; }
      if (!signedIn && screen === 'login') {
        setOrganization(null); setScreen('welcome'); void organizationStorage.clear(); return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [screen, signedIn, state.status, client]);
  useEffect(() => {
    if (state.status === 'signedOut' && state.message && organization) setScreen('login');
    if (state.status === 'signedIn') setScreen('welcome');
  }, [state]);
  useEffect(() => {
    if (fontsLoaded || fontError) void NativeSplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  const signOut = () => { setScreen(organization ? 'login' : 'welcome'); void client.signOut(); };

  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <DesignSystemProvider theme={signedIn ? 'system' : 'light'} fontsReady={fontsLoaded}>
      <OperationalErrorBoundary>{onboardingPending ? <SessionScreen tenantSlug={client.tenantSlug} message="Finish your workspace setup in the browser, then try again here."
          onRetry={() => { void client.restore(); }} onSignOut={signOut} />
        : signedIn ? <HomeScreen onSignOut={signOut} />
        : state.status === 'checking' || state.status === 'unavailable' || !organizationReady
          ? <SessionScreen tenantSlug={client.tenantSlug} message={state.status === 'unavailable' ? state.message : undefined}
            onRetry={() => { void client.restore(); }} onSignOut={signOut} />
          : screen === 'welcome' || !organization
              ? <SplashScreen onContinue={async (identifier) => {
                const resolved = await client.resolveOrganization(identifier);
                await organizationStorage.write(resolved);
                setOrganization(resolved);
                setScreen('login');
              }} />
            : <LoginScreen organization={organization}
              onBack={() => {
                if (state.status === 'mfa') client.cancelMfa();
                setOrganization(null); setScreen('welcome'); void organizationStorage.clear();
              }}
              mfaRequired={state.status === 'mfa'}
              message={state.status === 'signedOut' ? state.message : undefined}
              onSignIn={(email, password, tenantSlug) => client.signIn(email, password, tenantSlug)}
              onRecovery={(email, tenantSlug) => client.requestPasswordReset(email, tenantSlug)}
              onVerifyMfa={(code) => client.verifyMfa(code)} />}
      </OperationalErrorBoundary>
    </DesignSystemProvider>
  </SafeAreaProvider>;
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}
