"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type FormEvent } from "react";
import type { QuoteLine } from "@/lib/commercial/types";
import { commercialPath, jsonRequest, money } from "@/lib/commercial/client";
import { translateKnown } from "@/lib/i18n/keys";
import { catalogPriceInput, catalogPriceProvenance, catalogResolvedRate, priceBasisCurrent, type CatalogPriceResult } from "@/lib/commercial/catalog-price";
import { Badge, Button, ControlledModalDialog, Form, InlineNotice, MoneyField, TextInput, useDesignSystem } from "@/design-system";
import styles from "./quotation-catalog-price.module.css";

export function QuotationCatalogPrice({ line, currency, taxRate, workspaceId, caseId, readOnly, canOverride, showRate = true, onApply }: {
  line: QuoteLine;
  currency: string;
  taxRate: number;
  workspaceId: string;
  caseId: string;
  readOnly: boolean;
  canOverride: boolean;
  showRate?: boolean;
  onApply: (basis: QuoteLine, currency: string, taxRate: number, patch: Partial<QuoteLine>) => boolean;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const current = priceBasisCurrent(line, currency, taxRate);
  const input = catalogPriceInput(line, currency, taxRate);
  const pendingOverride = line.catalogPriceRequest?.action === "override";
  const status = t(!input ? "Choose a catalog item" : pendingOverride ? "Override · save to confirm" : !current ? "Price needs refresh" : line.catalogPrice?.status === "resolved" ? line.catalogPrice.source === "manual_override" ? "Approved override" : "Catalog price" : "Price unavailable");
  const provenance = catalogPriceProvenance(line.catalogPrice, { t, locale, timeZone });

  async function resolve() {
    if (!input || busy) return;
    setBusy(true); setError("");
    try {
      const result = await jsonRequest<CatalogPriceResult>(commercialPath(workspaceId, `cases/${caseId}/catalog-price`), "POST", input);
      if (!onApply(line, currency, taxRate, {
        catalogPrice: result.snapshot,
        catalogPriceRequest: { action: "resolve" },
        rate: catalogResolvedRate(result.snapshot),
      })) setError(t("The item changed while its price was checked. Check it again."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not check the selling price.")); }
    finally { setBusy(false); }
  }

  function applyOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = Number(amount);
    if (!input || !Number.isFinite(rate) || rate <= 0 || rate > 1e8 || !reason.trim()) return;
    setError("");
    if (!onApply(line, currency, taxRate, { rate, pricingMode: "item", catalogPriceRequest: { action: "override", reason: reason.trim() } })) {
      setError(t("The item changed. Reopen the price override and try again."));
      return;
    }
    setOverride(false);
  }

  const needsAttention = !current || line.catalogPrice?.status !== "resolved";
  return <>
    <div className={styles.cell}>
      {showRate ? <strong className={styles.rate}>{line.rate.toFixed(2)}</strong> : null}
      <Badge tone={needsAttention ? "warning" : "neutral"}>{status}</Badge>
      <Button size="compact" variant="quiet" onPress={() => setReviewOpen(true)} aria-label={t("Review price for {title}", { title: line.title })}>{t("Review price")}</Button>
    </div>
    <ControlledModalDialog title={t("Price review · {title}", { title: line.title })} isOpen={reviewOpen} onOpenChange={open => { if (!busy) { setReviewOpen(open); if (!open) setOverride(false); } }} size="md" footer={<div className={styles.footer}>
      <Button size="compact" variant="quiet" onPress={() => { setReviewOpen(false); setOverride(false); }} isDisabled={busy}>{t("Close")}</Button>
      {!readOnly && line.pricingMode !== "materials" ? <Button size="compact" variant="secondary" isDisabled={!input} isLoading={busy} onPress={() => void resolve()}>{t(current ? "Refresh price" : "Check price")}</Button> : null}
      {!readOnly && canOverride && input ? <Button size="compact" variant="primary" onPress={() => { setAmount(line.rate > 0 ? String(line.rate) : ""); setReason(""); setOverride(open => !open); }}>{t(override ? "Cancel override" : "Override price")}</Button> : null}
    </div>}>
      <div className={styles.review}>
        {error ? <InlineNotice tone="error" message={translateKnown(t, error)} /> : null}
        <div className={styles.reviewSummary}><span>{t("Unit rate")}</span><strong>{money(line.rate, currency, locale)}</strong></div>
        <p className={styles.reviewStatus} data-issue={needsAttention || undefined}>{status}</p>
        {provenance ? <div className={styles.provenance}>
          <strong>{provenance.basis}</strong>
          <p>{provenance.detail}</p>
          {provenance.issue ? <p className={styles.issue}>{provenance.issue}</p> : null}
        </div> : <p className={styles.explanation}>{t("Check this catalogue item to retrieve its current selling price.")}</p>}
        {override ? <Form className={styles.override} onSubmit={applyOverride}>
          <MoneyField aria-label={t("Override rate for {title}", { title: line.title })} currency={currency} label={t("Unit rate")} min="0.01" max="100000000" isRequired value={amount} onChange={setAmount} />
          <TextInput aria-label={t("Override reason for {title}", { title: line.title })} label={t("Reason")} maxLength={500} isRequired value={reason} onChange={setReason} />
          <Button type="submit" size="compact" variant="primary">{t("Use override")}</Button>
        </Form> : null}
      </div>
    </ControlledModalDialog>
  </>;
}
