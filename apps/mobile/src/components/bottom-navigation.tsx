import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Text, tokens, useTheme } from '../design-system';
import { Icon } from './icon';

export const homeTabs = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'create', label: 'Create', icon: 'plus' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
] as const;
export type HomeTab = typeof homeTabs[number]['id'];

function ActivePill() {
  const id = useId().replace(/:/g, '');
  return <Svg width="100%" height="100%" aria-hidden focusable={false}>
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0.7">
        <Stop offset="0" stopColor={tokens.brand.lilac} />
        <Stop offset="0.48" stopColor={tokens.brand.rose} />
        <Stop offset="1" stopColor={tokens.brand.peach} />
      </LinearGradient>
    </Defs>
    <Rect width="100%" height="100%" rx="25" fill={`url(#${id})`} />
  </Svg>;
}

/** Selected destinations expand into a labelled pill; Create stays icon-only. */
export function BottomNavigation({ activeTab, onTabChange }: { activeTab: HomeTab; onTabChange: (tab: HomeTab) => void }) {
  const { direction } = useTheme();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gutter = Math.min(20, Math.max(8, (windowWidth - insets.left - insets.right - 304) / 2));
  const [trackWidth, setTrackWidth] = useState(0);
  const [focused, setFocused] = useState<HomeTab | null>(null);
  const refs = useRef<Array<View | null>>([]);
  const activeIndex = Math.max(0, homeTabs.findIndex((tab) => tab.id === activeTab));
  const compact = trackWidth < 310 || fontScale > 1.2;
  const height = Math.max(50, compact ? 28 + Math.ceil(14 * fontScale) + 8 : 50);
  const desiredWidth = activeTab === 'create' ? 50 : compact ? 104 : 56 + homeTabs[activeIndex].label.length * 7;
  const activeWidth = Math.max(48, Math.min(desiredWidth, trackWidth - 4 * 48));
  const inactiveWidth = Math.max(48, (trackWidth - activeWidth) / 4);
  const targetWidths = homeTabs.map((_, index) => index === activeIndex ? activeWidth : inactiveWidth);
  const rtl = direction === 'rtl';

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const forward = rtl ? -1 : 1;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + forward + homeTabs.length) % homeTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - forward + homeTabs.length) % homeTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = homeTabs.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
    onTabChange(homeTabs[next].id);
  };

  return <View style={[styles.container, { paddingHorizontal: gutter }]}>
    <View testID="bottom-navigation" role="tablist" accessibilityLabel="Main navigation" style={styles.pill}>
      <View onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)} style={{ height }}>
        <View style={[styles.tabs, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          {homeTabs.map((tab, index) => {
            const active = tab.id === activeTab;
            const showLabel = active && tab.id !== 'create';
            return <View key={tab.id} style={{ width: targetWidths[index], height }}>
              <Pressable ref={(ref) => { refs.current[index] = ref; }} testID={`nav-${tab.id}`}
                accessibilityRole="tab" accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }} aria-selected={active}
                {...(Platform.OS === 'web' ? { tabIndex: active ? 0 : -1,
                  onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, index), 'aria-controls': 'home-tab-panel' } : {})}
                onFocus={() => setFocused(tab.id)} onBlur={() => setFocused(null)} onPress={() => onTabChange(tab.id)}
                style={({ pressed }) => [styles.tab, { flexDirection: showLabel && compact ? 'column' : rtl ? 'row-reverse' : 'row', gap: compact ? 2 : 7 },
                  focused === tab.id && styles.focused, pressed && styles.pressed]}>
                {active && <View testID="navigation-indicator" pointerEvents="none" style={styles.indicator}><ActivePill /></View>}
                <Icon name={tab.icon} size={22} color={active ? tokens.brand.ink : '#e1d8e1'} />
                {showLabel && <View pointerEvents="none" style={{ flexShrink: 1 }}>
                  <Text weight="medium" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
                    style={[styles.label, { fontSize: compact ? 11 : 12, lineHeight: compact ? 14 : 18 }]}>{tab.label}</Text>
                </View>}
              </Pressable>
            </View>;
          })}
        </View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  pill: { width: '100%', maxWidth: 392, padding: 7, borderRadius: 999, backgroundColor: tokens.brand.ink,
    borderWidth: 1, borderColor: '#443541', boxShadow: '0px 8px 24px rgba(47,35,45,0.16)' },
  indicator: { ...StyleSheet.absoluteFillObject, borderRadius: 999, overflow: 'hidden' },
  tabs: { ...StyleSheet.absoluteFillObject },
  tab: { flex: 1, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 999,
    borderWidth: 1.5, borderColor: 'transparent', overflow: 'hidden',
    ...(Platform.OS === 'web' && { outlineStyle: 'solid', outlineWidth: 0, outlineColor: 'transparent' }) },
  label: { color: tokens.brand.ink, textAlign: 'center' },
  focused: { borderColor: '#fff5ff' },
  pressed: { opacity: 0.7 },
});
