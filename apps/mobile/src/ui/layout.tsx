import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View, type ListRenderItemInfo, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, type LucideIcon } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { haptic } from '../core/haptics';
import { Button, IconBadge, IconButton, Row, Text } from './primitives';
import { useTheme } from './theme';

type HeaderProps = {
  /** The one title of the view. */
  title?: string;
  /** One quiet line under the title (a record's code, a date). */
  subtitle?: string;
  /** Top-level tab screens use the large title. */
  large?: boolean;
  /** A pushed screen shows the way back. */
  back?: boolean;
  /** At most one action at the top end (an icon button or a menu). */
  action?: ReactNode;
  /** Something that sits under the title: a status chip, a segmented control or a search field. */
  below?: ReactNode;
};

function Header({ title, subtitle, large, back, action, below }: HeaderProps) {
  const theme = useTheme();
  const t = useT();
  const router = useRouter();
  if (!title && !back && !action) return below ? <>{below}</> : null;
  return <View style={{ gap: theme.space(2), paddingBottom: theme.space(1) }}>
    {back ? <Row style={{ justifyContent: 'space-between', marginStart: -theme.space(3), marginEnd: -theme.space(2) }}>
      <IconButton icon={ChevronLeft} directional label={t('Back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {action}
    </Row> : null}
    {title ? <Row align="flex-end" style={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={large ? 'display' : 'title'} accessibilityRole="header" numberOfLines={3}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="secondary" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {back ? null : action}
    </Row> : null}
    {below}
  </View>;
}

/**
 * A screen: its title (one per screen) with at most one action beside it, then its content, scrolling
 * with pull-to-refresh when given, and a sticky footer for the screen's primary action.
 */
export function Screen({ children, onRefresh, refreshing = false, scroll = true, footer, keyboard, ...header }: HeaderProps & {
  children: ReactNode; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean; footer?: ReactNode; keyboard?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Without its own scroll (a chat thread), the content fills the screen and scrolls inside.
  const body = <View style={{ flex: scroll ? undefined : 1, paddingHorizontal: theme.space(4), gap: theme.space(4), paddingBottom: theme.space(footer ? 6 : 10) }}>
    <Header {...header} />
    {children}
  </View>;
  const content = scroll
    ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + theme.space(header.back ? 1 : 4) }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => { haptic.refresh(); onRefresh(); }} tintColor={theme.colors.textTertiary} colors={[theme.colors.actionPrimary]} progressViewOffset={insets.top} /> : undefined}>
      {body}
    </ScrollView>
    : <View style={{ flex: 1, paddingTop: insets.top + theme.space(header.back ? 1 : 4) }}>{body}</View>;
  const bar = footer ? <View style={{ paddingHorizontal: theme.space(4), paddingTop: theme.space(3), paddingBottom: Math.max(insets.bottom, theme.space(3)), borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider, backgroundColor: theme.colors.surface, gap: theme.space(2) }}>{footer}</View> : null;
  const page = <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>{content}{bar}</View>;
  return keyboard || footer
    ? <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{page}</KeyboardAvoidingView>
    : page;
}

/**
 * A long list on one surface, virtualised: the header, an optional toolbar (search, filters), then rows.
 * Loading, failure and empty states replace the rows.
 */
export function ListScreen<T>({ items, renderItem, keyExtractor, toolbar, empty, loading, error, onRetry, onRefresh, refreshing = false, onEndReached, loadingMore, footer, groupBy, ...header }: HeaderProps & {
  items: T[] | undefined;
  renderItem: (item: T, index: number, first: boolean) => ReactElement;
  keyExtractor: (item: T) => string;
  toolbar?: ReactNode;
  empty: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onEndReached?: () => void;
  /** The next page is on its way (shown under the rows). */
  loadingMore?: boolean;
  footer?: ReactNode;
  /** Splits the list into titled groups (e.g. "Today", "Earlier"); consecutive items with the same group share a surface. */
  groupBy?: (item: T) => string;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const list = items ?? [];
  const group = (index: number) => (groupBy && list[index] !== undefined ? groupBy(list[index]) : '');
  const renderRow = ({ item, index }: ListRenderItemInfo<T>) => {
    const first = index === 0 || group(index - 1) !== group(index);
    const last = index === list.length - 1 || group(index + 1) !== group(index);
    return <View style={{ paddingHorizontal: theme.space(4) }}>
      {first && groupBy ? <Text variant="overline" tone="secondary" accessibilityRole="header" style={{ paddingHorizontal: theme.space(1), paddingTop: index === 0 ? 0 : theme.space(5), paddingBottom: theme.space(2) }}>{group(index)}</Text> : null}
      <View style={{
        backgroundColor: theme.colors.surface, borderColor: theme.colors.structuralDivider, borderStartWidth: 1, borderEndWidth: 1,
        borderTopWidth: first ? 1 : 0, borderBottomWidth: last ? 1 : 0, overflow: 'hidden',
        borderTopStartRadius: first ? theme.radius.lg : 0, borderTopEndRadius: first ? theme.radius.lg : 0,
        borderBottomStartRadius: last ? theme.radius.lg : 0, borderBottomEndRadius: last ? theme.radius.lg : 0,
      }}>{renderItem(item, index, first)}</View>
    </View>;
  };
  const state = <View style={{ paddingHorizontal: loading ? theme.space(4) : 0 }}>
    {loading ? <Loading /> : error ? <Failure message={error} onRetry={onRetry} /> : empty}
  </View>;
  return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
    <FlatList
      data={loading || error ? [] : list}
      renderItem={renderRow}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingTop: insets.top + theme.space(header.back ? 1 : 4), paddingBottom: theme.space(footer ? 6 : 10) }}
      ListHeaderComponent={<View style={{ paddingHorizontal: theme.space(4), gap: theme.space(3), paddingBottom: theme.space(4) }}><Header {...header} />{toolbar}</View>}
      ListEmptyComponent={state}
      ListFooterComponent={loadingMore && list.length ? <View accessibilityRole="progressbar" accessibilityLabel={t('Loading')} style={{ paddingVertical: theme.space(4) }}><ActivityIndicator color={theme.colors.textTertiary} /></View> : null}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={() => { haptic.refresh(); onRefresh(); }} tintColor={theme.colors.textTertiary} colors={[theme.colors.actionPrimary]} progressViewOffset={insets.top} /> : undefined}
    />
    {footer ? <View style={{ paddingHorizontal: theme.space(4), paddingTop: theme.space(3), paddingBottom: Math.max(insets.bottom, theme.space(3)), borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider, backgroundColor: theme.colors.surface }}>{footer}</View> : null}
  </View>;
}

/** A group of rows on one surface, with an optional heading and one action. */
export function Section({ title, action, children, style, flat }: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle>; flat?: boolean }) {
  const theme = useTheme();
  return <View style={[{ gap: theme.space(2) }, style]}>
    {title || action ? <Row style={{ justifyContent: 'space-between', paddingHorizontal: theme.space(1), minHeight: 28 }}>
      {title ? <Text variant="overline" tone="secondary" accessibilityRole="header">{title}</Text> : <View />}
      {action}
    </Row> : null}
    {flat ? children : <View style={{ borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.structuralDivider, overflow: 'hidden' }}>{children}</View>}
  </View>;
}

/** One row: what it is, a line of detail, and what's at the end (a status, a value, or a chevron when it opens something). */
export function ListRow({ title, detail, meta, leading, trailing, icon, iconTone, onPress, onLongPress, first, danger, accessibilityLabel, disabled }: {
  title: string; detail?: string | ReactNode; meta?: ReactNode; leading?: ReactNode; trailing?: ReactNode; icon?: LucideIcon; iconTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'action';
  onPress?: () => void; onLongPress?: () => void; first?: boolean; danger?: boolean; accessibilityLabel?: string; disabled?: boolean;
}) {
  const theme = useTheme();
  const main = <>
    {leading ?? (icon ? <IconBadge icon={icon} tone={danger ? 'danger' : iconTone} /> : null)}
    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
      <Text variant="label" tone={danger ? 'danger' : 'default'} numberOfLines={2}>{title}</Text>
      {typeof detail === 'string' ? detail ? <Text variant="caption" tone="secondary" numberOfLines={2}>{detail}</Text> : null : detail}
      {meta}
    </View>
  </>;
  const content = <>
    {main}
    {trailing}
    {onPress && !trailing ? <View style={{ transform: [{ scaleX: theme.rtl ? -1 : 1 }] }}><ChevronRight color={theme.colors.iconSubtle} size={18} /></View> : null}
  </>;
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 60, paddingHorizontal: theme.space(4), paddingVertical: theme.space(3),
    borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.structuralDivider, opacity: disabled ? 0.5 : 1 };
  // QA-013: a trailing control (a button) sits beside the row's own press area, never inside it: a button can't hold a button.
  if ((onPress || onLongPress) && trailing) return <View style={[style, { paddingStart: 0, paddingVertical: 0 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 60, paddingStart: theme.space(4), paddingVertical: theme.space(3),
        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' }]}>{main}</Pressable>
    {trailing}
  </View>;
  return onPress || onLongPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [style, { backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' }]}>{content}</Pressable>
    : <View style={style}>{content}</View>;
}

/** A card for one record or summary on a screen. */
export function Card({ children, onPress, style, tone }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; tone?: 'default' | 'muted' | 'action' }) {
  const theme = useTheme();
  const base: ViewStyle = {
    borderRadius: theme.radius.lg, borderWidth: 1, padding: theme.space(4), gap: theme.space(2),
    backgroundColor: tone === 'muted' ? theme.colors.surfaceMuted : tone === 'action' ? theme.colors.actionPrimarySubtle : theme.colors.surface,
    borderColor: tone === 'muted' || tone === 'action' ? 'transparent' : theme.colors.structuralDivider,
  };
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed ? { opacity: 0.85 } : null, style]}>{children}</Pressable>
    : <View style={[base, style]}>{children}</View>;
}

/** A label and its value, stacked; for facts on a record. */
export function Fact({ label, value, first }: { label: string; value: ReactNode; first?: boolean }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space(3), paddingHorizontal: theme.space(4), paddingVertical: theme.space(3), borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.structuralDivider }}>
    <Text variant="caption" tone="secondary" style={{ flexShrink: 0, maxWidth: '45%' }}>{label}</Text>
    {/* The value sits at the row's end in either direction. */}
    <View style={{ flex: 1, alignItems: 'flex-end' }}>{typeof value === 'string' || typeof value === 'number' ? <Text variant="label" numberOfLines={3}>{value}</Text> : value}</View>
  </View>;
}

/** A one-line notice in the flow of the page: pending captures, a blocked save, being offline. */
export function Banner({ tone = 'info', title, detail, action, icon }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; title: string; detail?: string; action?: { label: string; onPress: () => void }; icon?: LucideIcon }) {
  const theme = useTheme();
  const palette = {
    info: [theme.colors.infoSubtle, theme.colors.info], warning: [theme.colors.warningSubtle, theme.colors.warning], danger: [theme.colors.dangerSubtle, theme.colors.danger],
    success: [theme.colors.successSubtle, theme.colors.success], neutral: [theme.colors.surfaceMuted, theme.colors.textSecondary],
  }[tone];
  const Icon = icon ?? (tone === 'danger' || tone === 'warning' ? AlertTriangle : Info);
  return <View accessibilityRole={tone === 'danger' ? 'alert' : undefined} style={{ flexDirection: 'row', gap: theme.space(3), alignItems: 'center', padding: theme.space(3), paddingStart: theme.space(4), borderRadius: theme.radius.md, backgroundColor: palette[0] }}>
    <Icon color={palette[1]} size={18} strokeWidth={2} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="label" style={{ color: palette[1] }}>{title}</Text>
      {detail ? <Text variant="caption" tone="secondary">{detail}</Text> : null}
    </View>
    {action ? <Button size="sm" variant="ghost" label={action.label} onPress={action.onPress} /> : null}
  </View>;
}

/**
 * The loading shimmer: soft blocks with one light sweep crossing them, after a short pause so a quick
 * load never flashes.
 */
export function Shimmer({ width = '100%', height = 12, radius, style }: { width?: ViewStyle['width']; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-240, 240] });
  return <View style={[{ width, height, borderRadius: radius ?? theme.radius.xs, backgroundColor: theme.colors.surfaceMuted, overflow: 'hidden' }, style]} accessible={false}>
    <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: 200, transform: [{ translateX }] }}>
      <LinearGradient colors={['transparent', theme.colors.skeletonSheen, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
    </Animated.View>
  </View>;
}

/** A placeholder shaped like what's coming: rows (default), cards, a form or a record's header. */
export function Loading({ shape = 'rows', count = 5 }: { shape?: 'rows' | 'cards' | 'form' | 'record'; count?: number }) {
  const theme = useTheme();
  const t = useT();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(opacity, { toValue: 1, duration: 240, delay: 120, useNativeDriver: Platform.OS !== 'web' }).start(); }, [opacity]);
  const widths = ['62%', '48%', '71%', '55%', '66%', '44%', '58%'] as const;
  const surface: ViewStyle = { borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.structuralDivider, backgroundColor: theme.colors.surface };
  return <Animated.View accessibilityRole="progressbar" accessibilityLabel={t('Loading')} style={{ opacity, gap: theme.space(3) }}>
    {shape === 'record' ? <View style={{ gap: theme.space(3) }}>
      <Shimmer width="70%" height={22} /><Shimmer width="40%" height={12} />
      <View style={[surface, { padding: theme.space(4), gap: theme.space(3) }]}><Shimmer width="30%" height={10} /><Shimmer height={8} radius={theme.radius.pill} /><Shimmer width="55%" height={10} /></View>
    </View> : null}
    {shape === 'rows' || shape === 'record' ? <View style={surface}>
      {Array.from({ length: count }, (_, index) => <Row key={index} gap={3} style={{ paddingHorizontal: theme.space(4), paddingVertical: theme.space(4), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <Shimmer width={36} height={36} radius={theme.radius.md} />
        <View style={{ flex: 1, gap: theme.space(2) }}><Shimmer width={widths[index % widths.length]} height={12} /><Shimmer width={widths[(index + 3) % widths.length]} height={9} /></View>
        <Shimmer width={56} height={20} radius={theme.radius.pill} />
      </Row>)}
    </View> : shape === 'cards' ? Array.from({ length: count }, (_, index) => <View key={index} style={[surface, { padding: theme.space(4), gap: theme.space(3) }]}>
      <Shimmer width={widths[index % widths.length]} height={14} /><Shimmer width="90%" height={10} /><Shimmer width={widths[(index + 2) % widths.length]} height={10} />
    </View>) : shape === 'form' ? Array.from({ length: count }, (_, index) => <View key={index} style={{ gap: theme.space(2) }}><Shimmer width={96 + (index * 37) % 60} height={10} /><Shimmer height={48} radius={theme.radius.md} /></View>) : null}
  </Animated.View>;
}

/** Nothing here yet: one sentence and, when there is one, the next action. */
export function Empty({ icon, title, detail, action }: { icon?: LucideIcon; title: string; detail?: string; action?: { label: string; onPress: () => void } }) {
  const theme = useTheme();
  return <View style={{ alignItems: 'center', gap: theme.space(3), paddingVertical: theme.space(10), paddingHorizontal: theme.space(6) }}>
    {icon ? <IconBadge icon={icon} size={56} /> : null}
    <Text variant="subheading" style={{ textAlign: 'center' }}>{title}</Text>
    {detail ? <Text variant="caption" tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>{detail}</Text> : null}
    {action ? <Button label={action.label} onPress={action.onPress} variant="primary" /> : null}
  </View>;
}

/** Something failed: what happened, and try again. */
export function Failure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  const theme = useTheme();
  return <View accessibilityRole="alert" style={{ alignItems: 'center', gap: theme.space(3), paddingVertical: theme.space(8), paddingHorizontal: theme.space(6) }}>
    <IconBadge icon={AlertTriangle} tone="warning" size={56} />
    <Text variant="subheading" style={{ textAlign: 'center' }}>{t('Something went wrong')}</Text>
    <Text variant="caption" tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>{message}</Text>
    {onRetry ? <Button label={t('Try again')} onPress={onRetry} /> : null}
  </View>;
}

/** A thin progress bar (0–1) with its value spoken. */
export function Progress({ value, tone = 'action', label }: { value: number; tone?: 'action' | 'success' | 'warning' | 'danger'; label?: string }) {
  const theme = useTheme();
  const colour = { action: theme.colors.actionPrimary, success: theme.colors.success, warning: theme.colors.warning, danger: theme.colors.danger }[tone];
  const share = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
    style={{ height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceMuted, overflow: 'hidden' }}>
    <View style={{ width: `${share * 100}%`, height: '100%', borderRadius: theme.radius.pill, backgroundColor: colour }} />
  </View>;
}
