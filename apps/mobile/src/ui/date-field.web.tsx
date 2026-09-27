import { createElement, useState } from 'react';
import { View } from 'react-native';
import { Field } from './fields';
import { useTheme } from './theme';
import type { DateFieldProps } from './date-field';

export type { DateFieldProps } from './date-field';

/** The browser's own date or time input, styled like the other fields. */
export function DateField({ label, value, onChange, mode = 'date', min, max, error, hint, disabled }: DateFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return <Field label={label} error={error} hint={hint}>
    <View style={{ minHeight: theme.touch.control, borderRadius: theme.radius.md, borderWidth: focused ? 1.5 : 1, borderColor: error ? theme.colors.danger : focused ? theme.colors.focus : theme.colors.borderControl,
      backgroundColor: disabled ? theme.colors.surfaceMuted : theme.colors.surface, justifyContent: 'center', paddingHorizontal: theme.space(3) }}>
      {createElement('input', {
        type: mode, value, min: mode === 'date' ? min : undefined, max: mode === 'date' ? max : undefined, disabled, 'aria-label': label,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        onFocus: () => setFocused(true), onBlur: () => setFocused(false),
        style: { border: 'none', outline: 'none', background: 'transparent', color: theme.colors.text, fontFamily: theme.font.regular, fontSize: theme.size.lg, height: theme.touch.control - 2, colorScheme: theme.scheme },
      })}
    </View>
  </Field>;
}
