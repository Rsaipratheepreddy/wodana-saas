"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmailInput, ErrorState, FormDialog, FormSection, InlineNotice, InspectorSheet, Skeleton, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FinanceRequestsApi } from "@/lib/finance-requests/client";
import type { PaymentMethod, RequestSettingsState } from "@/lib/finance-requests/types";
import styles from "./finance-requests.module.css";

/**
 * Finance › Requests › Settings: where every request is emailed (empty: nobody by email), how many days a
 * refund usually takes (empty: no date shown), whether a reached payment stage raises its invoice request,
 * and the payment methods with the refund guidance shown to whoever asks. Approval amounts are set in
 * Settings → Approvals (Refund, Payable request).
 */
export function RequestSettings({ api, onClose }: { api: FinanceRequestsApi; onClose: () => void }) {
  const t = useT();
  const [state, setState] = useState<RequestSettingsState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inbox, setInbox] = useState("");
  const [days, setDays] = useState("");
  const [stage, setStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | "new" | null>(null);
  const show = (next: RequestSettingsState) => {
    setState(next); setInbox(next.settings.financeInbox ?? ""); setDays(next.settings.refundDays ? String(next.settings.refundDays) : ""); setStage(next.settings.stageInvoiceRequests);
  };
  useEffect(() => {
    let live = true;
    api.settings().then((next) => { if (live) show(next); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Settings didn't load.")); });
    return () => { live = false; };
  }, [api, t]);
  const canManage = Boolean(state?.canManage);
  const save = async () => {
    setBusy(true); setNotice("");
    try { show(await api.saveSettings("save_settings", { version: state!.settings.version, financeInbox: inbox.trim(), refundDays: days.trim() || null, stageInvoiceRequests: stage })); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  return <InspectorSheet isOpen size="md" title={t("Request settings")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={canManage ? <div className="wd-dialog-actions"><span className={styles.spacer} /><Button variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></div> : null}>
    {error ? <ErrorState description={error} /> : !state ? <Skeleton shape="form" lines={4} /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      <EmailInput label={t("Finance inbox")} description={t("Every request is emailed here. Leave it empty to send none.")} isReadOnly={!canManage} maxLength={320} value={inbox} onChange={setInbox} />
      <TextInput label={t("Refund days")} description={t("How long a refund usually takes after approval. Leave it empty to show no date.")} inputMode="numeric" isReadOnly={!canManage}
        maxLength={3} value={days} onChange={(value) => setDays(value.replace(/\D/g, ""))} />
      <Switch isSelected={stage} isDisabled={!canManage} onChange={setStage}>{t("Raise the invoice request when a payment stage is due")}</Switch>
      <p className={styles.muted}>{t("Approval amounts and approvers are in Settings → Approvals.")}</p>
      <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Payment methods")}</h3>
        {state.methods.length ? <ul className={styles.list}>{state.methods.map((method) => <li key={method.id}>
          <span className={styles.nameCell}><span>{method.label}</span>{method.refundGuidance ? <small>{method.refundGuidance}</small> : null}</span>
          {canManage ? <Button size="compact" variant="quiet" onPress={() => setEditing(method)}>{t("Edit")}</Button> : null}</li>)}</ul>
          : <p className={styles.muted}>{t("No payment methods yet.")}</p>}
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
  return <FormDialog title={method ? t("Edit payment method") : t("Add payment method")} onClose={onClose} isDirty submitLabel={t("Save")} isSubmitDisabled={!label.trim()}
    onSubmit={async () => onSaved(await api.saveSettings("save_method", { id, version: method?.version, label: label.trim(), refundGuidance: guidance.trim(), needsBankDetails: bank }))}
    secondaryAction={method ? <Button variant="quiet" intent="write" onPress={async () => onSaved(await api.saveSettings("archive_method", { id, version: method.version }))}>{t("Archive")}</Button> : undefined}>
    <FormSection>
      <TextInput label={t("Name")} isRequired maxLength={80} value={label} onChange={setLabel} />
      <TextAreaField label={t("Refund guidance")} description={t("Shown to whoever asks for a refund paid this way.")} maxLength={1000} value={guidance} onChange={setGuidance} />
      <Switch isSelected={bank} onChange={setBank}>{t("A refund needs the client's bank details")}</Switch>
    </FormSection>
  </FormDialog>;
}
