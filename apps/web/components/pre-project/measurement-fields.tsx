"use client";

import { useState } from 'react';
import { NumericInput, SelectField, TextInput } from '@/design-system';
import type { ItemDimension } from '@/lib/pre-project/content';
import styles from './measurement-fields.module.css';

/** The same fields and units are used when capturing and revising a measurement. */
export function MeasurementFields({ value, onChange, disabled, requireMeasured = false }: {
  value: ItemDimension;
  onChange: (patch: Partial<ItemDimension>) => void;
  disabled: boolean;
  requireMeasured?: boolean;
}) {
  const types = ['Length','Width','Height','Depth','Thickness','Diameter','Radius'];
  const [custom, setCustom] = useState(Boolean(value.name && !types.includes(value.name)));
  const numeric = (key: 'measured' | 'approximate', label: string) => <NumericInput
    label={label} isRequired={key === 'measured' && requireMeasured} isDisabled={disabled}
    minValue={0.0001} maxValue={1000000} step={0.0001} formatOptions={{maximumFractionDigits:4,useGrouping:false}}
    value={value[key] ?? NaN} onChange={next => onChange({[key]:Number.isFinite(next) ? next : null})} />;
  return <div className={styles.fields}>
    <SelectField label="Measurement type" isRequired isDisabled={disabled} selectedKey={custom?'custom':value.name||null} placeholder="Choose a dimension…" items={[...types.map(id=>({id,label:id})),{id:'custom',label:'Custom dimension'}]} onSelectionChange={key=>{setCustom(key==='custom');onChange({name:key==='custom'?'':String(key??'')});}} />
    {custom && <TextInput label="Dimension name" isRequired isDisabled={disabled} maxLength={120} value={value.name} onChange={name=>onChange({name})} placeholder="e.g. Left wall opening" />}
    <div className={styles.sizeRow}>
      {numeric('measured','Measured size')}
      <SelectField label="Unit" isDisabled={disabled} selectedKey={value.unit} items={['mm','cm','m','in','ft'].map(id=>({id,label:id}))} onSelectionChange={key=>{if(key&&key!==value.unit)onChange({unit:String(key),approximate:null,measured:null});}} />
    </div>
    <TextInput label="Notes (optional)" isDisabled={disabled} maxLength={2000} value={value.evidence} onChange={evidence=>onChange({evidence})} placeholder="Anything to remember about this measurement" />
    {value.approximate !== null && numeric('approximate',`Existing estimate (${value.unit})`)}
  </div>;
}
