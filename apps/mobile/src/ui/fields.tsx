import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { Check, ChevronDown, Minus, Plus, Search, X } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { haptic } from '../core/haptics';
import { IconButton, Row, Text } from './primitives';
import { Sheet } from './sheet';
import { useTheme } from './theme';

/** The label, the control, then one line of help or the error. */
export function Field({ label, hint, error, children, action }: { label?: string; hint?: string; error?: string; children: ReactNode; action?: ReactNode }) {
  const theme = useTheme();
  return <View style={{ gap: theme.space(1.5) }}>
    {label || action ? <Row style={{ justifyContent: 'space-between' }}>
      {label ? <Text variant="label" tone="secondary" style={{ fontSize: theme.size.sm }}>{label}</Text> : <View />}
      {action}
    </Row> : null}
    {children}
    {error ? <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">{error}</Text>
      : hint ? <Text variant="caption" tone="tertiary">{hint}</Text> : null}
  </View>;
}

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string; hint?: string; error?: string; leading?: ReactNode; trailing?: ReactNode; inputRef?: Ref<TextInput>; action?: ReactNode;
  size?: 'md' | 'lg'; pill?: boolean;
  /** Reads left to right in every language (a phone number): the leading part stays before the text in RTL too. */
  ltr?: boolean;
};
export function TextField({ label, hint, error, leading, trailing, inputRef, multiline, action, size = 'md', pill, ltr, editable = true, ...props }: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const border = error ? theme.colors.danger : focused ? theme.colors.focus : theme.colors.borderControl;
  const height = size === 'lg' ? theme.touch.large : theme.touch.control;
  return <Field label={label} hint={hint} error={error} action={action}>
    <View style={{
      flexDirection: 'row', direction: ltr ? 'ltr' : undefined, alignItems: multiline ? 'flex-start' : 'center', gap: theme.space(2), minHeight: multiline ? 104 : height,
      borderWidth: focused ? 1.5 : 1, borderColor: border, borderRadius: pill ? theme.radius.pill : theme.radius.md, backgroundColor: editable ? theme.colors.surface : theme.colors.surfaceMuted,
      paddingHorizontal: theme.space(pill ? 5 : 3), paddingVertical: multiline ? theme.space(3) : 0,
    }}>
      {leading}
      <TextInput ref={inputRef} {...props} editable={editable} multiline={multiline} accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={theme.colors.textTertiary} selectionColor={theme.colors.actionPrimary} cursorColor={theme.colors.actionPrimary}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event); }} onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
        style={{ flex: 1, minHeight: multiline ? 80 : height - 2, color: theme.colors.text, fontFamily: theme.font.regular, fontSize: theme.size.lg,
          textAlignVertical: multiline ? 'top' : 'center', writingDirection: theme.rtl && !ltr ? 'rtl' : 'ltr', paddingVertical: multiline ? 0 : theme.space(2), outlineStyle: 'none' } as never} />
      {trailing}
    </View>
  </Field>;
}

/** A search box for the top of a list. */
export function SearchField({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2), height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted, paddingHorizontal: theme.space(3) }}>
    <Search color={theme.colors.iconSubtle} size={18} />
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder ?? t('Search')} placeholderTextColor={theme.colors.textTertiary} autoFocus={autoFocus}
      autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="never" accessibilityLabel={placeholder ?? t('Search')}
      selectionColor={theme.colors.actionPrimary}
      style={{ flex: 1, height: 44, color: theme.colors.text, fontFamily: theme.font.regular, fontSize: theme.size.lg, writingDirection: theme.rtl ? 'rtl' : 'ltr', outlineStyle: 'none' } as never} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel={t('Clear')} hitSlop={10} onPress={() => onChange('')}><X color={theme.colors.iconSubtle} size={16} /></Pressable> : null}
  </View>;
}

/** A tappable control that shows its value and opens a picker. */
export function FieldButton({ label, value, placeholder, onPress, error, hint, icon, disabled }: {
  label?: string; value?: string; placeholder?: string; onPress: () => void; error?: string; hint?: string; icon?: ReactNode; disabled?: boolean;
}) {
  const theme = useTheme();
  return <Field label={label} error={error} hint={hint}>
    <Pressable accessibilityRole="button" accessibilityLabel={label ? `${label}: ${value || placeholder || ''}` : value} disabled={disabled} onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space(2), minHeight: theme.touch.control, paddingHorizontal: theme.space(3), borderRadius: theme.radius.md,
        borderWidth: 1, borderColor: error ? theme.colors.danger : theme.colors.borderControl, backgroundColor: pressed ? theme.colors.surfacePressed : disabled ? theme.colors.surfaceMuted : theme.colors.surface })}>
      {icon}
      <Text style={{ flex: 1 }} tone={value ? 'default' : 'tertiary'} numberOfLines={1}>{value || placeholder || ''}</Text>
      <ChevronDown color={theme.colors.iconSubtle} size={18} />
    </Pressable>
  </Field>;
}

export type Option<V extends string = string> = { value: V; label: string; detail?: string };

/** Choose one from a list: a sheet with search when the list is long. */
export function SelectField<V extends string>({ label, value, options, onChange, placeholder, error, hint, title, disabled, allowClear }: {
  label?: string; value: V | null | undefined; options: Option<V>[]; onChange: (value: V | null) => void; placeholder?: string; error?: string; hint?: string; title?: string; disabled?: boolean; allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <>
    <FieldButton label={label} value={selected?.label} placeholder={placeholder} onPress={() => setOpen(true)} error={error} hint={hint} disabled={disabled} />
    <OptionSheet open={open} onClose={() => setOpen(false)} title={title ?? label ?? ''} options={options} value={value ?? null} allowClear={allowClear}
      onChange={(next) => { onChange(next); setOpen(false); }} />
  </>;
}

export function OptionSheet<V extends string>({ open, onClose, title, options, value, onChange, allowClear }: {
  open: boolean; onClose: () => void; title: string; options: Option<V>[]; value: V | null; onChange: (value: V | null) => void; allowClear?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const [query, setQuery] = useState('');
  const searchable = options.length > 8;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  return <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title={title} full={searchable}>
    {searchable ? <SearchField value={query} onChange={setQuery} /> : null}
    <View style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.structuralDivider, overflow: 'hidden' }}>
      {allowClear && value ? <OptionRow label={t('None')} selected={false} first onPress={() => onChange(null)} /> : null}
      {shown.map((option, index) => <OptionRow key={option.value} label={option.label} detail={option.detail} selected={option.value === value}
        first={index === 0 && !(allowClear && value)} onPress={() => onChange(option.value)} />)}
      {!shown.length ? <View style={{ padding: theme.space(6), alignItems: 'center' }}><Text variant="caption" tone="secondary">{t('Nothing matches')}</Text></View> : null}
    </View>
  </Sheet>;
}

function OptionRow({ label, detail, selected, first, onPress }: { label: string; detail?: string; selected: boolean; first?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { haptic.tap(); onPress(); }}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 52, paddingHorizontal: theme.space(4), paddingVertical: theme.space(3),
      borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.structuralDivider, backgroundColor: pressed ? theme.colors.surfacePressed : selected ? theme.colors.surfaceSelected : 'transparent' })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="label">{label}</Text>
      {detail ? <Text variant="caption" tone="secondary" numberOfLines={2}>{detail}</Text> : null}
    </View>
    {selected ? <Check color={theme.colors.actionPrimary} size={18} strokeWidth={2.4} /> : null}
  </Pressable>;
}

/** Two to four choices side by side; the selected one is filled. */
export function SegmentedControl<V extends string>({ value, options, onChange, label }: { value: V; options: Option<V>[]; onChange: (value: V) => void; label?: string }) {
  const theme = useTheme();
  const control = <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 3, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted, gap: 2 }}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { if (!selected) { haptic.tap(); onChange(option.value); } }}
        style={{ flex: 1, minHeight: 38, paddingHorizontal: theme.space(2), borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center',
          backgroundColor: selected ? theme.colors.surface : 'transparent', borderWidth: selected ? 1 : 0, borderColor: theme.colors.structuralDivider }}>
        <Text variant="label" tone={selected ? 'default' : 'secondary'} numberOfLines={1} style={{ fontSize: theme.size.sm }}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
  return label ? <Field label={label}>{control}</Field> : control;
}

/** Filters as a row of chips that scrolls when needed. */
export function FilterChips<V extends string>({ value, options, onChange }: { value: V; options: Option<V>[]; onChange: (value: V) => void }) {
  const theme = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) }}>
    {options.map((option) => {
      const selected = option.value === value;
      return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected }} hitSlop={4} onPress={() => { haptic.tap(); onChange(option.value); }}
        style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: theme.space(3), borderRadius: theme.radius.pill, justifyContent: 'center', borderWidth: 1,
          borderColor: selected ? theme.colors.actionPrimary : theme.colors.borderControl, backgroundColor: selected ? theme.colors.actionPrimary : pressed ? theme.colors.surfacePressed : theme.colors.surface })}>
        <Text variant="label" style={{ fontSize: theme.size.sm, color: selected ? theme.colors.actionOnPrimary : theme.colors.text }}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

/** Decimal text as people type it: digits and one point, at most `places` decimals. */
export function cleanDecimal(text: string, places = 4, allowNegative = false) {
  let value = text.replace(',', '.').replace(allowNegative ? /[^0-9.-]/g : /[^0-9.]/g, '');
  if (allowNegative) value = value.replace(/(?!^)-/g, '');
  const [whole, ...rest] = value.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, places)}` : whole;
}

/** A quantity: type it, or step it with − and + (big targets for gloved hands). */
export function Stepper({ label, value, onChange, step = 1, min = 0, max, unit, places = 2, hint, error, compact }: {
  label?: string; value: string; onChange: (value: string) => void; step?: number; min?: number; max?: number; unit?: string; places?: number; hint?: string; error?: string; compact?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const number = Number(value || 0);
  const round = (n: number) => String(Math.round(n * 10 ** places) / 10 ** places);
  const bump = (direction: 1 | -1) => {
    const next = (Number.isFinite(number) ? number : 0) + direction * step;
    if (next < min || (max !== undefined && next > max)) { haptic.warning(); return; }
    onChange(round(next));
  };
  const size = compact ? 40 : theme.touch.control;
  // On the web an input keeps its own width unless it may shrink (minWidth 0); otherwise the unit lands past the box's edge.
  const control = <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
    <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.borderControl }}>
      <IconButton icon={Minus} label={t('Less')} onPress={() => bump(-1)} size={size} disabled={number <= min} />
    </View>
    <View style={{ flex: compact ? 0 : 1, minWidth: compact ? 64 : 0, flexDirection: 'row', alignItems: 'center', height: size, borderRadius: theme.radius.md, borderWidth: 1, borderColor: error ? theme.colors.danger : theme.colors.borderControl, backgroundColor: theme.colors.surface, paddingHorizontal: theme.space(3), overflow: 'hidden' }}>
      <TextInput value={value} onChangeText={(text) => onChange(cleanDecimal(text, places))} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel={label}
        selectionColor={theme.colors.actionPrimary}
        style={{ flex: 1, minWidth: 0, textAlign: 'center', color: theme.colors.text, fontFamily: theme.font.semibold, fontSize: theme.size.lg, fontVariant: ['tabular-nums'], height: size - 2, outlineStyle: 'none' } as never} />
      {unit ? <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 0, marginStart: theme.space(1) }}>{unit}</Text> : null}
    </View>
    <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.borderControl }}>
      <IconButton icon={Plus} label={t('More')} onPress={() => bump(1)} size={size} disabled={max !== undefined && number >= max} />
    </View>
  </View>;
  return label || hint || error ? <Field label={label} hint={hint} error={error}>{control}</Field> : control;
}

/** An on/off row. */
export function ToggleRow({ label, detail, value, onChange, first }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void; first?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => { haptic.tap(); onChange(!value); }}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 56, paddingHorizontal: theme.space(4), paddingVertical: theme.space(3),
      borderTopWidth: first ? 0 : 1, borderTopColor: theme.colors.structuralDivider, backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' })}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="label">{label}</Text>
      {detail ? <Text variant="caption" tone="secondary">{detail}</Text> : null}
    </View>
    <View style={{ width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: value ? theme.colors.actionPrimary : theme.colors.borderStrong, alignItems: value ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.surface }} />
    </View>
  </Pressable>;
}
