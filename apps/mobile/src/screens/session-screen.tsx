import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NativeSplashScreen from 'expo-splash-screen';
import { Button, Text } from '../design-system';
import { BrandLogo } from '../components/brand-logo';
import { loginTheme } from '../design-system/login-theme';

export function SessionScreen({ message, onRetry, onSignOut, tenantSlug }: { message?: string; onRetry: () => void; onSignOut: () => void; tenantSlug?: string }) {
  const insets = useSafeAreaInsets();
  return <View testID="session-screen" style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    onLayout={() => NativeSplashScreen.hide()}>
    <BrandLogo width={186} tenantSlug={tenantSlug} />
    {message ? <View style={styles.actions}>
      <Text accessibilityRole="alert" style={styles.message}>{message}</Text>
      <Button variant="brand" label="Try again" onPress={onRetry} />
      <Button variant="brand-secondary" label="Back to sign in" onPress={onSignOut} />
    </View> : <ActivityIndicator color={loginTheme.accent} accessibilityLabel="Checking your session" />}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', gap: 32, backgroundColor: loginTheme.form },
  actions: { width: '100%', maxWidth: 360, gap: 12 },
  message: { color: loginTheme.muted, textAlign: 'center', marginBottom: 12 },
});
