import { useState } from 'react';
import { Platform, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Calendar, Clock } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { useFormat } from '../core/format';
import { Button } from './primitives';
import { FieldButton } from './fields';
import { Sheet } from './sheet';
import { useTheme } from './theme';

const pad = (value: number) => String(value).padStart(2, '0');
const toDate = (value: string, mode: 'date' | 'time') => {
  const date = mode === 'date' ? new Date(`${value || '2000-01-01'}T12:00:00`) : new Date(`2000-01-01T${value || '09:00'}:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
const fromDate = (date: Date, mode: 'date' | 'time') => (mode === 'date'
  ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  : `${pad(date.getHours())}:${pad(date.getMinutes())}`);

export type DateFieldProps = {
  label?: string; value: string; onChange: (value: string) => void; mode?: 'date' | 'time';
  /** YYYY-MM-DD bounds for dates. */
  min?: string; max?: string; placeholder?: string; error?: string; hint?: string; disabled?: boolean;
};

/** A calendar date (YYYY-MM-DD) or a wall-clock time (HH:mm), picked with the platform's own picker. */
export function DateField({ label, value, onChange, mode = 'date', min, max, placeholder, error, hint, disabled }: DateFieldProps) {
  const theme = useTheme();
  const t = useT();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const display = value ? (mode === 'date' ? format.weekday(value) : format.clockLabel(value)) : '';
  const bounds = { minimumDate: min ? toDate(min, 'date') : undefined, maximumDate: max ? toDate(max, 'date') : undefined };
  const show = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: toDate(value, mode), mode, is24Hour: true, ...bounds,
        onChange: (event, next) => { if (event.type === 'set' && next) onChange(fromDate(next, mode)); } });
      return;
    }
    setDraft(value || fromDate(new Date(), mode));
    setOpen(true);
  };
  return <>
    <FieldButton label={label} value={display} placeholder={placeholder ?? (mode === 'date' ? t('Choose a date') : t('Choose a time'))} onPress={show} error={error} hint={hint} disabled={disabled}
      icon={mode === 'date' ? <Calendar color={theme.colors.iconSubtle} size={18} /> : <Clock color={theme.colors.iconSubtle} size={18} />} />
    {Platform.OS === 'ios' ? <Sheet open={open} onClose={() => setOpen(false)} title={label}
      footer={<Button label={t('Done')} variant="primary" size="lg" full onPress={() => { onChange(draft); setOpen(false); }} />}>
      <View style={{ alignItems: 'center' }}>
        <DateTimePicker value={toDate(draft, mode)} mode={mode} display={mode === 'date' ? 'inline' : 'spinner'} {...bounds}
          accentColor={theme.colors.actionPrimary} themeVariant={theme.scheme} textColor={theme.colors.text}
          onChange={(_, next) => { if (next) setDraft(fromDate(next, mode)); }} />
      </View>
    </Sheet> : null}
  </>;
}
