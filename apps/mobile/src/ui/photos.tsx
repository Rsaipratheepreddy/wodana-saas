import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, View, useWindowDimensions, type StyleProp, type ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, CloudUpload, ImagePlus, PenLine, Plus, X } from 'lucide-react-native';
import { useAuth } from '../auth/provider';
import { useApi } from '../core/api';
import { useT } from '../core/i18n';
import { choosePhotos, MediaPermissionError, openSettings, takePhoto, type LocalPhoto } from '../core/media';
import { ActionSheet } from './dialogs';
import { IconButton, Text } from './primitives';
import { useToast } from './toast';
import { useTheme } from './theme';

/** A photo stored in the workspace, fetched with the person's sign-in. `path` is workspace-relative. */
export function AuthImage({ path, style, contentFit = 'cover', accessibilityLabel }: { path: string; style?: StyleProp<ImageStyle>; contentFit?: 'cover' | 'contain'; accessibilityLabel?: string }) {
  const { client } = useAuth();
  const api = useApi();
  const theme = useTheme();
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      const authorization = await client.authorization().catch(() => null);
      if (!authorization || !alive) return;
      if (Platform.OS === 'web') {
        // Browsers can't add headers to an <img>; fetch the bytes and show them locally.
        const response = await fetch(api.url(path), { headers: { authorization } }).catch(() => null);
        if (!response?.ok || !alive) return;
        objectUrl = URL.createObjectURL(await response.blob());
        setSource({ uri: objectUrl });
      } else setSource({ uri: api.url(path), headers: { authorization } });
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, api, path]);
  return <Image source={source ?? undefined} style={[{ backgroundColor: theme.colors.surfaceMuted }, style]} contentFit={contentFit} transition={160}
    accessibilityLabel={accessibilityLabel} cachePolicy="memory-disk" recyclingKey={path} />;
}

export type PhotoItem = {
  key: string;
  /** A photo on the phone. */
  uri?: string;
  /** Or a photo in the workspace (workspace-relative path; add `?preview=1` for the small copy). */
  path?: string;
  /** Waiting to upload. */
  pending?: boolean;
  label?: string;
};

/** Photos in a grid: tap to see one full size; the last tile adds more. */
export function PhotoGrid({ photos, onAdd, onRemove, onDraw, max = 10, columns = 3, addLabel }: {
  photos: PhotoItem[]; onAdd?: (photos: LocalPhoto[]) => void; onRemove?: (key: string) => void; onDraw?: (item: PhotoItem) => void; max?: number; columns?: number; addLabel?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState<PhotoItem | null>(null);
  const [width, setWidth] = useState(0);
  const pick = usePhotoPicker();
  const gap = theme.space(2);
  const size = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;
  const room = max - photos.length;
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
    {size ? photos.map((photo) => <View key={photo.key} style={{ width: size, height: size }}>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={photo.label ?? t('Photo')} onPress={() => setOpen(photo)}
        style={{ width: size, height: size, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceMuted }}>
        {photo.uri ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} />
          : photo.path ? <AuthImage path={photo.path} style={{ width: '100%', height: '100%' }} /> : null}
        {photo.pending ? <View style={{ position: 'absolute', bottom: 6, start: 6, borderRadius: theme.radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', padding: 4 }}>
          <CloudUpload color="#ffffff" size={14} />
        </View> : null}
      </Pressable>
      {onRemove && photo.uri ? <View style={{ position: 'absolute', top: 2, end: 2 }}>
        <IconButton icon={X} label={t('Remove photo')} tone="inverse" filled size={28} onPress={() => onRemove(photo.key)} />
      </View> : null}
    </View>) : null}
    {size && onAdd && room > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={addLabel ?? t('Add photos')} onPress={() => pick.open((next) => onAdd(next), room)}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: theme.radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong,
        alignItems: 'center', justifyContent: 'center', gap: theme.space(1), backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
      <ImagePlus color={theme.colors.icon} size={24} strokeWidth={1.8} />
      <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }} numberOfLines={2}>{addLabel ?? t('Add photos')}</Text>
    </Pressable> : null}
    {pick.sheet}
    <PhotoViewer photo={open} onClose={() => setOpen(null)} onDraw={onDraw && open?.uri ? () => { const item = open; setOpen(null); if (item) onDraw(item); } : undefined} />
  </View>;
}

/** Camera or library, with the permission refusal explained once. */
export function usePhotoPicker() {
  const t = useT();
  const toast = useToast();
  const [state, setState] = useState<{ done: (photos: LocalPhoto[]) => void; limit: number } | null>(null);
  const run = async (source: 'camera' | 'library', done: (photos: LocalPhoto[]) => void, limit: number) => {
    try {
      if (source === 'camera') { const photo = await takePhoto(); if (photo) done([photo]); }
      else { const photos = await choosePhotos(limit); if (photos.length) done(photos); }
    } catch (error) {
      if (error instanceof MediaPermissionError) toast.show(error.kind === 'camera' ? t('Allow camera access in Settings to take photos.') : t('Allow photo access in Settings to choose photos.'), 'error', { label: t('Settings'), onPress: openSettings });
      else toast.error(t('The photo could not be added. Try again.'));
    }
  };
  return {
    /** Ask where the photos come from, then hand them over. */
    open: (done: (photos: LocalPhoto[]) => void, limit = 10) => setState({ done, limit }),
    camera: (done: (photos: LocalPhoto[]) => void) => run('camera', done, 1),
    sheet: <ActionSheet open={!!state} onClose={() => setState(null)} actions={[
      { label: t('Take photo'), icon: Camera, onPress: () => { if (state) void run('camera', state.done, 1); } },
      { label: t('Choose from library'), icon: ImagePlus, onPress: () => { if (state) void run('library', state.done, state.limit); } },
    ]} />,
  };
}

/** One photo, full screen. */
export function PhotoViewer({ photo, onClose, onDraw }: { photo: PhotoItem | null; onClose: () => void; onDraw?: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return <Modal visible={!!photo} animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent>
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {photo?.uri ? <Image source={{ uri: photo.uri }} style={{ width, height }} contentFit="contain" />
        : photo?.path ? <AuthImage path={photo.path.replace(/[?&]preview=1/, '')} style={{ width, height, backgroundColor: '#000000' }} contentFit="contain" /> : null}
      <View style={{ position: 'absolute', top: insets.top + 8, start: 12, end: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton icon={X} label={t('Close')} tone="inverse" filled onPress={onClose} />
        {onDraw ? <IconButton icon={PenLine} label={t('Draw on photo')} tone="inverse" filled onPress={onDraw} /> : null}
      </View>
    </View>
  </Modal>;
}

/** A large square button to start a capture ("Take photo"). */
export function CaptureButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ height: 120, borderRadius: theme.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong,
      alignItems: 'center', justifyContent: 'center', gap: theme.space(2), backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.actionPrimary, alignItems: 'center', justifyContent: 'center' }}>
      <Plus color={theme.colors.actionOnPrimary} size={24} />
    </View>
    <Text variant="label">{label}</Text>
  </Pressable>;
}
