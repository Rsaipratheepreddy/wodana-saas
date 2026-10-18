import { Pressable, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CircleUserRound, House, Inbox, LayoutGrid, Plus, type LucideIcon } from 'lucide-react-native';
import { haptic } from '../../core/haptics';
import { key, useT } from '../../core/i18n';
import { Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { useInbox } from '../inbox/api';
import { useCapture } from './capture-sheet';

const TABS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: key('Today'), icon: House },
  work: { label: key('Work'), icon: LayoutGrid },
  capture: { label: key('Capture'), icon: Plus },
  inbox: { label: key('Inbox'), icon: Inbox },
  me: { label: key('Me'), icon: CircleUserRound },
};

/** Today · Work · + · Inbox · Me, reachable with one thumb; the + opens the capture sheet. */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();
  const t = useT();
  const capture = useCapture();
  const inbox = useInbox();
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: Math.max(insets.bottom, theme.space(2)), paddingTop: theme.space(1.5),
    paddingHorizontal: theme.space(2), backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider }}>
    {state.routes.map((route, index) => {
      const tab = TABS[route.name];
      if (!tab) return null;
      const focused = state.index === index;
      if (route.name === 'capture') {
        return <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(tab.label)} onPress={() => { haptic.impact(); capture.open(); }}
            style={({ pressed }) => ({ width: 56, height: 44, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? theme.colors.actionPrimaryPressed : theme.colors.actionPrimary })}>
            <Plus color={theme.colors.actionOnPrimary} size={26} strokeWidth={2.2} />
          </Pressable>
        </View>;
      }
      const Icon = tab.icon;
      const badge = route.name === 'inbox' && inbox.unread ? inbox.unread : 0;
      const colour = focused ? theme.colors.actionPrimary : theme.colors.textTertiary;
      return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={badge ? `${t(tab.label)}, ${badge}` : t(tab.label)}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) { haptic.tap(); navigation.navigate(route.name, route.params); }
        }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, gap: 2 }}>
        <View>
          <Icon color={colour} size={24} strokeWidth={focused ? 2.2 : 1.8} />
          {badge ? <View style={{ position: 'absolute', top: -4, end: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: theme.colors.dangerSolid, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.colors.surface }}>
            <Text style={{ color: theme.colors.onDanger, fontSize: 10, lineHeight: 12, fontFamily: theme.font.semibold }}>{badge > 99 ? '99+' : badge}</Text>
          </View> : null}
        </View>
        <Text style={{ fontSize: theme.size['2xs'], lineHeight: 14, fontFamily: focused ? theme.font.semibold : theme.font.medium, color: colour }}>{t(tab.label)}</Text>
      </Pressable>;
    })}
  </View>;
}
