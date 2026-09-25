import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, TextField } from '../design-system';
import { loginTheme } from '../design-system/login-theme';
import { BrandLogo } from '../components/brand-logo';
import { AuthError } from '../auth/client';

/** A single organization lookup keeps the mobile entry flow independent of any tenant. */
export function SplashScreen({ onContinue }: { onContinue: (identifier: string) => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current) return;
    const value = identifier.trim();
    if (value.length < 2) { setError('Enter your organization name, slug, or ID.'); return; }
    submitting.current = true;
    setPending(true);
    setError('');
    Keyboard.dismiss();
    try { await onContinue(value); }
    catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'Unable to find your organization. Try again.');
    } finally { submitting.current = false; setPending(false); }
  };

  return <View testID="organization-screen" style={styles.screen}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.brand}><BrandLogo width={146} /></View>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={styles.title}>Find your workspace</Text>
          <Text style={styles.subtitle}>Enter your organization name, slug, or ID to continue.</Text>
          <View style={styles.form}>
            <TextField label="Organization" variant="login" placeholder="Organization name, slug, or ID"
              value={identifier} editable={!pending} error={error} autoCapitalize="none" autoCorrect={false}
              returnKeyType="go" onSubmitEditing={submit}
              onChangeText={(value) => { setIdentifier(value); setError(''); }} />
            <Button label={pending ? 'Finding workspace…' : 'Continue'} variant="brand" pill loading={pending} onPress={submit} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: loginTheme.form },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 28 },
  brand: { alignItems: 'flex-start' },
  body: { flexGrow: 1, justifyContent: 'center', paddingBottom: 100, gap: 14 },
  title: { color: loginTheme.ink, fontSize: 32, lineHeight: 40, fontWeight: '500', letterSpacing: -1.1 },
  subtitle: { color: loginTheme.muted, fontSize: 15, lineHeight: 23 },
  form: { gap: 18, marginTop: 24 },
});
