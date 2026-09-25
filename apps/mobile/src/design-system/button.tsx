import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';
import { Text } from './primitives';
import { useTheme } from './provider';
import { tokens } from './tokens.generated';
import { loginTheme } from './login-theme';

export function Button({ label, variant = 'primary', pill = false, startIcon, endIcon, loading = false, disabled, style, onFocus, onBlur, ...props }: Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'brand' | 'brand-secondary' | 'white' | 'glass';
  pill?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;
  const publicBrand = variant === 'brand' || variant === 'brand-secondary';
  const foreground = variant === 'brand' ? loginTheme.buttonInk
    : variant === 'brand-secondary' || variant === 'white' || variant === 'glass' ? loginTheme.ink
      : variant === 'primary' ? colors.actionOnPrimary : colors.text;
  const background = (pressed: boolean) => {
    if (variant === 'brand') return pressed ? loginTheme.buttonHover : loginTheme.button;
    if (variant === 'brand-secondary') return pressed ? loginTheme.accentSoft : loginTheme.secondary;
    if (variant === 'white') return pressed ? 'rgba(255,255,255,0.72)' : '#ffffff';
    if (variant === 'glass') return pressed ? 'rgba(255,255,255,0.54)' : 'rgba(255,255,255,0.30)';
    if (variant === 'primary') return pressed ? colors.actionPrimaryPressed : colors.actionPrimary;
    return pressed ? colors.surfacePressed : variant === 'secondary' ? colors.surface : 'transparent';
  };
  return <Pressable {...props} disabled={unavailable} accessibilityRole="button"
    accessibilityLabel={props.accessibilityLabel ?? label}
    accessibilityState={{ ...props.accessibilityState, disabled: !!unavailable, busy: loading }}
    onFocus={(event) => { setFocused(true); onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); onBlur?.(event); }}
    style={(state) => [{
      minHeight: pill ? 56 : loginTheme.controlHeight, paddingHorizontal: pill ? 24 : 14, paddingVertical: pill ? 14 : 10,
      borderRadius: pill ? tokens.radius.pill : publicBrand ? loginTheme.controlRadius : tokens.radius.sm,
      alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, overflow: 'hidden',
      backgroundColor: background(state.pressed),
      borderWidth: 1,
      borderColor: focused ? (publicBrand ? loginTheme.accent : colors.focus)
        : variant === 'brand-secondary' ? loginTheme.line : variant === 'secondary' ? colors.borderControl : 'transparent',
      opacity: unavailable ? (publicBrand ? 0.62 : 0.5) : state.pressed && variant === 'brand' ? 0.85 : 1,
    }, typeof style === 'function' ? style(state) : style]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 1, zIndex: 1 }}>
    {loading && <ActivityIndicator color={foreground} />}
    {!loading && startIcon}
    <Text weight={variant === 'brand' ? 'semibold' : 'medium'} size={pill ? 'lg' : publicBrand ? 'sm' : 'md'}
      style={{ color: foreground, textAlign: 'center', flexShrink: 1, ...(publicBrand && { lineHeight: loginTheme.controlLineHeight }) }}>{label}</Text>
    {!loading && endIcon}
    </View>
  </Pressable>;
}
