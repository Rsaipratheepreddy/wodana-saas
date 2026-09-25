import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, Easing, Platform, TextInput, View, type TextInputProps } from 'react-native';
import { Stack, Text } from './primitives';
import { useTheme } from './provider';
import { tokens } from './tokens.generated';
import { loginTheme } from './login-theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export function TextField({ label, labelAction, hint, error, variant = 'default', leading, trailing, inputRef, style, onFocus, onBlur, ...props }: TextInputProps & {
  label: string;
  labelAction?: ReactNode;
  hint?: string;
  error?: string;
  variant?: 'default' | 'login';
  leading?: ReactNode;
  trailing?: ReactNode;
  inputRef?: Ref<TextInput>;
}) {
  const { colors, fonts, direction, reducedMotion } = useTheme();
  const [focused, setFocused] = useState(false);
  const focusProgress = useRef(new Animated.Value(0)).current;
  const id = useId();
  const auth = variant === 'login';
  const focusColor = auth ? loginTheme.accent : colors.focus;
  const borderColor = auth ? loginTheme.line : colors.borderControl;
  useEffect(() => {
    const animation = Animated.timing(focusProgress, {
      toValue: focused ? 1 : 0, duration: reducedMotion ? 0 : tokens.motion.base,
      easing: Easing.out(Easing.quad), useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focusProgress, focused, reducedMotion]);
  return <Stack gap="2">
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}>
      <Text nativeID={`${id}-label`} size="sm" weight="medium"
        style={auth && { color: loginTheme.ink, lineHeight: 20 }}>{label}</Text>
      {labelAction}
    </View>
    <View>
    <Animated.View accessible={false} importantForAccessibility="no" style={{
      position: 'absolute', top: -3, bottom: -3, start: -3, end: -3, pointerEvents: 'none',
      borderRadius: (auth ? loginTheme.controlRadius : tokens.radius.sm) + 3,
      borderWidth: 3, borderColor: error ? `${colors.danger}24` : `${focusColor}33`,
      opacity: error ? 1 : focusProgress,
    }} />
    <AnimatedTextInput {...props} ref={inputRef} accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityHint={[hint, error].filter(Boolean).join('. ') || props.accessibilityHint}
      accessibilityState={{ ...props.accessibilityState, disabled: props.editable === false }}
      aria-invalid={!!error}
      placeholderTextColor={auth ? loginTheme.muted : colors.textTertiary}
      selectionColor={auth ? loginTheme.accent : colors.actionPrimary}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      style={[{
        minHeight: loginTheme.controlHeight, borderWidth: 1,
        borderRadius: auth ? loginTheme.controlRadius : tokens.radius.sm,
        borderColor: error ? colors.danger : focusProgress.interpolate({ inputRange: [0, 1], outputRange: [borderColor, focusColor] }),
        backgroundColor: auth ? loginTheme.field : colors.surface, color: auth ? loginTheme.ink : colors.text, fontFamily: fonts.regular,
        fontSize: auth ? loginTheme.controlFontSize : tokens.fontSize.md,
        lineHeight: auth ? loginTheme.controlLineHeight : undefined,
        paddingHorizontal: auth ? 20 : tokens.spacing['3'], paddingVertical: 12,
        paddingStart: leading ? 54 : auth ? 20 : tokens.spacing['3'],
        paddingEnd: trailing ? 48 : auth ? 14 : tokens.spacing['3'],
        textAlign: direction === 'rtl' ? 'right' : 'left', writingDirection: direction,
        opacity: props.editable === false ? 0.5 : 1,
        // WebKit paints an automatic blue focus ring even with a zero width.
        // Keep only our animated, accessible brand-colored border and ring.
        ...(Platform.OS === 'web' && { outlineStyle: 'solid' as const, outlineWidth: 0, outlineColor: 'transparent' }),
      }, style]} />
      {leading && <View pointerEvents="none" style={{ position: 'absolute', start: 20, top: 0, bottom: 0, justifyContent: 'center' }}>{leading}</View>}
      {trailing && <View style={{ position: 'absolute', end: 4, top: 0, bottom: 0, justifyContent: 'center' }}>{trailing}</View>}
    </View>
    {(error || hint) && <Text accessibilityLiveRegion={error ? 'polite' : 'none'} size="xs" tone={error ? 'danger' : 'textSecondary'}>{error || hint}</Text>}
  </Stack>;
}
