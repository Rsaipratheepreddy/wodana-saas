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
import { HelpSheet } from './src/components/help-sheet';
import { AuthProvider, useAuth } from './src/auth/provider';
import { authConfig } from './src/auth/config';
import { OperationalErrorBoundary } from './src/operational/error-boundary';

void NativeSplashScreen.preventAutoHideAsync().catch(() => {});

function AppContent() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [screen, setScreen] = useState<'welcome' | 'login'>('welcome');
  const [help, setHelp] = useState(false);
  const { client, state } = useAuth();
  const signedIn = state.status === 'signedIn';
  const onboardingPending = signedIn && state.profile.nextAction !== 'enter_workspace';
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.status === 'authenticating') return true;
      if (help) { setHelp(false); return true; }
      if (state.status === 'mfa') { client.cancelMfa(); return true; }
      if (!signedIn && screen === 'login') { setScreen('welcome'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [screen, help, signedIn, state.status, client]);
  useEffect(() => {
    if (state.status === 'signedOut' && state.message) setScreen('login');
    if (state.status === 'signedIn') { setHelp(false); setScreen('welcome'); }
  }, [state]);
  useEffect(() => {
    if (fontsLoaded || fontError) void NativeSplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  const signOut = () => { setHelp(false); setScreen('login'); void client.signOut(); };

  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <DesignSystemProvider theme={signedIn ? 'system' : 'light'} fontsReady={fontsLoaded}>
      <OperationalErrorBoundary>{onboardingPending ? <SessionScreen message="Finish your workspace setup in the browser, then try again here."
          onRetry={() => { void client.restore(); }} onSignOut={signOut} />
        : signedIn ? <HomeScreen onSignOut={signOut} />
        : state.status === 'checking' || state.status === 'unavailable'
          ? <SessionScreen message={state.status === 'unavailable' ? state.message : undefined}
            onRetry={() => { void client.restore(); }} onSignOut={signOut} />
          : screen === 'welcome'
            ? <SplashScreen onSignIn={() => setScreen('login')} onJoin={() => setHelp(true)} />
            : <LoginScreen onBack={() => { if (state.status === 'mfa') client.cancelMfa(); else setScreen('welcome'); }}
              mfaRequired={state.status === 'mfa'} initialTenantSlug={client.tenantSlug} workspaceLocked={Boolean(authConfig.tenantSlug)}
              message={state.status === 'signedOut' ? state.message : undefined}
              onSignIn={(email, password, tenantSlug) => client.signIn(email, password, tenantSlug)}
              onRecovery={(email, tenantSlug) => client.requestPasswordReset(email, tenantSlug)}
              onVerifyMfa={(code) => client.verifyMfa(code)} />}
      <HelpSheet topic={help ? 'invitation' : null} onClose={() => setHelp(false)}
        onSignIn={() => { setHelp(false); setScreen('login'); }} />
      </OperationalErrorBoundary>
    </DesignSystemProvider>
  </SafeAreaProvider>;
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}
