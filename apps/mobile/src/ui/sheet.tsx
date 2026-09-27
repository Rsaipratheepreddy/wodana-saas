import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { IconButton, Row, Text } from './primitives';
import { useTheme } from './theme';

const native = Platform.OS !== 'web';

/**
 * A bottom sheet: slides up over a dimmed page, closes by the handle (drag down), the backdrop or the
 * close button. `footer` holds its one primary action, kept above the keyboard.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, scroll = true, full }: {
  open: boolean; onClose: () => void; title?: string; subtitle?: string; children: ReactNode; footer?: ReactNode; scroll?: boolean;
  /** Take most of the screen (lists with search). */
  full?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const offset = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (open) {
      closing.current = false;
      setMounted(true);
      offset.setValue(height);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: theme.motion.slow, useNativeDriver: native }),
        Animated.spring(offset, { toValue: 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: native }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: theme.motion.base, useNativeDriver: native }),
        Animated.timing(offset, { toValue: height, duration: theme.motion.slow, easing: Easing.in(Easing.cubic), useNativeDriver: native }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dismiss = () => { if (!closing.current) { closing.current = true; onClose(); } };
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => { if (gesture.dy > 0) offset.setValue(gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 120 || gesture.vy > 0.9) dismiss();
      else Animated.spring(offset, { toValue: 0, damping: 24, stiffness: 280, useNativeDriver: native }).start();
    },
  })).current;

  if (!mounted) return null;
  const body = scroll
    ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.space(4), paddingBottom: theme.space(4), gap: theme.space(3) }}>{children}</ScrollView>
    : <View style={{ flexShrink: 1, flexGrow: full ? 1 : 0, paddingHorizontal: theme.space(4), paddingBottom: theme.space(2), gap: theme.space(3) }}>{children}</View>;
  return <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.overlay, opacity: fade }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} style={{ flex: 1 }} onPress={dismiss} />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={{
        maxHeight: height - insets.top - theme.space(4), height: full ? height - insets.top - theme.space(4) : undefined,
        width: '100%', maxWidth: 640, alignSelf: 'center',
        backgroundColor: theme.colors.surface, borderTopStartRadius: theme.radius.lg + 4, borderTopEndRadius: theme.radius.lg + 4,
        transform: [{ translateY: offset }], paddingBottom: footer ? 0 : Math.max(insets.bottom, theme.space(4)),
      }}>
        <View {...drag.panHandlers} style={{ paddingTop: theme.space(2), paddingBottom: title ? theme.space(1) : theme.space(3) }}>
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.borderStrong }} />
          {title ? <Row style={{ paddingStart: theme.space(4), paddingEnd: theme.space(2), paddingTop: theme.space(2), justifyContent: 'space-between' }} align="flex-start">
            <View style={{ flex: 1, gap: 2, paddingTop: theme.space(2) }}>
              <Text variant="heading" accessibilityRole="header" numberOfLines={2}>{title}</Text>
              {subtitle ? <Text variant="caption" tone="secondary" numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            <IconButton icon={X} label={t('Close')} onPress={dismiss} />
          </Row> : null}
        </View>
        {body}
        {footer ? <View style={{ paddingHorizontal: theme.space(4), paddingTop: theme.space(3), paddingBottom: Math.max(insets.bottom, theme.space(4)), gap: theme.space(2), borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider }}>{footer}</View> : null}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}
