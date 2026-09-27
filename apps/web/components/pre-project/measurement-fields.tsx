"use client";

import { useState } from 'react';
import { NumericInput, SelectField, TextInput } from '@/design-system';
import type { ItemDimension } from '@/lib/pre-project/content';
import styles from './measurement-fields.module.css';
import { useT } from '@/lib/i18n/i18n-provider';
import { tKey, type MessageKey } from '@/lib/i18n/keys';

/** The same fields and units are used when capturing and revising a measurement. */
export function MeasurementFields({ value, onChange, disabled, requireMeasured = false }: {
  value: ItemDimension;
  onChange: (patch: Partial<ItemDimension>) => void;
  disabled: boolean;
  requireMeasured?: boolean;
}) {
  const t = useT();
  // The English name is what is stored; the label is shown in the person's language.
  const types: MessageKey[] = [tKey('Length'),tKey('Width'),tKey('Height'),tKey('Depth'),tKey('Thickness'),tKey('Diameter'),tKey('Radius')];
  const [custom, setCustom] = useState(Boolean(value.name && !(types as string[]).includes(value.name)));
  const numeric = (key: 'measured' | 'approximate', label: string) => <NumericInput
    label={label} isRequired={key === 'measured' && requireMeasured} isDisabled={disabled}
    minValue={0.0001} maxValue={1000000} step={0.0001} formatOptions={{maximumFractionDigits:4,useGrouping:false}}
    value={value[key] ?? NaN} onChange={next => onChange({[key]:Number.isFinite(next) ? next : null})} />;
  return <div className={styles.fields}>
    <SelectField label={t('Measurement type')} isRequired isDisabled={disabled} selectedKey={custom?'custom':value.name||null} placeholder={t('Choose a dimension…')} items={[...types.map(id=>({id,label:t(id)})),{id:'custom',label:t('Custom dimension')}]} onSelectionChange={key=>{setCustom(key==='custom');onChange({name:key==='custom'?'':String(key??'')});}} />
    {custom && <TextInput label={t('Dimension name')} isRequired isDisabled={disabled} maxLength={120} value={value.name} onChange={name=>onChange({name})} placeholder={t('e.g. Left wall opening')} />}
    <div className={styles.sizeRow}>
      {numeric('measured',t('Measured size'))}
      <SelectField label={t('Unit')} isDisabled={disabled} selectedKey={value.unit} items={['mm','cm','m','in','ft'].map(id=>({id,label:id}))} onSelectionChange={key=>{if(key&&key!==value.unit)onChange({unit:String(key),approximate:null,measured:null});}} />
    </div>
    <TextInput label={t('Notes (optional)')} isDisabled={disabled} maxLength={2000} value={value.evidence} onChange={evidence=>onChange({evidence})} placeholder={t('Anything to remember about this measurement')} />
    {value.approximate !== null && numeric('approximate',t('Existing estimate ({unit})',{unit:value.unit}))}
  </div>;
}
