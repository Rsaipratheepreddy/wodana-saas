"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SelectField, EmptyState, InlineNotice, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { purchasingApi } from "@/lib/purchasing/client";
import type { PurchasingSettings } from "@/lib/purchasing/types";
import { quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

/** Settings → Purchasing: from what amount an order needs approval, what must be true before one is placed, and how deliveries are received. */
export function PurchasingSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<{ settings: PurchasingSettings; canManage: boolean; currency: string | null } | null>(null);
  const [form, setForm] = useState<{ always: boolean; threshold: string; approval: boolean; signoff: boolean; approved: boolean; inspection: boolean; tolerance: string; sitePhoto: boolean; adjustLimit: string; ahead: string; invoiceTolerance: string; guard: "off" | "warn" | "strict"; runs: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = (next: { settings: PurchasingSettings; canManage: boolean; currency: string | null }) => {
    setData(next);
    const value = next.settings.approvalThreshold;
    setForm({ approval: value !== null, always: value !== null && Number(value) === 0, threshold: value && Number(value) ? value.replace(/\.?0+$/, "") : "",
      signoff: next.settings.requireMaterialSignoff, approved: next.settings.requireApprovedSupplier, inspection: next.settings.requireInspection,
      tolerance: quantityText(next.settings.receiveTolerancePercent) || "0", sitePhoto: next.settings.requireSitePhoto,
      adjustLimit: next.settings.stockAdjustApprovalValue ? quantityText(next.settings.stockAdjustApprovalValue) : "", ahead: String(next.settings.orderAheadDays),
      invoiceTolerance: quantityText(next.settings.invoiceTolerancePercent) || "0", guard: next.settings.spendingGuard, runs: next.settings.paymentRunsRequired });
  };
  const load = useCallback(async () => {
    try { accept(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data || !form) return <Skeleton lines={6} shape="form" />;
  const readOnly = !data.canManage;
  const threshold = !form.approval ? null : form.always ? "0" : form.threshold;
  const save = async () => {
    setBusy(true); setError("");
    try {
      const settings = await api.saveSettings({ version: data.settings.version, approvalThreshold: threshold, requireMaterialSignoff: form.signoff, requireApprovedSupplier: form.approved,
        requireInspection: form.inspection, receiveTolerancePercent: form.tolerance || "0", requireSitePhoto: form.sitePhoto,
        stockAdjustApprovalValue: form.adjustLimit || null, orderAheadDays: Number(form.ahead || "0"), invoiceTolerancePercent: form.invoiceTolerance || "0", spendingGuard: form.guard,
        paymentRunsRequired: form.runs });
      accept({ ...data, settings });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  return <SettingsPage title={t("Purchasing")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="approval" title={t("Approval")}>
      <SettingsRow label={t("Orders need approval")} hint={t("Someone other than the buyer approves before an order goes to the supplier.")}>
        <Switch aria-label={t("Orders need approval")} isDisabled={readOnly} isSelected={form.approval} onChange={(approval) => setForm({ ...form, approval })} />
      </SettingsRow>
      {form.approval ? <SettingsRow label={t("Every order")} hint={t("Off: only orders from an amount need approval.")}>
        <Switch aria-label={t("Every order")} isDisabled={readOnly} isSelected={form.always} onChange={(always) => setForm({ ...form, always })} />
      </SettingsRow> : null}
      {form.approval && !form.always ? <SettingsRow label={t("From this amount")} hint={t("Orders in another currency always need approval.")}>
        <TextInput aria-label={t("From this amount")} label={null} isReadOnly={readOnly} inputMode="decimal" suffix={data.currency ?? undefined} value={form.threshold}
          onChange={(value) => setForm({ ...form, threshold: value.replace(/[^\d.]/g, "") })} />
      </SettingsRow> : null}
    </SettingsSection>
    <SettingsSection id="before" title={t("Before an order is placed")}>
      <SettingsRow label={t("Client signed off the material list")} hint={t("Nothing for a project is ordered until its client signs off the materials.")}>
        <Switch aria-label={t("Client signed off the material list")} isDisabled={readOnly} isSelected={form.signoff} onChange={(signoff) => setForm({ ...form, signoff })} />
      </SettingsRow>
      <SettingsRow label={t("Supplier approved")} hint={t("Orders go only to approved suppliers.")}>
        <Switch aria-label={t("Supplier approved")} isDisabled={readOnly} isSelected={form.approved} onChange={(approved) => setForm({ ...form, approved })} />
      </SettingsRow>
      <SettingsRow label={t("Order ahead")} hint={t("Days before it's needed that something is ordered, when the supplier's lead time isn't known.")}>
        <TextInput aria-label={t("Order ahead")} label={null} isReadOnly={readOnly} inputMode="numeric" suffix={t("days")} value={form.ahead}
          onChange={(value) => setForm({ ...form, ahead: value.replace(/\D/g, "").slice(0, 3) })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="money" title={t("Project money")}>
      <SettingsRow label={t("Orders beyond the money in hand")} hint={t("Money in hand is what the client paid, less what's spent and already ordered.")}>
        <SelectField aria-label={t("Orders beyond the money in hand")} label={null} isDisabled={readOnly} selectedKey={form.guard}
          onSelectionChange={(key) => setForm({ ...form, guard: (key ?? "off") as "off" | "warn" | "strict" })}
          items={[{ id: "off", label: t("Go ahead") }, { id: "warn", label: t("Go ahead and tell the managers") }, { id: "strict", label: t("Wait for someone who may override") }]} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="receiving" title={t("Receiving")}>
      <SettingsRow label={t("Inspect deliveries")} hint={t("Someone other than the receiver accepts or rejects what arrived.")}>
        <Switch aria-label={t("Inspect deliveries")} isDisabled={readOnly} isSelected={form.inspection} onChange={(inspection) => setForm({ ...form, inspection })} />
      </SettingsRow>
      <SettingsRow label={t("Photo of site deliveries")} hint={t("A delivery received at a project's site needs a photo.")}>
        <Switch aria-label={t("Photo of site deliveries")} isDisabled={readOnly} isSelected={form.sitePhoto} onChange={(sitePhoto) => setForm({ ...form, sitePhoto })} />
      </SettingsRow>
      <SettingsRow label={t("Over-delivery allowed")} hint={t("How much more than ordered can be received on a line.")}>
        <TextInput aria-label={t("Over-delivery allowed")} label={null} isReadOnly={readOnly} inputMode="decimal" suffix="%" value={form.tolerance}
          onChange={(value) => setForm({ ...form, tolerance: value.replace(/[^\d.]/g, "") })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="invoices" title={t("Supplier invoices")}>
      <SettingsRow label={t("Price difference allowed")} hint={t("How far above the ordered price an invoice can be before it's held for approval.")}>
        <TextInput aria-label={t("Price difference allowed")} label={null} isReadOnly={readOnly} inputMode="decimal" suffix="%" value={form.invoiceTolerance}
          onChange={(value) => setForm({ ...form, invoiceTolerance: value.replace(/[^\d.]/g, "") })} />
      </SettingsRow>
      <SettingsRow label={t("Pay through approved runs")} hint={t("Invoices are paid only in a payment run someone else approved. Advances on orders are still recorded directly.")}>
        <Switch aria-label={t("Pay through approved runs")} isDisabled={readOnly} isSelected={form.runs} onChange={(runs) => setForm({ ...form, runs })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="stock" title={t("Stock")}>
      <SettingsRow label={t("Corrections needing approval")} hint={t("A stock count that changes more than this value waits for someone else. Empty: none do.")}>
        <TextInput aria-label={t("Corrections needing approval")} label={null} isReadOnly={readOnly} inputMode="decimal" suffix={data.currency ?? undefined} value={form.adjustLimit}
          onChange={(value) => setForm({ ...form, adjustLimit: value.replace(/[^\d.]/g, "") })} />
      </SettingsRow>
    </SettingsSection>
    {readOnly ? null : <div className={styles.actions}>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={(form.approval && !form.always && !(Number(form.threshold) > 0)) || Number(form.tolerance || 0) > 50 || Number(form.invoiceTolerance || 0) > 50} onPress={() => void save()}>{t("Save")}</Button>
    </div>}
  </SettingsPage>;
}
