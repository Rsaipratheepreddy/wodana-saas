"use client";

import { parseDate } from "@internationalized/date";
import { useState } from "react";
import { Button, DateField, Form, InlineNotice, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalMilestone } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { AttachFiles } from "./attach-files";

const AMOUNT = /^\d{1,14}([.,]\d{1,4})?$/;

/**
 * "I've paid": when, the bank reference and a photo of the receipt, so the team can match it to the bank. It is
 * the client's word until finance records the payment.
 */
export function PaidForm({ milestone, caseId, currency, today, api, format, onDone }: {
  milestone: PortalMilestone; caseId: string; currency: string | null; today: string; api: PortalApi; format: PortalFormat; onDone: () => void;
}) {
  const t = useT();
  const [paidOn, setPaidOn] = useState<string | null>(today);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const cleanAmount = amount.trim().replace(",", ".");
  const amountError = cleanAmount && !AMOUNT.test(cleanAmount) ? t("Enter the amount you paid.") : "";
  const ready = Boolean(paidOn) && paidOn! <= today && !amountError && (reference.trim() || uploads.length) && !uploading;
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api.command(id, { action: "report_payment", caseId, paymentId: milestone.id, paidOn, amount: cleanAmount || undefined, reference: reference.trim(), note: note.trim(), uploadIds: uploads });
      onDone();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {milestone.left ? <p className={styles.muted}>{t("{amount} left", { amount: format.money(milestone.left, currency) })}</p> : null}
    <DateField label={t("Paid on")} isRequired value={paidOn ? parseDate(paidOn) : null} maxValue={parseDate(today)} onChange={(value) => setPaidOn(value ? value.toString() : null)} />
    <TextInput label={t("Amount paid")} description={t("Optional")} inputMode="decimal" value={amount} onChange={setAmount} isInvalid={Boolean(amountError)} errorMessage={amountError || undefined}
      prefix={currency ?? undefined} maxLength={20} />
    <TextInput label={t("Bank reference")} value={reference} onChange={setReference} maxLength={120} />
    <AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} max={5} label={t("Add the receipt")} />
    <TextAreaField label={t("Note")} value={note} onChange={setNote} maxLength={1000} />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!ready}>{t("Send")}</Button></div>
  </Form>;
}
