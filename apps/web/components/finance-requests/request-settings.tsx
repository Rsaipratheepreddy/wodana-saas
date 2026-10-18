"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmailInput, EmptyState, ErrorState, FormDialog, FormSection, InlineNotice, InspectorSheet, NumericInput, Skeleton, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FinanceRequestsApi } from "@/lib/finance-requests/client";
import type { PaymentMethod, RequestSettingsState } from "@/lib/finance-requests/types";
import styles from "./finance-requests.module.css";

/**
 * Finance › Requests › Settings: where every request is emailed (empty: nobody by email), whether a reached
 * payment stage raises its invoice request, and the payment methods a refund picks from, each with its refund
 * guidance and how many days a refund usually takes (PLM-109; empty: no date shown). Approval amounts are set
 * in Settings → Approvals (Refund, Payable request).
 */
export function RequestSettings({ api, onClose }: { api: FinanceRequestsApi; onClose: () => void }) {
  const t = useT();
  const [state, setState] = useState<RequestSettingsState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inbox, setInbox] = useState("");
  const [stage, setStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | "new" | null>(null);
  const show = (next: RequestSettingsState) => {
    setState(next); setInbox(next.settings.financeInbox ?? ""); setStage(next.settings.stageInvoiceRequests);
  };
  useEffect(() => {
    let live = true;
    api.settings().then((next) => { if (live) show(next); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Settings didn't load.")); });
    return () => { live = false; };
  }, [api, t]);
  const canManage = Boolean(state?.canManage);
  const save = async () => {
    setBusy(true); setNotice("");
    try { show(await api.saveSettings("save_settings", { version: state!.settings.version, financeInbox: inbox.trim(), stageInvoiceRequests: stage })); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  return <InspectorSheet isOpen size="md" title={t("Request settings")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={canManage ? <div className="wd-dialog-actions"><span className={styles.spacer} /><Button variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></div> : null}>
    {error ? <ErrorState description={error} /> : !state ? <Skeleton shape="form" lines={4} /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      <EmailInput label={t("Finance inbox")} description={t("Every request is emailed here. Leave it empty to send none.")} isReadOnly={!canManage} maxLength={320} value={inbox} onChange={setInbox} />
      <Switch isSelected={stage} isDisabled={!canManage} onChange={setStage}>{t("Raise the invoice request when a payment stage is due")}</Switch>
      <InlineNotice tone="info" message={t("Approval amounts and approvers are in Settings → Approvals.")} />
      <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Payment methods")}</h3>
        {state.methods.length ? <ul className={styles.list}>{state.methods.map((method) => <li key={method.id}>
          <span className={styles.nameCell}><span>{method.label}</span>
            {method.refundDays || method.refundGuidance ? <small>{[method.refundDays ? t("Refund in {days} days", { days: method.refundDays }) : null, method.refundGuidance || null]
              .filter(Boolean).join(" · ")}</small> : null}</span>
          {canManage ? <Button size="compact" variant="quiet" onPress={() => setEditing(method)}>{t("Edit")}</Button> : null}</li>)}</ul>
          : <EmptyState illustration={null} title={t("No payment methods yet.")} />}
        {canManage ? <div><Button size="compact" variant="quiet" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("Add payment method")}</Button></div> : null}
      </section>
    </div>}
    {editing ? <MethodDialog api={api} method={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(next) => { setEditing(null); show(next); }} /> : null}
  </InspectorSheet>;
}

function MethodDialog({ api, method, onClose, onSaved }: { api: FinanceRequestsApi; method: PaymentMethod | null; onClose: () => void; onSaved: (state: RequestSettingsState) => void }) {
  const t = useT();
  const [id] = useState(() => method?.id ?? crypto.randomUUID());
  const [label, setLabel] = useState(method?.label ?? "");
  const [guidance, setGuidance] = useState(method?.refundGuidance ?? "");
  const [bank, setBank] = useState(method?.needsBankDetails ?? false);
  const [days, setDays] = useState(method?.refundDays ? String(method.refundDays) : "");
  return <FormDialog title={method ? t("Edit payment method") : t("Add payment method")} onClose={onClose} isDirty submitLabel={t("Save")} isSubmitDisabled={!label.trim()}
    onSubmit={async () => onSaved(await api.saveSettings("save_method", { id, version: method?.version, label: label.trim(), refundGuidance: guidance.trim(), needsBankDetails: bank,
      refundDays: days.trim() || null }))}
    secondaryAction={method ? <Button variant="quiet" intent="write" onPress={async () => onSaved(await api.saveSettings("archive_method", { id, version: method.version }))}>{t("Archive")}</Button> : undefined}>
    <FormSection>
      <TextInput label={t("Name")} isRequired maxLength={80} value={label} onChange={setLabel} />
      <NumericInput label={t("Refund days")} description={t("How long a refund this way usually takes after approval. Leave it empty to show no date.")}
        minValue={0} maxValue={999} formatOptions={{ maximumFractionDigits: 0 }} value={days === "" ? Number.NaN : Number(days)}
        onChange={(next) => setDays(Number.isFinite(next) ? String(next) : "")} />
      <TextAreaField label={t("Refund guidance")} description={t("Shown to whoever asks for a refund paid this way.")} maxLength={1000} value={guidance} onChange={setGuidance} />
      <Switch isSelected={bank} onChange={setBank}>{t("A refund needs the client's bank details")}</Switch>
    </FormSection>
  </FormDialog>;
}
