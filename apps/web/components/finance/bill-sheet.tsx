"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApprovalRow, Button, EditableFieldList, ErrorState, FactRow, FileUploader, FormDialog, FormNotSaved, InlineNotice, InspectorSheet, MenuButton, MoneyField, ReasonDialog, ReviewDialog, ReviewFiles,
  SelectField, Skeleton, TextAreaField,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { BillState, PayablesState } from "@/lib/payables/types";
import { subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { BillEditor } from "./bill-editor";
import { BillStatusLabel, plain, useMethodLabels } from "./finance-labels";
import { PaymentDialog } from "./payment-dialog";
import styles from "./finance.module.css";

type Dialog = "edit" | "approve" | "cancel" | "pay" | "release" | null;

/**
 * One supplier invoice: its lines against their orders, why it's held (if it is), who approved it, the
 * supplier's document, the payments on it, and the retention it holds back per project until handover.
 * The next step is the primary action.
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
  const [release, setRelease] = useState<{ key: string; amount: string }>({ key: "", amount: "" });
  const load = useCallback(async () => {
    try { setState(await api.bill(billId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The invoice didn't load.")); }
  }, [api, billId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  /** Runs one change; a clash with someone else's change reloads the invoice and says so. Throws why it wasn't saved (a dialog shows it). */
  const change = async (action: "submit" | "approve" | "cancel" | "release", input: Record<string, unknown> = {}) => {
    if (!state) throw new FormNotSaved();
    setBusy(true); setNotice("");
    try { setState(await api.billCommand(action, { id: billId, version: state.bill.version, ...input })); onChanged(); }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      throw cause;
    } finally { setBusy(false); }
  };
  const run = (action: "submit" | "release", input: Record<string, unknown> = {}) => change(action, input).then(() => true, () => false);
  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy(true); setNotice("");
    try { setState(await api.uploadFile(billId, chosen)); onChanged(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
    finally { setBusy(false); }
  };
  const bill = state?.bill;
  const money = (value: string) => (bill ? format.money(value, bill.currency) : value);
  const more = !state || !bill ? [] : [
    ...(state.canEdit ? [{ id: "edit", label: t("Edit") }] : []),
    ...(state.canCancel ? [{ id: "cancel", label: t("Cancel invoice") }] : []),
    ...(state.canRelease ? [{ id: "release", label: t("Release retention") }] : []),
  ];
  // What's still held back, per project; the key is the project (or "none").
  const holding = (state?.retentions ?? []).filter((row) => Number(row.held) > 0);
  const releasing = holding.find((row) => (row.projectId ?? "none") === release.key);
  const openRelease = () => { setText(""); setRelease({ key: holding[0] ? holding[0].projectId ?? "none" : "", amount: holding[0] ? plain(holding[0].held) : "" }); setDialog("release"); };
  const primary = !state || !bill ? null
    : bill.status === "draft" && state.canManage ? <Button variant="primary" isLoading={busy} onPress={() => void run("submit")}>{t("Submit")}</Button>
    : bill.status === "held" && state.canApproveThis ? <Button variant="primary" onPress={() => { setText(""); setDialog("approve"); }}>{t("Approve")}</Button>
    : state.canPay ? <Button variant="primary" onPress={() => setDialog("pay")}>{t("Record payment")}</Button>
    : null;
  const documentOpen = Boolean(state?.canManage && bill && (["draft", "held"].includes(bill.status) || (bill.status === "approved" && !bill.fileName)));

  return <InspectorSheet isOpen size="lg" title={bill ? `${bill.supplierName} · ${bill.number}` : t("Supplier invoice")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state && bill && (primary || more.length) ? <div className="wd-dialog-actions">
      {more.length ? <MenuButton size="compact" label={t("More")} onAction={(id) => { if (id === "release") openRelease(); else { setText(""); setDialog(id as Dialog); } }} items={more} /> : null}
      <span className={styles.spacer} />{primary}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !bill ? <Skeleton lines={8} shape="facts" /> : <div className={styles.sheet}>
      <div className={styles.headRow}><BillStatusLabel bill={bill} today={format.today()} /><span className={styles.muted}>{bill.companyName}</span></div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {bill.status === "held" ? <section className={styles.part} aria-label={t("Why it's held")}>
        <h3 className={styles.subhead}>{t("Why it's held")}</h3>
        <ul className={styles.reasons}>{bill.holdReasons.split("\n").map((reason) => <li key={reason}>{reason}</li>)}</ul>
        {!state.canApproveThis && state.canApprove && bill.createdBy ? <p className={styles.muted}>{t("Someone other than who entered it approves it.")}</p> : null}
      </section> : null}
      {bill.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: bill.cancelReason ?? "" })} /> : null}
      <EditableFieldList>
        <FactRow label={t("Invoice date")}>{format.day(bill.invoiceDate)}</FactRow>
        <FactRow label={t("Due")}>{bill.dueDate ? format.day(bill.dueDate) : "—"}</FactRow>
        <FactRow label={t("Total")}><span className={styles.money}>{money(bill.total)}</span></FactRow>
        {bill.status === "approved" ? <FactRow label={t("Left to pay")}><span className={styles.money}>{money(bill.balance)}</span></FactRow> : null}
        {Number(bill.retentionHeld) > 0 ? <FactRow label={t("Retention held")}><span className={styles.money}>{money(bill.retentionHeld)}</span></FactRow> : null}
        {Number(bill.reserved) > 0 ? <FactRow label={t("In a payment run")}><span className={styles.money}>{money(bill.reserved)}</span></FactRow> : null}
        <FactRow label={t("Entered by")}>{bill.createdByName}</FactRow>
      </EditableFieldList>
      {bill.approvedByName ? <ApprovalRow state="approved" label={bill.approvedByName}
        description={[bill.approvedAt ? format.when(bill.approvedAt) : "", bill.approvalNote].filter(Boolean).join(" · ") || undefined} /> : null}
      <div className={styles.document}>
        <ReviewFiles label={t("Document")} files={bill.fileName ? [{ id: bill.id, name: bill.fileName, href: api.fileUrl(bill.id) }] : []} />
        {documentOpen ? <FileUploader appearance="button" accept="application/pdf,image/*" multiple={false} label={bill.fileName ? t("Replace") : t("Attach")}
          onFiles={(files) => void upload(files[0])} /> : null}
      </div>
      <section className={styles.part} aria-label={t("Lines")}>
        <ul className={styles.list}>{state.lines.map((line) => <li key={line.id}>
          <span className={styles.nameCell}><span>{line.description}</span>
            <small>{[line.orderNumber, line.projectReference, `${plain(line.quantity)} ${line.unit ?? ""}`.trim(), t("{price} each", { price: money(line.unitPrice) }),
              Number(line.taxRate) ? t("tax {rate}%", { rate: plain(line.taxRate) }) : "",
              Number(line.retentionPercent) ? t("{percent}% retention", { percent: plain(line.retentionPercent) }) : ""].filter(Boolean).join(" · ")}</small></span>
          <span className={styles.money}>{money(line.total)}</span>
        </li>)}</ul>
        <dl className={styles.totals}>
          <div><dt>{t("Net")}</dt><dd>{money(bill.net)}</dd></div>
          <div><dt>{t("Tax")}</dt><dd>{money(bill.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(bill.total)}</strong></dd></div>
        </dl>
      </section>
      {state.retentions.length ? <section className={styles.part} aria-label={t("Retention")}>
        <h3 className={styles.subhead}>{t("Retention")}</h3>
        <ul className={styles.list}>{state.retentions.map((row) => <li key={row.id}>
          <span className={styles.nameCell}><span>{row.projectReference ?? t("No project")}</span>
            {row.releases.map((item) => <small key={item.id}>{item.automatic ? t("{amount} released at handover", { amount: money(item.amount) })
              : t("{amount} released by {name}: {reason}", { amount: money(item.amount), name: item.releasedByName ?? "", reason: item.reason ?? "" })}</small>)}</span>
          <span className={styles.money}>{Number(row.held) > 0 ? t("{amount} held", { amount: money(row.held) }) : t("Released")}</span>
        </li>)}</ul>
      </section> : null}
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
    {/* §0.3 P0: a held invoice is approved in a review of why it's held and the supplier's document, never one click. */}
    {dialog === "approve" && bill ? <ReviewDialog title={t("Approve invoice")} description={`${bill.supplierName} · ${bill.number}`} confirmLabel={t("Approve")} confirmNeedsNote
      onClose={() => setDialog(null)}
      facts={[
        { label: t("Total"), value: money(bill.total) },
        { label: t("Invoice date"), value: format.day(bill.invoiceDate) },
        { label: t("Due"), value: bill.dueDate ? format.day(bill.dueDate) : "—" },
        { label: t("Entered by"), value: bill.createdByName },
      ]}
      files={bill.fileName ? [{ id: bill.id, name: bill.fileName, href: api.fileUrl(bill.id) }] : []}
      evidence={bill.holdReasons ? <section className={styles.part} aria-label={t("Why it's held")}>
        <h3 className={styles.subhead}>{t("Why it's held")}</h3>
        <ul className={styles.reasons}>{bill.holdReasons.split("\n").map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </section> : null}
      onConfirm={async (note) => { await change("approve", { note }); setDialog(null); }} /> : null}
    {dialog === "cancel" ? <ReasonDialog title={t("Cancel invoice")} label={t("Why it's cancelled")} confirmLabel={t("Cancel invoice")} confirmVariant="danger"
      onClose={() => setDialog(null)} onConfirm={(reason) => change("cancel", { reason })} /> : null}
    {dialog === "release" && bill ? <FormDialog size="md" title={t("Release retention")} onClose={() => setDialog(null)} cancelLabel={t("Back")}
      error={notice || undefined} isSubmitting={busy} isDirty={Boolean(text.trim())} submitLabel={t("Release")}
      isSubmitDisabled={!releasing || !text.trim() || !(Number(release.amount) > 0) || subtractExact(release.amount, releasing.held) !== "0"}
      onSubmit={async () => { if (!(await run("release", { projectId: releasing?.projectId ?? null, amount: release.amount, reason: text.trim() }))) throw new FormNotSaved(); setDialog(null); }}>
        {holding.length > 1 ? <SelectField label={t("Project")} selectedKey={release.key || null} items={holding.map((row) => ({ id: row.projectId ?? "none", label: row.projectReference ?? t("No project") }))}
          onSelectionChange={(key) => { const row = holding.find((item) => (item.projectId ?? "none") === key); setRelease({ key: String(key ?? ""), amount: row ? plain(row.held) : "" }); }} /> : null}
        <MoneyField label={t("Amount")} isRequired currency={bill.currency} value={release.amount} onChange={(amount) => setRelease({ ...release, amount })}
          description={releasing ? t("{amount} held", { amount: money(releasing.held) }) : undefined} />
        <TextAreaField label={t("Why it's released")} isRequired value={text} onChange={setText} />
    </FormDialog> : null}
    {dialog === "pay" && bill ? <PaymentDialog api={api} vendorId={bill.vendorId} legalEntityId={bill.legalEntityId} currency={bill.currency} forBill={bill}
      onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void load(); }} /> : null}
  </InspectorSheet>;
}
