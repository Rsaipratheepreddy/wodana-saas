import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, TextField } from '../design-system';
import { loginTheme } from '../design-system/login-theme';
import { BrandLogo } from '../components/brand-logo';
import { Icon } from '../components/icon';
import { validateCredentials } from '../auth/validation';
import { AuthError, type OrganizationBranding } from '../auth/client';

export function LoginScreen({ onBack, onSignIn, onRecovery, onVerifyMfa, organization, mfaRequired = false, message }: {
  onBack: () => void;
  onSignIn: (email: string, password: string, tenantSlug: string) => Promise<void>;
  onRecovery: (email: string, tenantSlug: string) => Promise<void>;
  onVerifyMfa: (code: string) => Promise<void>;
  organization: OrganizationBranding;
  mfaRequired?: boolean;
  message?: string;
}) {
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().height < 730;
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const tenantSlug = organization.loginSlug;
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
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
    if (mfaRequired) {
      if (!/^\d{6}$/.test(mfaCode) && !/^[A-Za-z0-9-]{8,32}$/.test(mfaCode)) {
        setStatus('Enter your six-digit authenticator code or a recovery code.');
        return;
      }
      submitting.current = true;
      setPending(true);
      Keyboard.dismiss();
      try { await onVerifyMfa(mfaCode); }
      catch (error) {
        if (!(error instanceof AuthError) || error.code !== 'cancelled') {
          setStatus(error instanceof AuthError ? error.message : 'Unable to verify your code. Please try again.');
        }
      } finally { submitting.current = false; setPending(false); }
      return;
    }
    const nextErrors = validateCredentials(email, password);
    setErrors(nextErrors);
    setStatus('');
    if (nextErrors.email) return emailRef.current?.focus();
    if (nextErrors.password) return passwordRef.current?.focus();
    submitting.current = true;
    setPending(true);
    Keyboard.dismiss();
    try { await onSignIn(email, password, tenantSlug); }
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
      await onRecovery(email, tenantSlug);
      setStatus('If your account exists, a reset has been requested. Contact your administrator for the reset link.');
    } catch (error) {
      setStatus(error instanceof AuthError ? error.message : 'Unable to request a reset. Please try again.');
    } finally { submitting.current = false; setRecovering(false); }
  };

  return <View testID="login-screen" style={styles.screen}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}
        contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
        <View style={[styles.nav, { paddingTop: insets.top + 24 }]}>
          <BrandLogo width={150} tenantSlug={tenantSlug} logoUri={organization.logoUrl} displayName={organization.displayName} />
          <Pressable accessibilityLabel="Change organization" accessibilityRole="button" onPress={onBack} disabled={busy}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="arrow-left" />
          </Pressable>
        </View>

        <View style={[styles.body, compact && styles.bodyCompact]}>
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={styles.heading}>{mfaRequired ? 'Verify it’s you' : 'Welcome back'}</Text>
            <Text style={styles.subtitle}>{mfaRequired
              ? 'Use your authenticator app or one of your saved recovery codes.'
              : `Sign in to ${organization.displayName}.`}</Text>
          </View>

          <View style={styles.form}>
            {mfaRequired ? <TextField label="Authenticator or recovery code" variant="login" placeholder="Enter your code" value={mfaCode}
              editable={!busy} autoComplete="one-time-code" keyboardType="default" autoCapitalize="characters" autoCorrect={false}
              returnKeyType="go" onSubmitEditing={submit}
              onChangeText={(value) => { setMfaCode(value); setStatus(''); }} /> : <>
            <TextField label="Email *" variant="login" placeholder="you@company.com" value={email}
              editable={!busy}
              leading={<Icon name="mail" size={20} color={loginTheme.muted} />}
              inputRef={emailRef} error={errors.email} keyboardType="email-address" autoComplete="email"
              textContentType="username" autoCapitalize="none" autoCorrect={false}
              returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()}
              onChangeText={(value) => { setEmail(value); setErrors((prev) => ({ ...prev, email: '' })); setStatus(''); }} />
            <TextField label="Password *" variant="login" placeholder="Enter your password" value={password}
              editable={!busy}
              leading={<Icon name="lock" size={20} color={loginTheme.muted} />}
              labelAction={<Pressable accessibilityRole="button" onPress={recover} disabled={busy} style={styles.recovery}>
                <Text style={styles.recoveryText}>{recovering ? 'Requesting reset…' : 'Forgot password?'}</Text>
              </Pressable>}
              inputRef={passwordRef} error={errors.password} secureTextEntry={!showPassword}
              autoComplete="current-password" textContentType="password" autoCapitalize="none" autoCorrect={false}
              returnKeyType="go" onSubmitEditing={submit}
              onChangeText={(value) => { setPassword(value); setErrors((prev) => ({ ...prev, password: '' })); setStatus(''); }}
              trailing={<Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                accessibilityState={{ checked: showPassword }} disabled={busy} onPress={() => setShowPassword((value) => !value)} style={styles.passwordToggle}>
                <Icon name={showPassword ? 'eye-off' : 'eye'} color={loginTheme.muted} size={18} />
              </Pressable>} />
            </>}
            <Button label={pending ? (mfaRequired ? 'Verifying…' : 'Signing in…') : (mfaRequired ? 'Verify and sign in' : 'Sign in')}
              variant="brand" pill onPress={submit} loading={pending} disabled={recovering} style={styles.submit} />
            {!!status && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" size="sm" style={styles.status}>{status}</Text>}
          </View>
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.support}>Need access? Ask your administrator.</Text>
        </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: loginTheme.form },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center' },
  card: { flexGrow: 1, backgroundColor: loginTheme.form, overflow: 'hidden' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 56, paddingBottom: 36, gap: 36 },
  bodyCompact: { paddingTop: 28, paddingBottom: 20, gap: 26 },
  intro: { alignItems: 'center', gap: 12 },
  heading: { fontSize: 34, lineHeight: 40, letterSpacing: -1.4, color: loginTheme.ink, fontWeight: '400', textAlign: 'center' },
  subtitle: { maxWidth: 310, color: loginTheme.muted, fontSize: 14, lineHeight: 23, textAlign: 'center' },
  form: { gap: loginTheme.formGap },
  passwordToggle: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  recovery: { minHeight: 28, justifyContent: 'center' },
  recoveryText: { color: loginTheme.accent, fontSize: 12, lineHeight: 18, textDecorationLine: 'underline' },
  submit: { marginTop: 2 },
  status: { color: loginTheme.muted, textAlign: 'center', lineHeight: 19 },
  footer: { alignItems: 'center', paddingHorizontal: 24 },
  support: { color: loginTheme.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
