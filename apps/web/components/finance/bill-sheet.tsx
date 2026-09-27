"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ControlledModalDialog, ErrorState, InlineNotice, InspectorSheet, MenuButton, Skeleton, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { BillState, PayablesState } from "@/lib/payables/types";
import { useProjectFormat } from "../project-core/format";
import { BillEditor } from "./bill-editor";
import { BillStatusLabel, plain, useMethodLabels } from "./finance-labels";
import { PaymentDialog } from "./payment-dialog";
import styles from "./finance.module.css";

type Dialog = "edit" | "approve" | "cancel" | "pay" | null;

/**
 * One supplier invoice: its lines against their orders, why it's held (if it is), who approved it, the
 * supplier's document, and the payments on it. The next step is the primary action.
 */
export function BillSheet({ api, billId, vendors, companies, onChanged, onClose }: {
  api: PayablesApi; billId: string; vendors: PayablesState["vendors"]; companies: PayablesState["companies"]; onChanged: () => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const methods = useMethodLabels();
  const [state, setState] = useState<BillState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try { setState(await api.bill(billId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The invoice didn't load.")); }
  }, [api, billId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  /** Runs one change; a clash with someone else's change reloads the invoice and says so. */
  const run = async (action: "submit" | "approve" | "cancel", input: Record<string, unknown> = {}) => {
    if (!state) return false;
    setBusy(true); setNotice("");
    try { setState(await api.billCommand(action, { id: billId, version: state.bill.version, ...input })); onChanged(); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    } finally { setBusy(false); }
  };
  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy(true); setNotice("");
    try { setState(await api.uploadFile(billId, chosen)); onChanged(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
    finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const bill = state?.bill;
  const money = (value: string) => (bill ? format.money(value, bill.currency) : value);
  const more = !state || !bill ? [] : [
    ...(state.canEdit ? [{ id: "edit", label: t("Edit") }] : []),
    ...(state.canCancel ? [{ id: "cancel", label: t("Cancel invoice") }] : []),
  ];
  const primary = !state || !bill ? null
    : bill.status === "draft" && state.canManage ? <Button variant="primary" isLoading={busy} onPress={() => void run("submit")}>{t("Submit")}</Button>
    : bill.status === "held" && state.canApproveThis ? <Button variant="primary" onPress={() => { setText(""); setDialog("approve"); }}>{t("Approve")}</Button>
    : state.canPay ? <Button variant="primary" onPress={() => setDialog("pay")}>{t("Record payment")}</Button>
    : null;
  const documentOpen = Boolean(state?.canManage && bill && (["draft", "held"].includes(bill.status) || (bill.status === "approved" && !bill.fileName)));

  return <InspectorSheet isOpen size="lg" title={bill ? `${bill.supplierName} · ${bill.number}` : t("Supplier invoice")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state && bill && (primary || more.length) ? <div className="wd-dialog-actions">
      {more.length ? <MenuButton size="compact" label={t("More")} onAction={(id) => { setText(""); setDialog(id as Dialog); }} items={more} /> : null}
      <span className={styles.spacer} />{primary}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !bill ? <Skeleton lines={8} /> : <div className={styles.sheet}>
      <div className={styles.headRow}><BillStatusLabel bill={bill} today={format.today()} /><span className={styles.muted}>{bill.companyName}</span></div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {bill.status === "held" ? <section className={styles.part} aria-label={t("Why it's held")}>
        <h3 className={styles.subhead}>{t("Why it's held")}</h3>
        <ul className={styles.reasons}>{bill.holdReasons.split("\n").map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {!state.canApproveThis && state.canApprove && bill.createdBy ? <p className={styles.muted}>{t("Someone other than who entered it approves it.")}</p> : null}
      </section> : null}
      {bill.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: bill.cancelReason ?? "" })} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Invoice date")}</dt><dd>{format.day(bill.invoiceDate)}</dd></div>
        <div><dt>{t("Due")}</dt><dd>{bill.dueDate ? format.day(bill.dueDate) : "—"}</dd></div>
        <div><dt>{t("Total")}</dt><dd className={styles.money}>{money(bill.total)}</dd></div>
        {bill.status === "approved" ? <div><dt>{t("Left to pay")}</dt><dd className={styles.money}>{money(bill.balance)}</dd></div> : null}
        <div><dt>{t("Entered by")}</dt><dd>{bill.createdByName}</dd></div>
        {bill.approvedByName ? <div><dt>{t("Approved by")}</dt><dd>{[bill.approvedByName, bill.approvalNote].filter(Boolean).join(" · ")}</dd></div> : null}
        <div><dt>{t("Document")}</dt><dd>
          {bill.fileName ? <a href={api.fileUrl(bill.id)} target="_blank" rel="noreferrer">{bill.fileName}</a> : <span className={styles.muted}>{t("None yet")}</span>}
          {documentOpen ? <>
            <input ref={file} type="file" hidden accept="application/pdf,image/*" onChange={(event) => void upload(event.target.files?.[0])} />
            <Button size="compact" variant="quiet" isLoading={busy} onPress={() => file.current?.click()}>{bill.fileName ? t("Replace") : t("Attach")}</Button>
          </> : null}
        </dd></div>
      </dl>
      <section className={styles.part} aria-label={t("Lines")}>
        <ul className={styles.list}>{state.lines.map((line) => <li key={line.id}>
          <span className={styles.nameCell}><span>{line.description}</span>
            <small>{[line.orderNumber, line.projectReference, `${plain(line.quantity)} ${line.unit ?? ""}`.trim(), t("{price} each", { price: money(line.unitPrice) }),
              Number(line.taxRate) ? t("tax {rate}%", { rate: plain(line.taxRate) }) : ""].filter(Boolean).join(" · ")}</small></span>
          <span className={styles.money}>{money(line.total)}</span>
        </li>)}</ul>
        <dl className={styles.totals}>
          <div><dt>{t("Net")}</dt><dd>{money(bill.net)}</dd></div>
          <div><dt>{t("Tax")}</dt><dd>{money(bill.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(bill.total)}</strong></dd></div>
        </dl>
      </section>
      {state.payments.length ? <section className={styles.part} aria-label={t("Payments")}>
        <h3 className={styles.subhead}>{t("Payments")}</h3>
        <ul className={styles.list}>{state.payments.map((payment) => <li key={payment.id}>
          <span className={styles.nameCell}><span>{[format.day(payment.paidOn), methods[payment.method], payment.reference].filter(Boolean).join(" · ")}</span>
            {payment.status === "reversed" ? <small className={styles.lateText}>{t("Reversed: {reason}", { reason: payment.reverseReason ?? "" })}</small>
              : payment.orderNumber ? <small>{t("Advance on {order}", { order: payment.orderNumber })}</small> : null}</span>
          <span className={styles.money}>{money(payment.allocations.find((item) => item.invoiceId === bill.id)?.amount ?? "0")}</span>
        </li>)}</ul>
      </section> : null}
    </div>}
    {dialog === "edit" && state ? <BillEditor api={api} vendors={vendors} companies={companies} existing={state} onClose={() => setDialog(null)}
      onSaved={() => { setDialog(null); onChanged(); void load(); }} /> : null}
    {dialog === "approve" || dialog === "cancel" ? <ControlledModalDialog isOpen size="md" title={dialog === "approve" ? t("Approve invoice") : t("Cancel invoice")}
      onOpenChange={(open) => { if (!open) setDialog(null); }}
      footer={<div className="wd-dialog-actions"><Button onPress={() => setDialog(null)}>{t("Back")}</Button>
        <Button variant={dialog === "approve" ? "primary" : "danger"} isLoading={busy} isDisabled={!text.trim()}
          onPress={async () => { if (await run(dialog, dialog === "approve" ? { note: text.trim() } : { reason: text.trim() })) setDialog(null); }}>
          {dialog === "approve" ? t("Approve") : t("Cancel invoice")}</Button></div>}>
      <div className={styles.dialogBody}>
        {notice ? <InlineNotice tone="error" message={notice} /> : null}
        <TextAreaField label={dialog === "approve" ? t("Why it's approved") : t("Why it's cancelled")} isRequired value={text} onChange={setText} />
      </div>
    </ControlledModalDialog> : null}
    {dialog === "pay" && bill ? <PaymentDialog api={api} vendorId={bill.vendorId} legalEntityId={bill.legalEntityId} currency={bill.currency} forBill={bill}
      onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void load(); }} /> : null}
  </InspectorSheet>;
}
