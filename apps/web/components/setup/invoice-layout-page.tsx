"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState, InlineNotice, SaveBar, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalInvoiceDocument } from "@/lib/client-portal/types";
import { DEFAULT_INVOICE_LAYOUT, loadInvoiceLayout, saveInvoiceLayout, type InvoiceLayout } from "@/lib/setup/documents";
import { InvoicePrint } from "../client-portal/portal-document-print";
import { usePortalFormat } from "../client-portal/portal-format";
import { useWorkspaceIdentity } from "../workspace/workspace-identity";
import styles from "./setup.module.css";

/** A sample invoice for the preview (its amounts are an example; real invoices always carry the system's figures). */
const sample = (currency: string, layout: InvoiceLayout, company: string): PortalInvoiceDocument => ({
  number: "INV-0001", issueDate: "2026-10-17", dueDate: "2026-10-31", currency, milestone: "Design fee", reference: "J-000001",
  company: { name: company, address: "", taxNumber: "" }, customer: { name: "Client name", address: "", taxNumber: "" },
  lines: [{ description: "Design fee", taxRate: "5", net: "15000.00", tax: "750.00", total: "15750.00" }],
  net: "15000.00", tax: "750.00", total: "15750.00", paid: "0.00", balance: "15750.00", note: "", status: "due", credit: null, layout,
});

/**
 * §0.3 P3/P4, Setup → Invoice layout: the firm sets its invoice's title, which blocks show and its own wording (how
 * to pay, terms, a footer line); the preview beside it is the very page the client prints. Amounts, taxes and numbers
 * are always the system's.
 */
export function InvoiceLayoutPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, currency, timeZone } = useDesignSystem();
  const identity = useWorkspaceIdentity();
  const format = usePortalFormat({ locale, currency: currency ?? "", timeZone, country: null });
  const [saved, setSaved] = useState<{ layout: InvoiceLayout; revision: number } | null>(null);
  const [form, setForm] = useState<InvoiceLayout>(DEFAULT_INVOICE_LAYOUT);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const load = useCallback(() => { setFailure(""); loadInvoiceLayout(workspaceId).then((next) => { setSaved(next); setForm(next.layout); }).catch((error: Error) => setFailure(error.message)); }, [workspaceId]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  const set = <K extends keyof InvoiceLayout>(key: K) => (value: InvoiceLayout[K]) => { setJustSaved(false); setForm((current) => ({ ...current, [key]: value })); };
  if (failure && !saved) return <SettingsPage title={t("Invoice layout")}><ErrorState description={failure} onRetry={load} /></SettingsPage>;
  if (!saved) return <SettingsPage title={t("Invoice layout")}><Skeleton lines={6} shape="form" /></SettingsPage>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved.layout);
  const save = async () => {
    setBusy(true); setFailure("");
    try { const next = await saveInvoiceLayout(workspaceId, saved.revision, form); setSaved(next); setForm(next.layout); setJustSaved(true); }
    catch (error) { setFailure((error as Error).message); }
    setBusy(false);
  };
  return <SettingsPage title={t("Invoice layout")} width="wide">
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <div className={styles.split}>
      <div className={styles.splitForm}>
        <SettingsSection id="invoice-layout" title={t("Layout")}>
          <SettingsRow label={t("Title")}><TextInput aria-label={t("Title")} label={null} maxLength={60} value={form.title} onChange={set("title")} /></SettingsRow>
          <SettingsRow label={t("Tax on each line")}><Switch aria-label={t("Tax on each line")} isSelected={form.lineTax} onChange={set("lineTax")} /></SettingsRow>
          <SettingsRow label={t("Job reference")}><Switch aria-label={t("Job reference")} isSelected={form.reference} onChange={set("reference")} /></SettingsRow>
          <SettingsRow label={t("Paid and left to pay")}><Switch aria-label={t("Paid and left to pay")} isSelected={form.balance} onChange={set("balance")} /></SettingsRow>
        </SettingsSection>
        <SettingsSection id="invoice-wording" title={t("Wording")}>
          <TextAreaField label={t("How to pay")} maxLength={1000} value={form.payment} onChange={set("payment")} />
          <TextAreaField label={t("Terms")} maxLength={2000} value={form.terms} onChange={set("terms")} />
          <TextInput label={t("Footer")} maxLength={300} value={form.footer} onChange={set("footer")} />
        </SettingsSection>
      </div>
      <section className={styles.preview} aria-label={t("Preview")}>
        <InvoicePrint invoice={sample(currency ?? "AED", form, identity?.name ?? "")} brand={{ name: identity?.name ?? "", logoUrl: identity?.logoUrl ?? null }} format={format} preview />
      </section>
    </div>
    <SaveBar isDirty={dirty} isSaving={busy} saved={justSaved} onSave={() => void save()} onDiscard={() => setForm(saved.layout)} />
  </SettingsPage>;
}
