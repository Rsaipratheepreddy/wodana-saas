import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, MonitorSmartphone } from 'lucide-react-native';
import { AuthError, DeviceLimitError, type DeviceSession, type WorkspaceChoice } from '../../auth/client';
import { useAuth } from '../../auth/provider';
import { validateCredentials } from '../../auth/validation';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { BrandLogo } from '../../ui/brand';
import { TextField } from '../../ui/fields';
import { ListRow, Section } from '../../ui/layout';
import { Avatar, Button, IconButton, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { useOrganization } from './organization';

/** The public sign-in frame: the workspace's logo at the top, one question in the middle, one action. */
export function AuthFrame({ heading, subtitle, children, onBack, footer, logo }: { heading: string; subtitle?: string; children: ReactNode; onBack?: () => void; footer?: ReactNode; logo: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().height < 730;
  return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}
        contentContainerStyle={{ flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: theme.space(7), paddingTop: insets.top + theme.space(6), paddingBottom: insets.bottom + theme.space(6) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          {logo}
          {onBack ? <IconButton icon={ArrowLeft} directional label={t('Back')} onPress={onBack} /> : null}
        </View>
        <View style={{ flexGrow: 1, justifyContent: 'center', paddingVertical: theme.space(compact ? 7 : 14), gap: theme.space(compact ? 6 : 9) }}>
          <View style={{ alignItems: 'center', gap: theme.space(3) }}>
            <Text accessibilityRole="header" style={{ fontFamily: theme.font.regular, fontSize: 34, lineHeight: 40, letterSpacing: -1.2, textAlign: 'center', color: theme.colors.text }}>{heading}</Text>
            {subtitle ? <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 310, fontSize: theme.size.md, lineHeight: 22 }}>{subtitle}</Text> : null}
          </View>
          <View style={{ gap: theme.space(5) }}>{children}</View>
        </View>
        {footer ? <View style={{ alignItems: 'center', gap: theme.space(2) }}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const Status = ({ text }: { text: string }) => (text ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" variant="caption" tone="secondary" style={{ textAlign: 'center' }}>{text}</Text> : null);

/** The workspace's own logo when this phone knows it; Wodana's otherwise. */
function WorkspaceLogo() {
  const { remembered } = useOrganization();
  return <BrandLogo logoUrl={remembered?.logoUrl} name={remembered?.displayName} />;
}

/** "Powered by Wodana", small, under a tenant-branded sign-in. */
function PoweredBy() {
  const t = useT();
  const { remembered } = useOrganization();
  return remembered ? <Text variant="caption" tone="tertiary" style={{ textAlign: 'center', fontSize: 11 }}>{t('Powered by Wodana')}</Text> : null;
}

/**
 * Sign in with email and password. The account decides the workspace: one signs straight in, several
 * offer a choice. The last workspace used on this phone brands the screen and fills in the email.
 */
export function SignInScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { client, state } = useAuth();
  const { remembered, forget, choosing, chooseWorkspace } = useOrganization();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState(remembered?.email ?? '');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [status, setStatus] = useState(state.status === 'signedOut' && state.message ? t(state.message) : '');
  const [pending, setPending] = useState(false);
  const [choices, setChoices] = useState<WorkspaceChoice[] | null>(null);
  const [devices, setDevices] = useState<{ sessions: DeviceSession[]; slug: string | null; message: string } | null>(null);
  useEffect(() => { if (state.status === 'mfa') router.push('/verify'); }, [state.status, router]);
  useEffect(() => { if (remembered?.email && !email) setEmail(remembered.email); }, [remembered]); // eslint-disable-line react-hooks/exhaustive-deps

  const attempt = async (slug: string | null, revokeFamilyId?: string) => {
    setPending(true); setStatus(''); Keyboard.dismiss();
    try {
      const outcome = await client.signIn(email, password, slug, revokeFamilyId ? { revokeFamilyId } : {});
      if (outcome?.kind === 'chooseWorkspace') {
        if (!outcome.workspaces.length) setStatus(t('This account has no workspace yet. Ask your administrator.'));
        else setChoices(outcome.workspaces);
      }
    } catch (error) {
      if (error instanceof DeviceLimitError) setDevices({ sessions: error.sessions.filter((session) => !session.current), slug, message: error.message });
      else if (!(error instanceof AuthError) || error.code !== 'cancelled') setStatus(t(error instanceof AuthError ? error.message : 'Unable to sign in. Please try again.'));
    } finally { setPending(false); }
  };
  const submit = () => {
    if (pending) return;
    const next = validateCredentials(email, password);
    setErrors({ email: next.email ? t(next.email) : '', password: next.password ? t(next.password) : '' });
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();
    // The remembered workspace is used only for the email that signed in to it.
    const slug = !choosing && remembered && remembered.email.toLowerCase() === email.trim().toLowerCase() ? remembered.loginSlug : null;
    void attempt(slug);
  };
  const useAnother = () => { forget(); setEmail(''); setPassword(''); setStatus(''); setTimeout(() => emailRef.current?.focus(), 50); };

  return <AuthFrame logo={<WorkspaceLogo />}
    heading={remembered ? t('Welcome back') : t('Sign in')} subtitle={remembered ? t('Sign in to {name}.', { name: remembered.displayName }) : t('Use your work email.')}
    footer={<>
      <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>{t('Need access? Ask your administrator.')}</Text>
      <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push('/client')} testID="client-entry">
        <Text variant="caption" tone="action">{t('Are you a client? Follow your project')}</Text>
      </Pressable>
      <PoweredBy />
    </>}>
    <TextField label={t('Email')} placeholder={t('you@company.com')} value={email} editable={!pending} inputRef={emailRef} error={errors.email} size="lg" pill
      leading={<Mail color={theme.colors.iconSubtle} size={20} />} keyboardType="email-address" autoComplete="email" textContentType="username" autoCapitalize="none" autoCorrect={false}
      returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} testID="email-input"
      action={remembered && email ? <Pressable accessibilityRole="button" hitSlop={10} onPress={useAnother}><Text variant="caption" tone="action">{t('Not you?')}</Text></Pressable> : undefined}
      onChangeText={(value) => { setEmail(value); setErrors((prev) => ({ ...prev, email: '' })); setStatus(''); }} />
    <TextField label={t('Password')} placeholder={t('Enter your password')} value={password} editable={!pending} inputRef={passwordRef} error={errors.password} size="lg" pill
      leading={<Lock color={theme.colors.iconSubtle} size={20} />} secureTextEntry={!visible} autoComplete="current-password" textContentType="password" autoCapitalize="none" autoCorrect={false}
      returnKeyType="go" onSubmitEditing={submit} testID="password-input"
      action={<Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.push({ pathname: '/forgot', params: { email } })}><Text variant="caption" tone="action" style={{ textDecorationLine: 'underline' }}>{t('Forgot password?')}</Text></Pressable>}
      trailing={<Pressable accessibilityRole="button" accessibilityLabel={visible ? t('Hide password') : t('Show password')} hitSlop={10} onPress={() => setVisible((value) => !value)}
        style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>{visible ? <EyeOff color={theme.colors.iconSubtle} size={18} /> : <Eye color={theme.colors.iconSubtle} size={18} />}</Pressable>}
      onChangeText={(value) => { setPassword(value); setErrors((prev) => ({ ...prev, password: '' })); setStatus(''); }} />
    <Button label={pending ? t('Signing in…') : t('Continue')} variant="primary" size="lg" pill full loading={pending} onPress={submit} testID="sign-in" />
    <Status text={status} />
    <WorkspacePicker choices={choices} onClose={() => setChoices(null)} onPick={(choice) => { setChoices(null); chooseWorkspace(false); void attempt(choice.loginSlug); }} />
    <DevicePicker state={devices} onClose={() => setDevices(null)} onPick={(familyId) => { const slug = devices?.slug ?? null; setDevices(null); void attempt(slug, familyId); }} />
  </AuthFrame>;
}

/** One email in several workspaces: choose which to open. */
function WorkspacePicker({ choices, onClose, onPick }: { choices: WorkspaceChoice[] | null; onClose: () => void; onPick: (choice: WorkspaceChoice) => void }) {
  const t = useT();
  const theme = useTheme();
  return <Sheet open={!!choices} onClose={onClose} title={t('Choose a workspace')}>
    <Section>
      {(choices ?? []).map((choice, index) => <ListRow key={choice.workspaceId} first={index === 0} title={choice.name} onPress={() => onPick(choice)}
        leading={choice.logoUrl ? <Image source={{ uri: choice.logoUrl }} contentFit="contain" style={{ width: 40, height: 40, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted }} />
          : <Avatar name={choice.name} size={40} />} />)}
    </Section>
  </Sheet>;
}

/** Signed in on too many devices: sign one out to continue here. */
function DevicePicker({ state, onClose, onPick }: { state: { sessions: DeviceSession[]; message: string } | null; onClose: () => void; onPick: (familyId: string) => void }) {
  const t = useT();
  const format = useFormat();
  const device = (agent: string | null) => {
    if (!agent) return t('Unknown device');
    if (/iphone|ipad|ios/i.test(agent)) return 'iPhone / iPad';
    if (/android/i.test(agent)) return 'Android';
    if (/mac os|macintosh/i.test(agent)) return 'Mac';
    if (/windows/i.test(agent)) return 'Windows';
    return agent.split(/[\s/]/)[0] || t('Unknown device');
  };
  return <Sheet open={!!state} onClose={onClose} title={t('Sign out a device')} subtitle={state ? t(state.message) : undefined}>
    <Section>
      {(state?.sessions ?? []).map((session, index) => <ListRow key={session.familyId} first={index === 0} icon={MonitorSmartphone} title={device(session.userAgent)}
        detail={t('Last active {when}', { when: format.ago(session.lastActiveAt) })} trailing={<Button size="sm" label={t('Sign out')} onPress={() => onPick(session.familyId)} />} />)}
    </Section>
  </Sheet>;
}

/** Two-step sign-in: the authenticator or recovery code. */
export function VerifyScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { client, state } = useAuth();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { if (state.status === 'signedOut') router.replace('/sign-in'); }, [state.status, router]);
  const submit = async () => {
    if (pending) return;
    if (!/^\d{6}$/.test(code.trim()) && !/^[A-Za-z0-9-]{8,32}$/.test(code.trim())) { setStatus(t('Enter your six-digit authenticator code or a recovery code.')); return; }
    setPending(true); Keyboard.dismiss();
    try { await client.verifyMfa(code); }
    catch (error) { if (!(error instanceof AuthError) || error.code !== 'cancelled') setStatus(t(error instanceof AuthError ? error.message : 'Unable to verify your code. Please try again.')); }
    finally { setPending(false); }
  };
  return <AuthFrame logo={<WorkspaceLogo />} onBack={() => { client.cancelMfa(); router.replace('/sign-in'); }}
    heading={t('Verify it’s you')} subtitle={t('Use your authenticator app or one of your saved recovery codes.')} footer={<PoweredBy />}>
    <TextField label={t('Authenticator or recovery code')} placeholder={t('Enter your code')} value={code} editable={!pending} size="lg" pill autoFocus
      leading={<KeyRound color={theme.colors.iconSubtle} size={20} />} autoComplete="one-time-code" textContentType="oneTimeCode" autoCapitalize="characters" autoCorrect={false}
      returnKeyType="go" onSubmitEditing={submit} onChangeText={(value) => { setCode(value); setStatus(''); }} />
    <Button label={pending ? t('Verifying…') : t('Verify and sign in')} variant="primary" size="lg" pill full loading={pending} onPress={submit} />
    <Status text={status} />
  </AuthFrame>;
}

/** Password help: asks for a reset by email alone; the reset link comes from the administrator or by email. */
export function ForgotScreen({ initialEmail = '' }: { initialEmail?: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { client } = useAuth();
  const { remembered } = useOrganization();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async () => {
    const problem = validateCredentials(email, 'x').email;
    if (problem) { setError(t(problem)); return; }
    setPending(true); setStatus(''); Keyboard.dismiss();
    const slug = remembered && remembered.email.toLowerCase() === email.trim().toLowerCase() ? remembered.loginSlug : null;
    try {
      await client.requestPasswordReset(email, slug);
      setStatus(t('If your account exists, a reset has been requested. Contact your administrator for the reset link.'));
    } catch (cause) { setStatus(t(cause instanceof AuthError ? cause.message : 'Unable to request a reset. Please try again.')); }
    finally { setPending(false); }
  };
  return <AuthFrame logo={<WorkspaceLogo />} onBack={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
    heading={t('Reset your password')} subtitle={t('Enter your work email.')} footer={<PoweredBy />}>
    <TextField label={t('Email')} placeholder={t('you@company.com')} value={email} error={error} size="lg" pill autoFocus
      leading={<Mail color={theme.colors.iconSubtle} size={20} />} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false}
      returnKeyType="send" onSubmitEditing={submit} onChangeText={(value) => { setEmail(value); setError(''); }} />
    <Button label={t('Request reset')} variant="primary" size="lg" pill full loading={pending} onPress={submit} />
    <Status text={status} />
  </AuthFrame>;
}
