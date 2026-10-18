import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { haptic } from '../core/haptics';
import { Text } from './primitives';
import { useTheme } from './theme';

export type SwipeAction = { label: string; icon: LucideIcon; tone: 'success' | 'warning' | 'info' | 'action'; onPress: () => void };

const native = Platform.OS !== 'web';
/** How far a row travels before letting go runs its action. */
export const SWIPE_THRESHOLD = 96;

/**
 * A row that acts when swiped: dragged towards the inline end it runs `start` (revealed at the start edge),
 * dragged towards the inline start it runs `end`. The gesture follows the layout direction, so right-to-left
 * mirrors it. A short drag springs back; past the threshold the phone ticks once and letting go runs the action.
 * Vertical scrolling keeps working: only a clearly horizontal drag is taken. Every swipe action must also be
 * reachable another way (the row's long-press menu), for screen readers and the web.
 */
export function SwipeRow({ children, start, end }: { children: ReactNode; start?: SwipeAction | null; end?: SwipeAction | null }) {
  const theme = useTheme();
  const offset = useRef(new Animated.Value(0)).current;
  const [side, setSide] = useState<'start' | 'end' | null>(null);
  const shown = useRef<'start' | 'end' | null>(null);
  const armed = useRef(false);
  const latest = useRef({ start, end, rtl: theme.rtl });
  latest.current = { start, end, rtl: theme.rtl };

  const responder = useMemo(() => {
    // The side a horizontal movement reveals: towards the end uncovers the start edge.
    const sideFor = (dx: number) => ((latest.current.rtl ? -dx : dx) > 0 ? 'start' : 'end');
    const actionFor = (dx: number) => latest.current[sideFor(dx)] ?? null;
    const reveal = (next: 'start' | 'end' | null) => { if (shown.current !== next) { shown.current = next; setSide(next); } };
    const settle = () => {
      armed.current = false;
      Animated.spring(offset, { toValue: 0, damping: 22, stiffness: 260, useNativeDriver: native }).start(() => reveal(null));
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 && !!actionFor(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        if (!actionFor(gesture.dx)) { offset.setValue(0); reveal(null); return; }
        reveal(sideFor(gesture.dx));
        offset.setValue(gesture.dx);
        const past = Math.abs(gesture.dx) >= SWIPE_THRESHOLD;
        if (past !== armed.current) { armed.current = past; if (past) haptic.tap(); }
      },
      onPanResponderRelease: (_, gesture) => {
        const action = armed.current ? actionFor(gesture.dx) : null;
        settle();
        action?.onPress();
      },
      onPanResponderTerminate: settle,
    });
  }, [offset]);

  const action = side ? (side === 'start' ? start : end) : null;
  const palette = action ? {
    success: [theme.colors.successSubtle, theme.colors.success], warning: [theme.colors.warningSubtle, theme.colors.warning],
    info: [theme.colors.infoSubtle, theme.colors.info], action: [theme.colors.actionPrimarySubtle, theme.colors.actionPrimary],
  }[action.tone] : null;
  const Icon = action?.icon;
  return <View>
    {action && palette && Icon ? <View accessible={false} importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', justifyContent: side === 'start' ? 'flex-start' : 'flex-end',
        gap: theme.space(2), paddingHorizontal: theme.space(5), backgroundColor: palette[0] }}>
      <Icon color={palette[1]} size={18} strokeWidth={2} />
      <Text variant="label" style={{ color: palette[1] }} numberOfLines={1}>{action.label}</Text>
    </View> : null}
    <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: offset }], backgroundColor: theme.colors.surface }}>{children}</Animated.View>
  </View>;
}
