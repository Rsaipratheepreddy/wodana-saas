import { useRef, type KeyboardEvent } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { Icon } from './icon';

// Global destinations are real screens backed by tenant-scoped APIs.
export const homeTabs = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'notifications', label: 'Updates', icon: 'bell' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
] as const;
export type HomeTab = typeof homeTabs[number]['id'];

export function BottomNavigation({ activeTab, onTabChange }: { activeTab: HomeTab; onTabChange: (tab: HomeTab) => void }) {
  const { colors, direction } = useTheme();
  const refs = useRef<Array<View | null>>([]);
  const rtl = direction === 'rtl';
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const forward = rtl ? -1 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? homeTabs.length - 1
      : event.key === 'ArrowRight' ? (index + forward + homeTabs.length) % homeTabs.length
        : event.key === 'ArrowLeft' ? (index - forward + homeTabs.length) % homeTabs.length : -1;
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onTabChange(homeTabs[next].id);
  };

  return <View testID="bottom-navigation" role="tablist" accessibilityLabel="Main navigation"
    style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border,
      flexDirection: rtl ? 'row-reverse' : 'row' }]}>
    {homeTabs.map((tab, index) => {
      const active = tab.id === activeTab;
      return <Pressable key={tab.id} ref={(ref) => { refs.current[index] = ref; }} testID={`nav-${tab.id}`}
        accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} aria-selected={active}
        {...(Platform.OS === 'web' ? { tabIndex: active ? 0 : -1,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, index), 'aria-controls': 'home-tab-panel' } : {})}
        onPress={() => onTabChange(tab.id)}
        style={({ pressed }) => [styles.tab, { backgroundColor: active ? colors.navigationSelected : pressed ? colors.surfacePressed : 'transparent' }]}>
        <Icon name={tab.icon} size={20} color={active ? colors.actionPrimary : colors.icon} />
        <Text size="sm" weight={active ? 'semibold' : 'medium'} style={{ color: active ? colors.text : colors.textSecondary }}>
          {tab.label}
        </Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  container: { minHeight: 62, padding: 6, borderWidth: 1, borderRadius: 16, gap: 6 },
  tab: { flex: 1, minHeight: 48, borderRadius: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
