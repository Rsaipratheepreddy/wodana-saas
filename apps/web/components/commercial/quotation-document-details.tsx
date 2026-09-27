'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { useState } from 'react';
import type { Quote, QuotePresentation } from '@/lib/commercial/types';
import { quotationPhoto } from '@/lib/commercial/quotation-table';
import { ControlledModalDialog } from '@/design-system';
import s from './quotation-builder-shell.module.css';
const fields: [
    keyof NonNullable<QuotePresentation['details']>,
    MessageKey
][] = [['clientName', tKey('Client name')], ['clientPhone', tKey('Client phone')], ['clientEmail', tKey('Client email')], ['projectName', tKey('Project name')], ['location', tKey('Delivery address / location')], ['reference', tKey('Quote reference')], ['date', tKey('Issue date')], ['companyName', tKey('Company name')], ['preparedBy', tKey('Prepared by')], ['estimator', tKey('Estimator')], ['manager', tKey('Manager / reviewer')]];
export function QuotationDocumentDetails({ quote, readOnly, onChange, onClose }: {
    quote: Quote;
    readOnly: boolean;
    onChange: (quote: Quote, checkpoint?: boolean) => void;
    onClose: () => void;
}) {
  const t = useT();
    const [details, setDetails] = useState(quote.presentation?.details ?? {}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    return <ControlledModalDialog title={t("Client & project details")} isOpen onOpenChange={open => { if (!open && !busy)
        onClose(); }} size="lg" footer={<div className={s.actions}><button type="button" disabled={busy} onClick={onClose}>{t(readOnly ? 'Close' : 'Cancel')}</button>{!readOnly && <button type="button" className={s.primary} disabled={busy || !details.clientName?.trim()} onClick={() => { onChange({ ...quote, cover: { subtitle: '', ...quote.cover, preparedFor: details.clientName ?? '', location: details.location ?? '' }, presentation: { ...quote.presentation!, details } }, true); onClose(); }}>{t("Apply details")}</button>}</div>}>
  <div className={s.detailsForm}><p>{t("Details are filled from this project when available. Edits here apply to this quotation only.")}</p><fieldset disabled={readOnly || busy}><div className={s.detailsFields}>{fields.map(([key, label]) => <label key={key}>{t(label)}<input maxLength={500} value={details[key] ?? ''} onChange={event => setDetails({ ...details, [key]: event.target.value })}/></label>)}</div><label>{t("Client logo")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (!file)
        return; setBusy(true); setError(''); try {
        const photo = await quotationPhoto(file);
        setDetails(current => ({ ...current, clientLogo: photo }));
    }
    catch (error) {
        setError((error as Error).message);
    }
    finally {
        setBusy(false);
    } }}/></label>{details.clientLogo && <div className={s.clientLogo}><img src={details.clientLogo} alt={t("Client logo")}/><button type="button" onClick={() => setDetails({ ...details, clientLogo: '' })}>{t("Remove logo")}</button></div>}</fieldset>{error && <p role="alert">{error}</p>}</div>
 </ControlledModalDialog>;
}
