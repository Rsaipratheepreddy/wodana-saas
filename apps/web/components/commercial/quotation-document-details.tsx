'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { useState } from 'react';
import type { Quote, QuotePresentation } from '@/lib/commercial/types';
import { quotationPhoto } from '@/lib/commercial/quotation-table';
import { Button, DateField, EmailInput, FileUploader, FormDialog, FormRow, FormSection, MoreDetails, PhoneNumberField, TextInput } from '@/design-system';
import { parseDate } from '@internationalized/date';
import s from './quotation-builder-shell.module.css';

type Details = NonNullable<QuotePresentation['details']>;
type Key = keyof Details;
const text = (key: Key, label: MessageKey) => ({ key, label });
const client = [text('clientName', tKey('Client name')), text('projectName', tKey('Project name')), text('location', tKey('Delivery address / location'))];
const team = [text('companyName', tKey('Company name')), text('preparedBy', tKey('Prepared by')), text('estimator', tKey('Estimator')), text('manager', tKey('Manager / reviewer'))];
const dateOf = (value?: string) => { try { return value ? parseDate(value.slice(0, 10)) : null; } catch { return null; } };

/** The client and project details printed on this quotation (filled from the project; edits stay on this quotation). */
export function QuotationDocumentDetails({ quote, readOnly, onChange, onClose }: {
  quote: Quote;
  readOnly: boolean;
  onChange: (quote: Quote, checkpoint?: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const saved = quote.presentation?.details ?? {};
  const [details, setDetails] = useState<Details>(saved);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: Key, value: string) => setDetails((current) => ({ ...current, [key]: value }));
  const field = ({ key, label }: { key: Key; label: MessageKey }) => <TextInput key={key} isRequired={key === 'clientName'} isReadOnly={readOnly} label={t(label)} maxLength={500}
    value={details[key] ?? ''} onChange={(value) => set(key, value)} />;
  const dirty = JSON.stringify(details) !== JSON.stringify(saved);
  const addLogo = async (file?: File) => {
    if (!file) return;
    setBusy(true); setProblem('');
    try { const photo = await quotationPhoto(file); setDetails((current) => ({ ...current, clientLogo: photo })); }
    catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  };
  return <FormDialog title={t("Client & project details")} size="lg" onClose={onClose} isDirty={dirty} hideSubmit={readOnly} cancelLabel={readOnly ? t('Close') : undefined}
    isSubmitting={busy} submitLabel={t("Apply details")} closeOnSuccess error={problem || undefined}
    onSubmit={() => onChange({ ...quote, cover: { subtitle: '', ...quote.cover, preparedFor: details.clientName ?? '', location: details.location ?? '' }, presentation: { ...quote.presentation!, details } }, true)}>
    <FormSection title={t("Client")}>
      {client.map(field)}
      <FormRow>
        <PhoneNumberField isReadOnly={readOnly} label={t("Client phone")} value={details.clientPhone ?? ''} onChange={(value) => set('clientPhone', value)} />
        <EmailInput isReadOnly={readOnly} label={t("Client email")} maxLength={254} value={details.clientEmail ?? ''} onChange={(value) => set('clientEmail', value)} />
      </FormRow>
    </FormSection>
    <FormSection title={t("Quotation")}>
      <FormRow>
        <TextInput isReadOnly={readOnly} label={t("Quote reference")} maxLength={500} value={details.reference ?? ''} onChange={(value) => set('reference', value)} />
        <DateField isReadOnly={readOnly} label={t("Issue date")} value={dateOf(details.date)} onChange={(date) => set('date', date?.toString() ?? '')} />
      </FormRow>
    </FormSection>
    <MoreDetails filled={team.filter(({ key }) => details[key]).length + (details.clientLogo ? 1 : 0)}>
      <FormSection title={t("Your team")}>{team.map(field)}</FormSection>
      {readOnly ? null : <FileUploader accept="image/png,image/jpeg,image/webp" appearance="button" label={t("Client logo")} multiple={false} onFiles={(files) => void addLogo(files[0])} />}
      {details.clientLogo ? <div className={s.clientLogo}><img src={details.clientLogo} alt={t("Client logo")} />{readOnly ? null : <Button size="compact" variant="quiet" onPress={() => set('clientLogo', '')}>{t("Remove logo")}</Button>}</div> : null}
    </MoreDetails>
  </FormDialog>;
}
