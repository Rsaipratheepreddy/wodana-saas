import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRouter, type Href } from 'expo-router';
import { Camera, FileText, ImageOff, ImagePlus, RotateCcw, X } from 'lucide-react-native';
import { authConfig } from '../../auth/config';
import { useT } from '../../core/i18n';
import { choosePhotos, MediaPermissionError, openSettings, takePhoto, type LocalPhoto } from '../../core/media';
import type { CodedDecision } from '../../portal/flows';
import type { FileKind, PortalClient, PortalChannel } from '../../portal/client';
import { stateLabel, type ClientTarget } from '../../portal/model';
import { usePortal, useProject, useSelectedProject } from '../../portal/provider';
import type { PortalFile } from '../../portal/types';
import { TextField } from '../../ui/fields';
import { Banner } from '../../ui/layout';
import { Button, Chip, IconButton, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';

/** A state in one or two words (the web portal's words and tones). */
export function StateChip({ state, canDecide }: { state: string; canDecide?: boolean }) {
  const t = useT();
  const { label, tone } = stateLabel(state, canDecide);
  return <Chip label={t(label)} tone={tone} />;
}

/** A picture the client may see (a design, a site photo, a file they added), loaded with their session. */
export function PortalImage({ kind, id, preview = true, style, contentFit = 'cover', label }: {
  kind: FileKind; id: string; preview?: boolean; style?: StyleProp<ImageStyle>; contentFit?: 'cover' | 'contain'; label?: string;
}) {
  const { client } = usePortal();
  const theme = useTheme();
  const t = useT();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [kind, id]);
  const authorization = client.authorization;
  if (failed || !authorization) {
    return <View accessibilityLabel={t('Photo unavailable')} style={[{ backgroundColor: theme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }, style as StyleProp<ViewStyle>]}>
      <ImageOff color={theme.colors.iconSubtle} size={20} strokeWidth={1.8} />
    </View>;
  }
  return <Image source={{ uri: client.fileUrl(kind, id, preview), headers: { authorization } }} style={[{ backgroundColor: theme.colors.surfaceMuted }, style]}
    contentFit={contentFit} transition={140} cachePolicy="memory-disk" recyclingKey={`${kind}:${id}:${preview}`} accessibilityLabel={label} onError={() => setFailed(true)} />;
}

/** Opens a portal file (a PDF, a signed copy) with the phone's viewer and share sheet. */
export async function openPortalFile(client: PortalClient, kind: FileKind, id: string, name: string) {
  const authorization = client.authorization;
  if (!authorization) throw new Error('Sign in again to open this file.');
  const url = client.fileUrl(kind, id);
  if (Platform.OS === 'web') { globalThis.open?.(url, '_blank'); return; }
  const folder = new Directory(Paths.cache, 'portal-files');
  folder.create({ idempotent: true, intermediates: true });
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
  const file = await File.downloadFileAsync(url, new File(folder, safe), { headers: { authorization }, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { dialogTitle: name });
}

/** The web portal, for the decisions the app sends there (quotations, the material list, handovers). */
export function webPortalUrl(slug: string) {
  const web = process.env.EXPO_PUBLIC_WEB_URL?.trim() || authConfig.baseUrl.replace(/\/api\/v1\/?$/, '');
  return `${web.replace(/\/+$/, '')}/portal/${encodeURIComponent(slug)}`;
}

/** Opens a target: a tab, a screen with its record, or the web portal. */
export function useOpenTarget() {
  const router = useRouter();
  const { state } = usePortal();
  return (target: ClientTarget) => {
    if ('tab' in target) return router.navigate((target.tab === 'index' ? '/portal' : `/portal/${target.tab}`) as Href);
    if ('web' in target) { if (state.status === 'signedIn') void Linking.openURL(webPortalUrl(state.slug)).catch(() => undefined); return; }
    if (target.screen === 'thread' || target.screen === 'question') return router.push({ pathname: `/portal/${target.screen}/[id]`, params: { id: target.id } } as Href);
    return router.push({ pathname: `/portal/${target.screen}`, params: target.id ? { focus: target.id } : {} } as Href);
  };
}

/** The client's projects, when they have more than one: tap to switch. */
export function ProjectSwitcher() {
  const t = useT();
  const { view, project } = useProject();
  const { select } = useSelectedProject();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const projects = view?.projects ?? [];
  if (projects.length < 2 || !project) return null;
  return <>
    <Chip label={t('Switch project')} tone="action" onPress={() => setOpen(true)} />
    <Sheet open={open} onClose={() => setOpen(false)} title={t('Your projects')}>
      <View style={{ gap: theme.space(2) }}>
        {projects.map((item) => <Button key={item.id} label={item.title} variant={item.id === project.id ? 'primary' : 'secondary'} full onPress={() => { select(item.id); setOpen(false); }} />)}
      </View>
    </Sheet>
  </>;
}

/**
 * Confirms a decision with a code sent for exactly it: the code goes as soon as the sheet opens (WhatsApp, else email),
 * a new one can be asked for after the wait, and a wrong code can be typed again.
 */
export function CodeSheet({ decision, channels, confirmLabel, onDone, onClose }: {
  decision: CodedDecision | null; channels: PortalChannel[]; confirmLabel: string; onDone: () => void; onClose: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<PortalChannel | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const asked = useRef<CodedDecision | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const send = async (via: PortalChannel) => {
    if (!decision) return;
    setBusy(true); setError(''); setCode('');
    try {
      const next = await decision.send(via);
      setChannel(next.channel); setSentTo(next.sentTo ?? null); setResendAt(Date.now() + next.resendAfter * 1000);
    } catch (cause) {
      const failure = cause as { message?: string; retryAfter?: number };
      if (failure.retryAfter) setResendAt(Date.now() + failure.retryAfter * 1000);
      setError(failure.message ?? t('Something went wrong. Please try again.'));
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!decision || asked.current === decision) return;
    asked.current = decision;
    setChannel(null); setSentTo(null); setCode(''); setError('');
    void send(channels.includes('whatsapp') ? 'whatsapp' : 'email');
  }, [decision]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = async () => {
    if (!decision) return;
    setBusy(true); setError('');
    try { await decision.confirm(code); onDone(); }
    catch (cause) { setError(t((cause as Error).message)); }
    finally { setBusy(false); }
  };
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return <Sheet open={Boolean(decision)} onClose={onClose} title={t('Enter your code')}
    footer={<Button label={confirmLabel} variant="primary" size="lg" full loading={busy && Boolean(channel)} disabled={!channel || code.length !== 6} onPress={() => void confirm()} testID="confirm-code" />}>
    <View style={{ gap: theme.space(4) }}>
      {channel ? <Text tone="secondary">{channel === 'email'
        ? sentTo ? t('We sent a 6-digit code to {email}.', { email: sentTo }) : t('We sent a 6-digit code to your email.')
        : t('We sent a 6-digit code to your WhatsApp.')}</Text> : busy ? <Text tone="secondary">{t('Sending your code')}</Text> : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      {channel ? <TextField label={t('Code')} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
        textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} autoFocus size="lg" testID="code-input" /> : null}
      <Row wrap gap={2}>
        <Button size="sm" variant="ghost" disabled={busy || wait > 0} label={wait > 0 ? t('Send a new code in {seconds} s', { seconds: wait }) : t('Send a new code')}
          onPress={() => void send(channel ?? 'whatsapp')} />
        {channels.includes('email') && channel !== 'email' ? <Button size="sm" variant="ghost" disabled={busy || wait > 0} label={t('Send it by email instead')} onPress={() => void send('email')} /> : null}
      </Row>
    </View>
  </Sheet>;
}

type Attached = { key: string; id: string; uri: string; name: string; type: string; status: 'uploading' | 'done' | 'failed'; error: string };

/**
 * Photos the client adds to what they send (a receipt, a problem, a message), from the camera or the library: each is
 * uploaded as soon as it's picked, under its own id, so a retry sends the same file. `onChange` gets the ids that are up.
 */
export function AttachPhotos({ caseId, onChange, onBusy, max = 6, label }: { caseId: string; onChange: (ids: string[]) => void; onBusy?: (busy: boolean) => void; max?: number; label?: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = usePortal();
  const [items, setItems] = useState<Attached[]>([]);
  const report = useRef({ onChange, onBusy });
  report.current = { onChange, onBusy };
  useEffect(() => {
    report.current.onChange(items.filter((item) => item.status === 'done').map((item) => item.id));
    report.current.onBusy?.(items.some((item) => item.status === 'uploading'));
  }, [items]);
  const send = async (item: Attached) => {
    setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: 'uploading', error: '' } : entry)));
    try {
      await client.upload(caseId, item.id, { uri: item.uri, name: item.name, type: item.type });
      setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: 'done' } : entry)));
    } catch (cause) {
      setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: 'failed', error: (cause as Error).message } : entry)));
      toast.error((cause as Error).message);
    }
  };
  const add = (photos: Array<{ id: string; uri: string; name: string; type: string }>) => {
    const next = photos.slice(0, Math.max(0, max - items.length)).map((photo): Attached => ({ key: client.newId(), id: client.newId(), uri: photo.uri, name: photo.name, type: photo.type, status: 'uploading', error: '' }));
    setItems((current) => [...current, ...next]);
    for (const item of next) void send(item);
  };
  // Straight to the camera or the library (no second sheet: this often sits inside one).
  const pick = async (source: 'camera' | 'library') => {
    try {
      const photos: LocalPhoto[] = source === 'camera' ? [await takePhoto()].filter((photo): photo is LocalPhoto => Boolean(photo)) : await choosePhotos(max - items.length);
      if (photos.length) add(photos);
    } catch (error) {
      if (error instanceof MediaPermissionError) toast.show(error.kind === 'camera' ? t('Allow camera access in Settings to take photos.') : t('Allow photo access in Settings to choose photos.'), 'error', { label: t('Settings'), onPress: openSettings });
      else toast.error(t('The photo could not be added. Try again.'));
    }
  };
  const size = 72;
  return <View style={{ gap: theme.space(2) }}>
    {items.length ? <Row wrap gap={2}>{items.map((item) => <View key={item.key} style={{ width: size, height: size }}>
      <Image source={{ uri: item.uri }} style={{ width: size, height: size, borderRadius: theme.radius.md, opacity: item.status === 'done' ? 1 : 0.55 }} contentFit="cover" />
      <View style={{ position: 'absolute', top: 2, end: 2, flexDirection: 'row', gap: 2 }}>
        {item.status === 'failed' ? <IconButton icon={RotateCcw} label={t('Try {name} again', { name: item.name })} tone="inverse" filled size={26} onPress={() => void send(item)} /> : null}
        <IconButton icon={X} label={t('Remove {name}', { name: item.name })} tone="inverse" filled size={26} disabled={item.status === 'uploading'}
          onPress={() => setItems((current) => current.filter((entry) => entry.key !== item.key))} />
      </View>
      <Text variant="caption" tone={item.status === 'failed' ? 'danger' : 'tertiary'} numberOfLines={1} style={{ position: 'absolute', bottom: -18, start: 0, end: 0, fontSize: 10 }}>
        {item.status === 'uploading' ? t('Adding…') : item.status === 'failed' ? t('Try again') : t('Added')}</Text>
    </View>)}</Row> : null}
    {items.length < max ? <Row gap={2} style={{ marginTop: items.length ? theme.space(4) : 0 }}>
      <Button size="sm" icon={Camera} label={t('Take photo')} onPress={() => void pick('camera')} testID="attach-camera" />
      <Button size="sm" icon={ImagePlus} label={label ?? t('Choose from library')} onPress={() => void pick('library')} testID="attach-library" />
    </Row> : null}
  </View>;
}

/** Files someone on the client's side added, as small pictures that open in full. */
export function FileStrip({ files }: { files: PortalFile[] }) {
  const theme = useTheme();
  const { client } = usePortal();
  const toast = useToast();
  if (!files.length) return null;
  return <Row wrap gap={2}>{files.map((file) => <Pressable key={file.id} accessibilityRole="imagebutton" accessibilityLabel={file.name}
    onPress={() => { void openPortalFile(client, 'asset', file.id, file.name).catch((cause: Error) => toast.error(cause.message)); }}
    style={{ width: 56, height: 56, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
    {file.hasPreview ? <PortalImage kind="asset" id={file.id} style={{ width: 56, height: 56 }} /> : <FileText color={theme.colors.icon} size={20} />}
  </Pressable>)}</Row>;
}
