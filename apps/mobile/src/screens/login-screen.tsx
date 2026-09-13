import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, TextField } from '../design-system';
import { loginTheme } from '../design-system/login-theme';
import { BrandBackdrop } from '../components/brand-backdrop';
import { BrandLogo } from '../components/brand-logo';
import { Icon } from '../components/icon';
import { GoogleIcon } from '../components/google-icon';
import { validateCredentials } from '../auth/validation';
import { AuthError } from '../auth/client';

export function LoginScreen({ onBack, onSignIn, onRecovery, message }: {
  onBack: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
  onRecovery: (email: string) => Promise<void>;
  message?: string;
}) {
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().height < 700;
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [status, setStatus] = useState(message ?? '');
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const submitting = useRef(false);
  const busy = pending || recovering;
  useEffect(() => { if (message) setStatus(message); }, [message]);

  const submit = async () => {
    if (submitting.current) return;
    const nextErrors = validateCredentials(email, password);
    setErrors(nextErrors);
    setStatus('');
    if (nextErrors.email) return emailRef.current?.focus();
    if (nextErrors.password) return passwordRef.current?.focus();
    submitting.current = true;
    setPending(true);
    Keyboard.dismiss();
    try { await onSignIn(email, password); }
    catch (error) {
      if (!(error instanceof AuthError) || error.code !== 'cancelled') {
        setStatus(error instanceof AuthError ? error.message : 'Unable to sign in. Please try again.');
      }
    } finally { submitting.current = false; setPending(false); }
  };
  const recover = async () => {
    if (submitting.current) return;
    const emailError = validateCredentials(email, '').email;
    if (emailError) { setErrors((prev) => ({ ...prev, email: emailError })); emailRef.current?.focus(); return; }
    submitting.current = true;
    setRecovering(true);
    setStatus('');
    Keyboard.dismiss();
    try {
      await onRecovery(email);
      setStatus('If your account exists, a reset has been requested. Contact your administrator for the reset link.');
    } catch (error) {
      setStatus(error instanceof AuthError ? error.message : 'Unable to request a reset. Please try again.');
    } finally { submitting.current = false; setRecovering(false); }
  };

  return <View testID="login-screen" style={styles.screen}>
    <StatusBar style="dark" />
    <BrandBackdrop />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 20) + 16 }]}>
        <View style={styles.nav}>
          <View style={styles.headerLogo}><BrandLogo width={124} /></View>
          <Pressable accessibilityLabel="Back to welcome" accessibilityRole="button" onPress={onBack} disabled={busy}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="arrow-left" />
          </Pressable>
        </View>

        <View style={[styles.body, compact && styles.bodyCompact]}>
          <Text accessibilityRole="header" weight="semibold" style={styles.heading}>Sign in</Text>

          <View style={styles.form}>
            <TextField label="Work email" variant="login" placeholder="you@company.com" value={email}
              editable={!busy}
              inputRef={emailRef} error={errors.email} keyboardType="email-address" autoComplete="email"
              textContentType="username" autoCapitalize="none" autoCorrect={false}
              returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()}
              onChangeText={(value) => { setEmail(value); setErrors((prev) => ({ ...prev, email: '' })); setStatus(''); }} />
            <TextField label="Password" variant="login" placeholder="Enter your password" value={password}
              editable={!busy}
              inputRef={passwordRef} error={errors.password} secureTextEntry={!showPassword}
              autoComplete="current-password" textContentType="password" autoCapitalize="none" autoCorrect={false}
              returnKeyType="go" onSubmitEditing={submit}
              onChangeText={(value) => { setPassword(value); setErrors((prev) => ({ ...prev, password: '' })); setStatus(''); }}
              trailing={<Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                accessibilityState={{ checked: showPassword }} disabled={busy} onPress={() => setShowPassword((value) => !value)} style={styles.passwordToggle}>
                <Icon name={showPassword ? 'eye-off' : 'eye'} color={loginTheme.muted} size={18} />
              </Pressable>} />
            <Pressable accessibilityRole="button" onPress={recover} disabled={busy} style={styles.recovery}>
              <Text size="sm" style={styles.recoveryText}>{recovering ? 'Requesting reset…' : 'Forgot password?'}</Text>
            </Pressable>
            <Button label={pending ? 'Signing in…' : 'Sign in'} variant="brand" onPress={submit} loading={pending} disabled={recovering}
              endIcon={<Icon name="arrow-up-right" size={16} />} />
            {!!status && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" size="sm" style={styles.status}>{status}</Text>}
          </View>
          <View style={styles.sso}>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text size="2xs" weight="semibold" style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>
            <Button label="Google Workspace · coming soon" variant="brand-secondary" disabled
              startIcon={<GoogleIcon />} accessibilityHint="Single sign-on is not available yet." />
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: loginTheme.canvas },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 416, alignSelf: 'center', paddingHorizontal: 28 },
  nav: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
  back: { width: 44, height: 44, marginStart: -12, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', paddingTop: 32, paddingBottom: 160, gap: 24 },
  bodyCompact: { paddingTop: 16, paddingBottom: 16, gap: 20 },
  heading: { fontSize: 24, lineHeight: 29, letterSpacing: -0.7, color: loginTheme.ink },
  form: { gap: loginTheme.formGap },
  passwordToggle: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  recovery: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginVertical: -10 },
  recoveryText: { color: loginTheme.accent, lineHeight: 19 },
  status: { color: loginTheme.muted, textAlign: 'center', lineHeight: 19 },
  sso: { gap: 22 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: loginTheme.line },
  dividerText: { color: loginTheme.muted, lineHeight: 16 },
});
