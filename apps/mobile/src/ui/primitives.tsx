import type { LucideIcon } from 'lucide-react-native';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text as NativeText, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { haptic } from '../core/haptics';
import { useStyles, useTheme, type Theme } from './theme';

type Variant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption' | 'overline' | 'number';
type Tone = 'default' | 'secondary' | 'tertiary' | 'inverse' | 'action' | 'danger' | 'success' | 'warning' | 'info';

const variants = (t: Theme): Record<Variant, TextStyle> => ({
  display: { fontFamily: t.font.semibold, fontSize: t.size['3xl'], lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: t.font.semibold, fontSize: t.size['2xl'], lineHeight: 30, letterSpacing: -0.4 },
  heading: { fontFamily: t.font.semibold, fontSize: t.size.xl, lineHeight: 26, letterSpacing: -0.2 },
  subheading: { fontFamily: t.font.semibold, fontSize: t.size.lg, lineHeight: 22 },
  body: { fontFamily: t.font.regular, fontSize: t.size.lg, lineHeight: 22 },
  label: { fontFamily: t.font.medium, fontSize: t.size.md, lineHeight: 20 },
  caption: { fontFamily: t.font.regular, fontSize: t.size.sm, lineHeight: 18 },
  overline: { fontFamily: t.font.semibold, fontSize: t.size.xs, lineHeight: 16, letterSpacing: 0.4, textTransform: 'uppercase' },
  number: { fontFamily: t.font.semibold, fontSize: t.size.xl, lineHeight: 26, fontVariant: ['tabular-nums'] },
});
const tones = (t: Theme): Record<Tone, string> => ({
  default: t.colors.text, secondary: t.colors.textSecondary, tertiary: t.colors.textTertiary, inverse: t.colors.textInverse,
  action: t.colors.actionPrimary, danger: t.colors.danger, success: t.colors.success, warning: t.colors.warning, info: t.colors.info,
});

export function Text({ variant = 'body', tone = 'default', style, ...props }: ComponentProps<typeof NativeText> & { variant?: Variant; tone?: Tone }) {
  const theme = useTheme();
  const styles = useStyles(variants);
  return <NativeText maxFontSizeMultiplier={1.6} {...props} style={[styles[variant], { color: tones(theme)[tone], textAlign: 'auto' }, style]} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** A button: one primary action per screen; labels are verbs ("Check in", "Send"). */
export function Button({ label, onPress, variant = 'secondary', icon: Icon, loading, disabled, size = 'md', full, pill, accessibilityLabel, testID }: {
  label: string; onPress: () => void; variant?: ButtonVariant; icon?: LucideIcon; loading?: boolean; disabled?: boolean;
  size?: 'sm' | 'md' | 'lg'; full?: boolean; pill?: boolean; accessibilityLabel?: string; testID?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const palette: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border: string }> = {
    primary: { bg: c.actionPrimary, pressed: c.actionPrimaryPressed, fg: c.actionOnPrimary, border: c.actionPrimary },
    secondary: { bg: c.surface, pressed: c.surfacePressed, fg: c.text, border: c.borderControl },
    ghost: { bg: 'transparent', pressed: c.surfacePressed, fg: c.text, border: 'transparent' },
    danger: { bg: c.dangerSolid, pressed: c.danger, fg: c.onDanger, border: c.dangerSolid },
  };
  const tone = palette[variant];
  const off = disabled || loading;
  const height = size === 'sm' ? 36 : size === 'lg' ? theme.touch.large : theme.touch.control;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off}
    hitSlop={size === 'sm' ? 4 : 0}
    onPress={() => { haptic.tap(); onPress(); }}
    style={({ pressed }) => ({
      minHeight: height, paddingHorizontal: theme.space(size === 'sm' ? 3 : size === 'lg' ? 6 : 4), borderRadius: pill ? theme.radius.pill : theme.radius.md, borderWidth: 1,
      borderColor: tone.border, backgroundColor: pressed ? tone.pressed : tone.bg, opacity: off && !loading ? 0.45 : 1,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space(2), alignSelf: full ? 'stretch' : 'auto',
    })}>
    {loading ? <ActivityIndicator color={tone.fg} /> : Icon ? <Icon color={tone.fg} size={size === 'sm' ? 16 : 18} strokeWidth={2} /> : null}
    <Text variant="label" style={{ color: tone.fg, fontFamily: theme.font.semibold, fontSize: size === 'lg' ? theme.size.lg : theme.size.md }} numberOfLines={1}>{label}</Text>
  </Pressable>;
}

/** An icon-only control with a spoken label; at least 44pt to touch. */
export function IconButton({ icon: Icon, label, onPress, tone = 'default', badge, filled, disabled, size = 44, directional }: {
  icon: LucideIcon; label: string; onPress: () => void; tone?: 'default' | 'action' | 'inverse' | 'danger'; badge?: number; filled?: boolean; disabled?: boolean; size?: number;
  /** Mirror the icon in right-to-left layouts (arrows and chevrons that point the way). */
  directional?: boolean;
}) {
  const theme = useTheme();
  const color = tone === 'action' ? (filled ? theme.colors.actionOnPrimary : theme.colors.actionPrimary)
    : tone === 'inverse' ? '#ffffff' : tone === 'danger' ? theme.colors.danger : theme.colors.icon;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} hitSlop={Math.max(0, (44 - size) / 2)} disabled={disabled}
    onPress={() => { haptic.tap(); onPress(); }}
    style={({ pressed }) => ({
      width: size, height: size, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1,
      backgroundColor: filled ? (tone === 'action' ? (pressed ? theme.colors.actionPrimaryPressed : theme.colors.actionPrimary) : tone === 'inverse' ? 'rgba(0,0,0,0.45)' : (pressed ? theme.colors.surfacePressed : theme.colors.surfaceMuted))
        : pressed ? theme.colors.surfacePressed : 'transparent',
    })}>
    <View style={directional ? { transform: [{ scaleX: theme.rtl ? -1 : 1 }] } : undefined}><Icon color={color} size={Math.round(size / 2)} strokeWidth={1.9} /></View>
    {badge ? <View style={{ position: 'absolute', top: 4, end: 2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: theme.colors.dangerSolid, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.colors.onDanger, fontSize: theme.size['2xs'], lineHeight: 14, fontFamily: theme.font.semibold }}>{badge > 99 ? '99+' : badge}</Text>
    </View> : null}
  </Pressable>;
}

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'action';
/** A status in one or two words; colour supports the words, never replaces them. */
export function Chip({ label, tone = 'neutral', icon: Icon, onPress, selected }: { label: string; tone?: ChipTone; icon?: LucideIcon; onPress?: () => void; selected?: boolean }) {
  const { colors, space, radius, font, size } = useTheme();
  const palette: Record<ChipTone, [string, string]> = {
    neutral: [colors.surfaceMuted, colors.textSecondary], info: [colors.infoSubtle, colors.info], success: [colors.successSubtle, colors.success],
    warning: [colors.warningSubtle, colors.warning], danger: [colors.dangerSubtle, colors.danger], action: [colors.actionPrimarySubtle, colors.actionPrimary],
  };
  const [bg, fg] = selected ? [colors.actionPrimary, colors.actionOnPrimary] : palette[tone];
  const body = <>
    {Icon ? <Icon color={fg} size={12} strokeWidth={2.2} /> : null}
    <Text style={{ color: fg, fontFamily: font.medium, fontSize: size.xs, lineHeight: 16 }} numberOfLines={1}>{label}</Text>
  </>;
  const style: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space(1), alignSelf: 'flex-start', paddingHorizontal: space(2), paddingVertical: 3, borderRadius: radius.pill, backgroundColor: bg };
  if (!onPress) return <View style={style}>{body}</View>;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={() => { haptic.tap(); onPress(); }} hitSlop={8}
    style={({ pressed }) => [style, { paddingHorizontal: space(3), paddingVertical: space(2), opacity: pressed ? 0.7 : 1 }]}>{body}</Pressable>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { colors, font } = useTheme();
  const initials = name.split(/\s+/).map((part) => part.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·';
  return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.actionPrimarySubtle, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: colors.actionPrimary, fontFamily: font.semibold, fontSize: size * 0.38, lineHeight: size * 0.5 }}>{initials}</Text>
  </View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.structuralDivider, marginStart: inset }} />;
}

export function Row({ children, gap = 2, style, align = 'center', wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems']; wrap?: boolean }) {
  const { space } = useTheme();
  return <View style={[{ flexDirection: 'row', alignItems: align, gap: space(gap), flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}
export function Stack({ children, gap = 3, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  const { space } = useTheme();
  return <View style={[{ gap: space(gap) }, style]}>{children}</View>;
}

/** A soft round badge holding an icon, for list rows and empty states. */
export function IconBadge({ icon: Icon, tone = 'neutral', size = 36 }: { icon: LucideIcon; tone?: ChipTone; size?: number }) {
  const { colors, radius } = useTheme();
  const palette: Record<ChipTone, [string, string]> = {
    neutral: [colors.surfaceMuted, colors.icon], info: [colors.infoSubtle, colors.info], success: [colors.successSubtle, colors.success],
    warning: [colors.warningSubtle, colors.warning], danger: [colors.dangerSubtle, colors.danger], action: [colors.actionPrimarySubtle, colors.actionPrimary],
  };
  const [bg, fg] = palette[tone];
  return <View style={{ width: size, height: size, borderRadius: size > 40 ? size / 2 : radius.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
    <Icon color={fg} size={Math.round(size * 0.5)} strokeWidth={1.9} />
  </View>;
}
