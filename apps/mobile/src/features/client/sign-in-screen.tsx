import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyRound, Link2 } from 'lucide-react-native';
import { authConfig } from '../../auth/config';
import { preferenceLocale, useLanguage, useT } from '../../core/i18n';
import { defaultPhoneCountry, phoneForText, phoneProblem, splitPhone, toE164 } from '../../core/phone';
import { inviteToken } from '../../portal/address';
import { PortalError, type Challenge, type PortalChannel } from '../../portal/client';
import { logoUrl } from '../../portal/model';
import { usePortal } from '../../portal/provider';
import { BrandLogo } from '../../ui/brand';
import { TextField } from '../../ui/fields';
import { PhoneField } from '../../ui/phone-field';
import { Button, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { AuthFrame } from '../auth/screens';

const Status = ({ text, tone = 'secondary' }: { text: string; tone?: 'secondary' | 'danger' }) =>
  (text ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" variant="caption" tone={tone} style={{ textAlign: 'center' }}>{text}</Text> : null);

/**
 * A client signs in to their firm's portal with the mobile number the team has for them and a 6-digit code (WhatsApp,
 * or email when WhatsApp can't): first the portal (the link the team sent, unless this build is the firm's own), then the
 * number, then the code. The answer never says whether a number has access.
 */
export function ClientSignInScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { client, state } = usePortal();
  const site = state.status === 'signedOut' ? state.site : null;
  const slug = state.status === 'signedOut' ? state.slug : null;
  const [address, setAddress] = useState('');
  const { language } = useLanguage();
  // The number as a country and a local number; the country starts on the firm's (its portal's region), else this phone's.
  const [phone, setPhone] = useState({ country: '', national: '' });
  const country = phone.country || defaultPhoneCountry(site?.region);
  const namesLocale = preferenceLocale(language, site?.region.locale);
  const [phoneError, setPhoneError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [channel, setChannel] = useState<PortalChannel>('whatsapp');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(state.status === 'signedOut' && state.message ? state.message : '');
  const [waiting, setWaiting] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<TextInput>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  // A portal that only sends codes by email starts there.
  useEffect(() => { if (site) setChannel(site.signIn.channels.includes('whatsapp') ? 'whatsapp' : 'email'); }, [site]);
  // The brand and code channels of a remembered portal.
  useEffect(() => { if (slug && !site) void client.site().catch(() => undefined); }, [client, slug, site]);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const logo = <BrandLogo logoUrl={logoUrl(site?.brand.logoUrl, authConfig.baseUrl)} name={site?.brand.name} />;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  const findPortal = async () => {
    setBusy(true); setStatus(''); Keyboard.dismiss();
    try {
      await client.choose(address);
      const invite = inviteToken(address);
      if (invite) {
        const found = await client.invitation(invite).catch(() => null);
        if (found?.status === 'valid') setPhone(splitPhone(found.phone, country));
        else if (found?.status === 'expired') setStatus(t('This invite link has expired. Sign in with your mobile number, or ask your project team for a new one.'));
      }
    } catch (cause) { setStatus(t((cause as Error).message)); }
    finally { setBusy(false); }
  };

  const send = async (via: PortalChannel) => {
    const problem = phone.national.trim() ? phoneProblem(phone.national, country, {
      tooShort: (name, code, digits) => t('Too short — {country} mobile numbers are {digits} digits after {code}', { country: name, digits, code }),
      tooLong: (name, code, digits) => t('Too long — {country} mobile numbers are {digits} digits after {code}', { country: name, digits, code }),
      invalid: (name) => t('Not a valid number for {country}', { country: name }),
      notMobile: (name) => t('Not a mobile number for {country}', { country: name }),
      chooseCountry: t('Choose the country code'),
    }, { mobile: true, locale: namesLocale }) : t('Enter your mobile number.');
    const number = problem ? null : toE164(phone.national, country);
    if (!number) { setPhoneError(problem ?? t('Not a valid number for {country}', { country })); return; }
    setBusy(true); setStatus(''); setPhoneError(''); setWaiting(false); Keyboard.dismiss();
    try {
      const next = await client.challenge({ phone: number, channel: via });
      setSentTo(number); setChannel(via); setChallenge(next); setCode(''); setResendAt(Date.now() + next.resendAfter * 1000);
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (cause) {
      const failure = cause as PortalError;
      if (failure.retryAfter) setResendAt(Date.now() + failure.retryAfter * 1000);
      // "A code is on its way" is information, not a failure.
      setWaiting(failure.status === 429);
      setStatus(t(failure.message));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!challenge || !/^\d{6}$/.test(code)) { setStatus(t('Enter the 6-digit code.')); return; }
    setBusy(true); setStatus(''); Keyboard.dismiss();
    try { await client.login({ challengeId: challenge.challengeId, code }); }
    catch (cause) { setStatus(t((cause as Error).message)); setBusy(false); }
  };

  if (!slug) {
    return <AuthFrame logo={logo} onBack={client.lockedTo ? undefined : back} heading={t('Welcome')} subtitle={t('Enter the link your project team sent you.')}>
      <TextField label={t('Portal link')} placeholder={t('Paste the link here')} value={address} editable={!busy} size="lg" pill autoFocus
        leading={<Link2 color={theme.colors.iconSubtle} size={20} />} keyboardType="url" autoCapitalize="none" autoCorrect={false} returnKeyType="go"
        onSubmitEditing={() => void findPortal()} onChangeText={(value) => { setAddress(value); setStatus(''); }} testID="portal-address" />
      <Button label={t('Continue')} variant="primary" size="lg" pill full loading={busy} disabled={!address.trim()} onPress={() => void findPortal()} testID="portal-continue" />
      <Status text={status} tone="danger" />
    </AuthFrame>;
  }

  const footer = <>
    {client.lockedTo ? null : <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { setChallenge(null); setStatus(''); void client.forgetPortal(); }}>
      <Text variant="caption" tone="action">{t('Use another portal')}</Text></Pressable>}
    {site ? <Text variant="caption" tone="tertiary" style={{ textAlign: 'center', fontSize: 11 }}>{t('Powered by Wodana')}</Text> : null}
  </>;

  if (!challenge) {
    return <AuthFrame logo={logo} onBack={client.lockedTo ? undefined : back} footer={footer}
      heading={site?.welcomeTitle || t('Welcome')} subtitle={site?.welcomeText || t('Sign in to follow your project.')}>
      <PhoneField label={t('Mobile number')} value={{ country, national: phone.national }} locale={namesLocale} error={phoneError} editable={!busy} size="lg" pill
        returnKeyType="send" onSubmitEditing={() => void send(channel)} testID="portal-phone"
        onChange={(value) => { setPhone(value); setPhoneError(''); setStatus(''); }} />
      <Button label={channel === 'whatsapp' ? t('Send code by WhatsApp') : t('Send code by email')} variant="primary" size="lg" pill full loading={busy}
        onPress={() => void send(channel)} testID="portal-send-code" />
      {site && site.signIn.channels.length > 1 ? <Button label={channel === 'whatsapp' ? t('Use email instead') : t('Use WhatsApp instead')} variant="ghost" full disabled={busy}
        onPress={() => setChannel(channel === 'whatsapp' ? 'email' : 'whatsapp')} /> : null}
      <Status text={status} tone={waiting ? 'secondary' : 'danger'} />
    </AuthFrame>;
  }

  return <AuthFrame logo={logo} footer={footer} onBack={() => { setChallenge(null); setCode(''); setStatus(''); }} heading={t('Enter your code')}
    subtitle={channel === 'whatsapp' ? t('If {phone} has access, a 6-digit code is on its way by WhatsApp.', { phone: phoneForText(sentTo) })
      : t('If {phone} has access, a 6-digit code is on its way to the email we have for you.', { phone: phoneForText(sentTo) })}>
    {site?.signIn.demo ? <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>{t('Demo: the code is 123456.')}</Text> : null}
    <TextField label={t('Code')} inputRef={codeRef} value={code} editable={!busy} size="lg" pill keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
      maxLength={6} leading={<KeyRound color={theme.colors.iconSubtle} size={20} />} returnKeyType="go" onSubmitEditing={() => void verify()} testID="portal-code"
      onChangeText={(value) => { setCode(value.replace(/\D/g, '').slice(0, 6)); setStatus(''); }} />
    <Button label={t('Sign in')} variant="primary" size="lg" pill full loading={busy} disabled={code.length !== 6} onPress={() => void verify()} testID="portal-sign-in" />
    <View style={{ alignItems: 'center', gap: theme.space(1) }}>
      <Button size="sm" variant="ghost" disabled={busy || wait > 0} label={wait > 0 ? t('Send a new code in {seconds} s', { seconds: wait }) : t('Send a new code')} onPress={() => void send(channel)} />
      {channel === 'whatsapp' && site?.signIn.channels.includes('email') ? <Button size="sm" variant="ghost" disabled={busy || wait > 0} label={t('Send it by email instead')} onPress={() => void send('email')} /> : null}
      <Button size="sm" variant="ghost" disabled={busy} label={t('Not you? Change number')} onPress={() => { setChallenge(null); setCode(''); setStatus(''); }} />
    </View>
    <Status text={status} tone="danger" />
  </AuthFrame>;
}

/** The first time they sign in, the client checks the name the team has for them (it's how the team sees their decisions). */
export function ConfirmNameScreen({ name }: { name: string }) {
  const t = useT();
  const { client, state } = usePortal();
  const site = state.status === 'signedIn' ? state.site : null;
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [id] = useState(() => client.newId());
  useEffect(() => { if (name && !value) setValue(name); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (value.trim().length < 2) { setStatus(t('Enter your name.')); return; }
    setBusy(true); setStatus('');
    try { await client.confirmName(id, value.trim()); }
    catch (cause) { setStatus(t((cause as Error).message)); setBusy(false); }
  };
  return <AuthFrame logo={<BrandLogo logoUrl={logoUrl(site?.brand.logoUrl, authConfig.baseUrl)} name={site?.brand.name} />}
    heading={t('Is this your name?')} subtitle={t('It\'s how your project team will see your decisions.')}>
    <TextField label={t('Your name')} value={value} onChangeText={setValue} autoComplete="name" textContentType="name" maxLength={160} size="lg" pill autoFocus
      returnKeyType="done" onSubmitEditing={() => void save()} />
    <Button label={t('Continue')} variant="primary" size="lg" pill full loading={busy} onPress={() => void save()} />
    <Status text={status} tone="danger" />
  </AuthFrame>;
}
