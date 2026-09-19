import { useState, type ComponentProps, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button as SystemButton, Text, TextField as SystemTextField, useTheme } from '../design-system';
import { Icon, type IconName } from '../components/icon';

export function Button({ variant = 'primary', style, ...props }: ComponentProps<typeof SystemButton>) {
  const { mode } = useTheme();
  return <SystemButton {...props} variant={variant === 'primary' && mode !== 'high-contrast' ? 'brand' : variant}
    style={state => [{ minHeight: 48, borderRadius: 12 }, typeof style === 'function' ? style(state) : style]} />;
}

export function TextField({ style, multiline, ...props }: ComponentProps<typeof SystemTextField>) {
  return <SystemTextField {...props} multiline={multiline}
    style={[{ borderRadius: 12, fontSize: 14, ...(multiline && { minHeight: 104, textAlignVertical: 'top' }) }, style]} />;
}

export function Card({ children, tinted = false }: { children: ReactNode; tinted?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: tinted ? colors.surfaceSubtle : colors.surface,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14 }}>
    {children}
  </View>;
}

export function EmptyState({ title, description, icon = 'inbox' }: { title: string; description: string; icon?: IconName }) {
  const { colors } = useTheme();
  return <Card>
    <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.actionPrimarySubtle,
      justifyContent: 'center', alignItems: 'center' }}><Icon name={icon} size={24} color={colors.actionPrimary} /></View>
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" weight="semibold" size="lg">{title}</Text>
      <Text size="sm" tone="textSecondary">{description}</Text>
    </View>
  </Card>;
}

export function StatusBadge({ label, status }: { label: string; status: string }) {
  const { colors } = useTheme();
  const success = status === 'approved' || status === 'complete', danger = status === 'rejected', pending = status.includes('pending') || status === 'needs_review';
  return <View style={{ alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
    backgroundColor: success ? colors.successSubtle : danger ? colors.dangerSubtle : pending ? colors.actionPrimarySubtle : colors.surfaceMuted }}>
    <Text size="xs" weight="medium" style={{ color: success ? colors.success : danger ? colors.danger : pending ? colors.actionPrimary : colors.textSecondary }}>{label}</Text>
  </View>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const { colors } = useTheme();
  return <Text accessibilityLiveRegion="polite" size="sm" style={{
    backgroundColor: error ? colors.dangerSubtle : colors.infoSubtle,
    color: error ? colors.danger : colors.info, padding: 14, borderRadius: 14,
  }}>{children}</Text>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { colors, reducedMotion } = useTheme();
  return <Modal animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} presentationStyle="pageSheet">
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between', gap: 12 }}>
          <Text accessibilityRole="header" weight="semibold" size="xl" style={{ flex: 1 }}>{title}</Text>
          <Button variant="ghost" label="Close" onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 18, paddingBottom: 48 }}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export function FieldTrigger({ label, value, onPress, expanded, icon = 'chevron-down' }: {
  label: string; value: string; onPress: () => void; expanded: boolean; icon?: IconName;
}) {
  const { colors } = useTheme();
  return <View style={{ gap: 8 }}>
    <Text size="sm" weight="medium">{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ expanded }}
      onPress={onPress} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 14, paddingVertical: 12,
        borderRadius: 12, borderWidth: 1, borderColor: expanded ? colors.focus : colors.borderControl,
        backgroundColor: pressed ? colors.surfacePressed : colors.surface,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 })}>
      <Text style={{ flex: 1 }}>{value}</Text>
      <Icon name={icon} size={18} color={colors.icon} />
    </Pressable>
  </View>;
}

export function Choice({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  return <>
    <FieldTrigger label={label} value={options.find(o => o.value === value)?.label ?? 'Choose…'} expanded={open} onPress={() => setOpen(true)} />
    {open && <Sheet title={label} onClose={() => setOpen(false)}>
      {options.map(o => <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: o.value === value }}
        onPress={() => { onChange(o.value); setOpen(false); }}
        style={({ pressed }) => ({ minHeight: 56, padding: 16, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: pressed ? colors.surfacePressed : o.value === value ? colors.actionPrimarySubtle : colors.surface })}>
        <Text weight={o.value === value ? 'semibold' : 'regular'} style={{ flex: 1 }}>{o.label}</Text>
        {o.value === value && <Icon name="check" size={20} color={colors.actionPrimary} />}
      </Pressable>)}
    </Sheet>}
  </>;
}

export function CheckRow({ label, description, checked, onChange, disabled = false }: {
  label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled}
    onPress={() => onChange(!checked)} style={({ pressed }) => ({ minHeight: 52, borderRadius: 14, borderWidth: 1,
      borderColor: checked ? colors.actionPrimary : colors.borderControl, backgroundColor: pressed ? colors.surfacePressed : colors.surface,
      padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12 })}>
    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: checked ? colors.actionPrimary : colors.borderControl,
      backgroundColor: checked ? colors.actionPrimary : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      {checked && <Icon name="check" size={16} color={colors.actionOnPrimary} />}
    </View>
    <View style={{ flex: 1, gap: 3 }}><Text size="sm" weight="medium">{label}</Text>{description && <Text size="xs" tone="textSecondary">{description}</Text>}</View>
  </Pressable>;
}
