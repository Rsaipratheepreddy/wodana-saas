import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, CloudUpload, Info } from 'lucide-react-native';
import { haptic } from '../core/haptics';
import { Text } from './primitives';
import { useTheme } from './theme';

type Tone = 'success' | 'error' | 'info' | 'queued';
type Toast = { id: number; message: string; tone: Tone; action?: { label: string; onPress: () => void } };
type ToastApi = {
  show: (message: string, tone?: Tone, action?: Toast['action']) => void;
  /** A success; `touch` picks the approve or send haptic instead of the plain success one. */
  success: (message: string, touch?: 'approve' | 'send') => void;
  error: (message: string) => void;
  /** Saved on the phone, to send when there's a connection. */
  queued: (message: string) => void;
};

const ToastContext = createContext<ToastApi>({ show: () => undefined, success: () => undefined, error: () => undefined, queued: () => undefined });
const native = Platform.OS !== 'web';

/** One short message at a time above the tab bar: what just happened, and sometimes an undo or a link. */
export function ToastProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const queue = useRef<Toast[]>([]);
  const counter = useRef(0);
  const next = useCallback(() => { setCurrent(queue.current.shift() ?? null); }, []);
  const show = useCallback((message: string, tone: Tone = 'info', action?: Toast['action'], touch?: 'approve' | 'send') => {
    if (tone === 'success') (touch ? haptic[touch] : haptic.success)();
    if (tone === 'error') haptic.error();
    const toast = { id: ++counter.current, message, tone, action };
    setCurrent((visible) => {
      if (visible) { queue.current.push(toast); return visible; }
      return toast;
    });
  }, []);
  const api = useMemo<ToastApi>(() => ({
    show, success: (message, touch) => show(message, 'success', undefined, touch), error: (message) => show(message, 'error'), queued: (message) => show(message, 'queued'),
  }), [show]);
  return <ToastContext.Provider value={api}>
    {children}
    {current ? <ToastView key={current.id} toast={current} onDone={next} /> : null}
  </ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, damping: 20, stiffness: 240, useNativeDriver: native }).start();
    const timer = setTimeout(() => {
      Animated.timing(enter, { toValue: 0, duration: theme.motion.base, useNativeDriver: native }).start(onDone);
    }, toast.action ? 5000 : toast.tone === 'error' ? 4200 : 2800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertTriangle : toast.tone === 'queued' ? CloudUpload : Info;
  const tint = toast.tone === 'success' ? theme.colors.success : toast.tone === 'error' ? theme.colors.danger : theme.colors.info;
  // Toasts use the inverse surface so they read on any page, in light and dark.
  const surface = theme.scheme === 'dark' ? theme.colors.surfaceMuted : theme.colors.text;
  const ink = theme.scheme === 'dark' ? theme.colors.text : theme.colors.textInverse;
  return <Animated.View pointerEvents="box-none" accessibilityLiveRegion="polite" accessibilityRole="alert"
    style={{ position: 'absolute', start: theme.space(4), end: theme.space(4), bottom: insets.bottom + 72, alignItems: 'center',
      opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), maxWidth: 520, width: '100%', paddingStart: theme.space(4), paddingEnd: theme.space(toast.action ? 2 : 4),
      minHeight: 52, borderRadius: theme.radius.lg, backgroundColor: surface, borderWidth: theme.scheme === 'dark' ? 1 : 0, borderColor: theme.colors.border }}>
      <Icon color={theme.scheme === 'dark' ? tint : theme.colors.textInverse} size={18} strokeWidth={2} />
      <Text variant="label" style={{ flex: 1, color: ink, paddingVertical: theme.space(3) }}>{toast.message}</Text>
      {toast.action ? <Pressable accessibilityRole="button" onPress={() => { toast.action?.onPress(); onDone(); }} hitSlop={8}
        style={{ paddingHorizontal: theme.space(3), minHeight: 44, justifyContent: 'center' }}>
        <Text variant="label" style={{ color: ink, fontFamily: theme.font.semibold }}>{toast.action.label}</Text>
      </Pressable> : null}
    </View>
  </Animated.View>;
}
