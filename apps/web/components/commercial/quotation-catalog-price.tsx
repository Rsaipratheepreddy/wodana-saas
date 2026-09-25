"use client";

import { useState, type FormEvent } from "react";
import type { QuoteLine } from "@/lib/commercial/types";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import { catalogPriceInput, catalogPriceProvenance, catalogResolvedRate, priceBasisCurrent, type CatalogPriceResult } from "@/lib/commercial/catalog-price";
import { Button, ControlledModalDialog, Form, MoneyInput, TextInput } from "@/design-system";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const current = priceBasisCurrent(line, currency, taxRate);
  const input = catalogPriceInput(line, currency, taxRate);
  const pendingOverride = line.catalogPriceRequest?.action === "override";
  const status = !input ? "Choose a catalog item" : pendingOverride ? "Override · save to confirm" : !current ? "Price needs refresh" : line.catalogPrice?.status === "resolved" ? line.catalogPrice.source === "manual_override" ? "Approved override" : "Catalog price" : "Price unavailable";
  const provenance = catalogPriceProvenance(line.catalogPrice);

  async function resolve() {
    if (!input || busy) return;
    setBusy(true); setError("");
    try {
      const result = await jsonRequest<CatalogPriceResult>(commercialPath(workspaceId, `cases/${caseId}/catalog-price`), "POST", input);
      if (!onApply(line, currency, taxRate, {
        catalogPrice: result.snapshot,
        catalogPriceRequest: { action: "resolve" },
        rate: catalogResolvedRate(result.snapshot),
      })) setError("The item changed while its price was checked. Check it again.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not check the selling price."); }
    finally { setBusy(false); }
  }

  function applyOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = Number(amount);
    if (!input || !Number.isFinite(rate) || rate <= 0 || rate > 1e8 || !reason.trim()) return;
    setError("");
    if (!onApply(line, currency, taxRate, { rate, pricingMode: "item", catalogPriceRequest: { action: "override", reason: reason.trim() } })) {
      setError("The item changed. Reopen the price override and try again.");
      return;
    }
    setOverride(false);
  }

  const needsAttention = !current || line.catalogPrice?.status !== "resolved";
  return <>
    <div className={styles.cell}>
      {showRate ? <strong className={styles.rate}>{line.rate.toFixed(2)}</strong> : null}
      <span className={styles.status} data-issue={needsAttention || undefined}>{status}</span>
      <button type="button" className={styles.reviewButton} onClick={() => setReviewOpen(true)} aria-label={`Review price for ${line.title}`}>Review price</button>
    </div>
    <ControlledModalDialog title={`Price review · ${line.title}`} isOpen={reviewOpen} onOpenChange={open => { if (!busy) { setReviewOpen(open); if (!open) setOverride(false); } }} size="md" footer={<div className={styles.footer}>
      <Button size="compact" variant="quiet" onPress={() => { setReviewOpen(false); setOverride(false); }} isDisabled={busy}>Close</Button>
      {!readOnly && line.pricingMode !== "materials" ? <Button size="compact" variant="secondary" isDisabled={!input} isLoading={busy} onPress={() => void resolve()}>{current ? "Refresh price" : "Check price"}</Button> : null}
      {!readOnly && canOverride && input ? <Button size="compact" variant="primary" onPress={() => { setAmount(line.rate > 0 ? String(line.rate) : ""); setReason(""); setOverride(open => !open); }}>{override ? "Cancel override" : "Override price"}</Button> : null}
    </div>}>
      <div className={styles.review}>
        <div className={styles.reviewSummary}><span>Unit rate</span><strong>{currency} {line.rate.toFixed(2)}</strong></div>
        <p className={styles.reviewStatus} data-issue={needsAttention || undefined}>{status}</p>
        {provenance ? <div className={styles.provenance}>
          <strong>{provenance.basis}</strong>
          <p>{provenance.detail}</p>
          {provenance.issue ? <p className={styles.issue}>{provenance.issue}</p> : null}
        </div> : <p className={styles.explanation}>Check this catalogue item to retrieve its current selling price.</p>}
        {override ? <Form className={styles.override} onSubmit={applyOverride}>
          <MoneyInput aria-label={`Override rate for ${line.title}`} currency={currency} label="Unit rate" minValue={0.01} maxValue={100000000} step={0.01} isRequired value={amount ? Number(amount) : undefined} onChange={(value) => setAmount(String(value))} />
          <TextInput aria-label={`Override reason for ${line.title}`} label="Reason" maxLength={500} isRequired value={reason} onChange={setReason} />
          <Button type="submit" size="compact" variant="primary">Use override</Button>
        </Form> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </div>
    </ControlledModalDialog>
  </>;
}
