import { useMemo, useState } from 'react';
import { Pressable, type TextInputProps } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useT } from '../core/i18n';
import { haptic } from '../core/haptics';
import { flagOf, callingCode, groupNational, ltrText, phoneCountryOptions, phoneExample, splitPhone } from '../core/phone';
import { OptionSheet, TextField } from './fields';
import { Text } from './primitives';
import { useTheme } from './theme';

export type PhoneValue = { country: string; national: string };

/**
 * One phone control (the web's PhoneField on the phone): the country code sits inside the field and opens a searchable
 * list, the number is typed locally, and a pasted "+971…" or "00971…" is split into code and number so the code never
 * shows twice. It reads left to right in every language. The caller checks it (`phoneProblem`) and sends `toE164`.
 */
export function PhoneField({ label, value, onChange, locale, error, editable = true, ...input }: {
  label: string; value: PhoneValue; onChange: (value: PhoneValue) => void; locale: string; error?: string; editable?: boolean;
} & Pick<TextInputProps, 'autoFocus' | 'onSubmitEditing' | 'returnKeyType' | 'testID'> & { size?: 'md' | 'lg'; pill?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const countries = useMemo(() => phoneCountryOptions(locale), [locale]);
  const options = useMemo(() => countries.map((country) => ({ value: country.id, label: country.label, detail: country.description })), [countries]);
  const { country, national } = value;
  // While typing, what was typed; otherwise the number grouped the local way ("50 742 1938" beside +971).
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? groupNational(national, country);
  const type = (raw: string) => {
    const next = splitPhone(raw, country);
    const international = /^\s*(\+|00)/.test(raw);
    setDraft(international ? groupNational(next.national, next.country || country) : raw);
    onChange({ country: next.country || country, national: international ? next.national : raw });
  };
  const tidy = () => {
    setDraft(null);
    const next = splitPhone(national, country);
    if (next.national !== national || next.country !== country) onChange(next);
  };

  const code = <Pressable accessibilityRole="button" accessibilityLabel={t('{label} country code', { label })} disabled={!editable} hitSlop={6}
    onPress={() => { haptic.tap(); setOpen(true); }} testID={input.testID ? `${input.testID}-country` : undefined}
    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1) }}>
    <Text variant="label">{country ? ltrText(`${flagOf(country)} ${callingCode(country)}`) : t('Code')}</Text>
    <ChevronDown color={theme.colors.iconSubtle} size={16} />
  </Pressable>;

  return <>
    <TextField {...input} label={label} value={shown} editable={editable} error={error} ltr leading={code}
      placeholder={phoneExample(country)} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
      onFocus={() => setDraft(shown)} onBlur={tidy} onChangeText={type} />
    <OptionSheet open={open} onClose={() => setOpen(false)} title={t('{label} country codes', { label })} options={options} value={country || null}
      onChange={(next) => { if (next) onChange({ country: next, national }); setOpen(false); }} />
  </>;
}
