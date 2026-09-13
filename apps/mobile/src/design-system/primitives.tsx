import { Text as NativeText, View, type TextProps, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './provider';
import { tokens } from './tokens.generated';

export function Text({ size = 'md', weight = 'regular', tone = 'text', style, ...props }: TextProps & {
  size?: keyof typeof tokens.fontSize;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  tone?: 'text' | 'textSecondary' | 'textTertiary' | 'danger' | 'success';
}) {
  const { fonts, colors, direction } = useTheme();
  return <NativeText {...props} style={[{
    fontFamily: fonts[weight], fontSize: tokens.fontSize[size],
    lineHeight: Math.round(tokens.fontSize[size] * 1.55),
    color: colors[tone], textAlign: direction === 'rtl' ? 'right' : 'left', writingDirection: direction,
  }, style]} />;
}

export function Screen({ children, style, ...props }: ViewProps) {
  const { colors, direction } = useTheme();
  return <View {...props} style={[{ flex: 1, backgroundColor: colors.canvas, direction }, style]}>
    <SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView>
  </View>;
}

export function Stack({ gap = '4', horizontal = false, style, ...props }: ViewProps & {
  gap?: keyof typeof tokens.spacing;
  horizontal?: boolean;
}) {
  const { direction } = useTheme();
  return <View {...props} style={[{ gap: tokens.spacing[gap], flexDirection: horizontal ? 'row' : 'column', direction }, style]} />;
}

export function Surface({ muted = false, style, ...props }: ViewProps & { muted?: boolean }) {
  const { colors } = useTheme();
  return <View {...props} style={[{ backgroundColor: muted ? colors.surfaceMuted : colors.surface }, style]} />;
}
