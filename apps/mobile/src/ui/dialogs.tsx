import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { Button, IconBadge, Text } from './primitives';
import { TextField } from './fields';
import { Sheet } from './sheet';
import { useTheme } from './theme';

export type SheetAction = { label: string; icon?: LucideIcon; onPress: () => void; danger?: boolean; detail?: string; disabled?: boolean };

/** The ⋯ menu: a short list of secondary actions. */
export function ActionSheet({ open, onClose, title, actions }: { open: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  const theme = useTheme();
  return <Sheet open={open} onClose={onClose} title={title}>
    <View style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.structuralDivider, overflow: 'hidden' }}>
      {actions.map((action, index) => <Pressable key={action.label} accessibilityRole="button" disabled={action.disabled}
        onPress={() => { onClose(); setTimeout(action.onPress, Platform.OS === 'ios' ? 280 : 0); }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), minHeight: 56, paddingHorizontal: theme.space(4), paddingVertical: theme.space(3),
          borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider, backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent', opacity: action.disabled ? 0.45 : 1 })}>
        {action.icon ? <IconBadge icon={action.icon} tone={action.danger ? 'danger' : 'neutral'} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone={action.danger ? 'danger' : 'default'}>{action.label}</Text>
          {action.detail ? <Text variant="caption" tone="secondary">{action.detail}</Text> : null}
        </View>
      </Pressable>)}
    </View>
  </Sheet>;
}

/**
 * Asks why before doing something (send back, reject, cancel, reopen). The reason needs at least three
 * characters, the server's rule for every decision.
 */
export function ReasonSheet({ open, onClose, title, label, action, onSubmit, danger, minLength = 3, initial = '', detail }: {
  open: boolean; onClose: () => void; title: string; label: string; action: string; onSubmit: (reason: string) => Promise<unknown> | void; danger?: boolean; minLength?: number; initial?: string; detail?: string;
}) {
  const t = useT();
  const [reason, setReason] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(initial); }, [open, initial]);
  const ready = reason.trim().length >= minLength;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try { await onSubmit(reason.trim()); onClose(); } catch { /* the caller shows the failure */ } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={title} subtitle={detail}
    footer={<Button label={action} variant={danger ? 'danger' : 'primary'} full size="lg" onPress={submit} disabled={!ready} loading={busy} />}>
    <TextField label={label} value={reason} onChangeText={setReason} multiline autoFocus maxLength={2000}
      hint={minLength > 0 && !ready ? t('At least {count} characters', { count: minLength }) : undefined} />
  </Sheet>;
}

/** A yes/no question for an action that can't be undone. */
export function ConfirmSheet({ open, onClose, title, detail, action, onConfirm, danger }: {
  open: boolean; onClose: () => void; title: string; detail?: string; action: string; onConfirm: () => Promise<unknown> | void; danger?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch { /* the caller shows the failure */ } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={title} subtitle={detail}
    footer={<>
      <Button label={action} variant={danger ? 'danger' : 'primary'} full size="lg" onPress={confirm} loading={busy} />
      <Button label={t('Cancel')} variant="ghost" full onPress={onClose} disabled={busy} />
    </>}>
    <View />
  </Sheet>;
}
