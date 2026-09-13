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

void NativeSplashScreen.preventAutoHideAsync().catch(() => {});

function AppContent() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [screen, setScreen] = useState<'welcome' | 'login'>('welcome');
  const [help, setHelp] = useState(false);
  const { client, state } = useAuth();
  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.status === 'authenticating') return true;
      if (help) { setHelp(false); return true; }
      if (!signedIn && screen === 'login') { setScreen('welcome'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [screen, help, signedIn, state.status]);
  useEffect(() => {
    if (state.status === 'signedOut' && state.message) setScreen('login');
    if (state.status === 'signedIn') { setHelp(false); setScreen('welcome'); }
  }, [state]);
  useEffect(() => {
    if ((fontsLoaded || fontError) && signedIn) NativeSplashScreen.hide();
  }, [fontsLoaded, fontError, signedIn]);
  if (!fontsLoaded && !fontError) return null;
  const signOut = () => { setHelp(false); setScreen('login'); void client.signOut(); };

  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <DesignSystemProvider theme="light" fontsReady={fontsLoaded}>
      {signedIn ? <HomeScreen onSignOut={signOut} />
        : state.status === 'checking' || state.status === 'unavailable'
          ? <SessionScreen message={state.status === 'unavailable' ? state.message : undefined}
            onRetry={() => { void client.restore(); }} onSignOut={signOut} />
          : screen === 'welcome'
            ? <SplashScreen onSignIn={() => setScreen('login')} onJoin={() => setHelp(true)} />
            : <LoginScreen onBack={() => setScreen('welcome')}
              message={state.status === 'signedOut' ? state.message : undefined}
              onSignIn={(email, password) => client.signIn(email, password)}
              onRecovery={(email) => client.requestPasswordReset(email)} />}
      <HelpSheet topic={help ? 'invitation' : null} onClose={() => setHelp(false)}
        onSignIn={() => { setHelp(false); setScreen('login'); }} />
    </DesignSystemProvider>
  </SafeAreaProvider>;
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}
