"use client";

import { RecordHistory } from "../history/record-history";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge, Button, EditableFieldList, EmptyState, ErrorState, FactRow, FileUploader, InlineNotice, InspectorSheet, MoneyField, ReviewDialog, ReviewFiles, SelectField, Skeleton, StateChip, TextAreaField, TextInput,
  type ItemState,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FinanceRequestsApi } from "@/lib/finance-requests/client";
import type { FileKind, FinanceRequestDetail } from "@/lib/finance-requests/types";
import { useProjectFormat } from "../project-core/format";
import { RequestStatusLabel, useFileKindLabels, useInvoiceKindLabels, useKindLabels, useLocationLabels, useStatusLabels } from "./finance-request-labels";
import { RequestForm } from "./request-form";
import styles from "./finance-requests.module.css";

const plain = (value: string | null | undefined) => (value ? (value.includes(".") ? value.replace(/\.?0+$/, "") : value) : "");

/**
 * One request: what was asked, its lines and files, its approval and history. Finance moves it (start, ask the
 * requester, done with the accounting reference, reject with why) and keeps its own reference and notes; the
 * requester sees where it stands and answers when Finance asks; an approver decides it here or in Approvals.
 */
export function RequestSheet({ api, id, onChanged, onClose }: { api: FinanceRequestsApi; id: string; onChanged: () => void; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const kinds = useKindLabels();
  const statuses = useStatusLabels();
  const invoiceKinds = useInvoiceKindLabels();
  const locations = useLocationLabels();
  const fileKinds = useFileKindLabels();
  const [detail, setDetail] = useState<FinanceRequestDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [statement, setStatement] = useState("");
  const [fileKind, setFileKind] = useState<FileKind>("quote");
  const [answering, setAnswering] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const show = (next: FinanceRequestDetail) => {
    setDetail(next); setReference(next.request.financeReference); setInternalNote(next.request.internalNote ?? ""); setStatement(plain(next.request.statementAmount));
  };
  useEffect(() => {
    let live = true;
    api.detail(id).then((next) => { if (live) show(next); }).catch((cause) => { if (live) setLoadError(cause instanceof Error ? cause.message : t("The request didn't load.")); });
    return () => { live = false; };
  }, [api, id, t]);

  const act = async (key: string, work: () => Promise<FinanceRequestDetail>) => {
    setBusy(key); setNotice("");
    try { show(await work()); setNote(""); onChanged(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy("");
  };
  const request = detail?.request;
  const money = (value: string | null) => (value && request ? format.money(value, request.currency) : "");
  const open = request ? ["new", "in_progress", "needs_info"].includes(request.status) : false;
  const files = (detail?.files ?? []).map((file) => ({ id: file.id, name: [file.name, fileKinds[file.kind], file.uploadedByName].join(" · "), href: api.fileUrl(id, file.id) }));
  const finance = Boolean(detail?.canManage);
  /** An approver's decision, made in the review; a refusal keeps the review open with why. */
  const decide = async (decision: "approve" | "return" | "reject", text: string) => {
    setBusy(decision === "reject" ? "decline" : decision); setNotice("");
    try { show(await api.command("decide", { id, decision, note: text, approvalVersion: detail!.approval!.version })); onChanged(); setDeciding(false); }
    finally { setBusy(""); }
  };
  const stepStates: Record<string, ItemState> = { done: "done", current: "waiting", upcoming: "upcoming", returned: "returned", rejected: "rejected" };
  const move = (action: "start" | "ask" | "done" | "reject") => act(action, () => api.command(action, { id, version: request!.version, note: note.trim(),
    ...(action === "done" ? { financeReference: reference.trim() } : {}) }));

  const footer = !detail || !request ? null : <div className="wd-dialog-actions">
    {finance && open ? <Button variant="danger" intent="write" isLoading={busy === "reject"} isDisabled={Boolean(busy)} onPress={() => (note.trim() ? void move("reject") : setNotice(t("Say why it's rejected.")))}>{t("Reject")}</Button> : null}
    <span className={styles.spacer} />
    {detail.canResubmit ? <Button variant="primary" onPress={() => setAnswering(true)}>{t("Answer Finance")}</Button> : null}
    {finance && (request.status === "new" || request.status === "in_progress") ? <Button intent="write" isLoading={busy === "ask"} isDisabled={Boolean(busy)}
      onPress={() => (note.trim() ? void move("ask") : setNotice(t("Say what's missing.")))}>{t("Ask for info")}</Button> : null}
    {finance && request.status === "new" ? <Button intent="write" isLoading={busy === "start"} isDisabled={Boolean(busy)} onPress={() => void move("start")}>{t("Start")}</Button> : null}
    {finance && (request.status === "new" || request.status === "in_progress") ? <Button variant="primary" isLoading={busy === "done"} isDisabled={Boolean(busy)} onPress={() => void move("done")}>{t("Mark done")}</Button> : null}
  </div>;

  return <InspectorSheet isOpen size="lg" title={request ? `${request.reference} · ${kinds[request.kind]}` : t("Request")} onOpenChange={(value) => { if (!value) onClose(); }} footer={footer}>
    {loadError ? <ErrorState description={loadError} /> : !detail || !request ? <Skeleton shape="facts" lines={6} /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {request.status === "needs_info" && !finance ? <InlineNotice tone="info" message={[...detail.events].reverse().find((event) => event.kind === "needs_info")?.note || statuses.needs_info} /> : null}
      <EditableFieldList>
        <FactRow label={t("Status")}><RequestStatusLabel status={request.status} />{request.closeNote && request.status === "rejected" ? <span className={styles.text}>{request.closeNote}</span> : null}</FactRow>
        {request.kind === "payable"
          ? <FactRow label={t("Supplier")}>{request.supplierName}{request.supplierTaxNumber ? <span className={styles.muted}>{request.supplierTaxNumber}</span> : null}</FactRow>
          : <FactRow label={t("Client")}>{request.partyId ? <Link href={`/workspace/crm/customers?record=${request.partyId}`}>{request.clientName}</Link> : request.clientName}
            {request.clientEmail ? <span className={styles.muted}>{request.clientEmail}</span> : null}</FactRow>}
        {request.clientTaxNumber ? <FactRow label={t("Client tax number")}>{request.clientTaxNumber}</FactRow> : null}
        {request.opportunityReference ? <FactRow label={t("Deal")}>{`${request.opportunityReference} · ${request.opportunityTitle ?? ""}`}</FactRow> : null}
        {request.projectId ? <FactRow label={t("Project")}><Link href={`/workspace/projects/${request.projectId}`}>{[request.projectReference, request.projectName].filter(Boolean).join(" · ")}</Link></FactRow> : null}
        <FactRow label={t("Requested by")}>{request.requesterName}<span className={styles.muted}>{format.when(request.createdAt)}</span></FactRow>
        {request.salespersonName ? <FactRow label={t("Salesperson")}>{request.salespersonName}</FactRow> : null}
        {request.companyName ? <FactRow label={request.kind === "payable" ? t("Paying company") : t("Issuing company")}>{request.companyName}</FactRow> : null}
        {request.invoiceKind ? <FactRow label={t("Kind of invoice")}>{invoiceKinds[request.invoiceKind]}</FactRow> : null}
        {request.paymentStageTitle ? <FactRow label={t("Payment stage")}>{request.paymentStageTitle}</FactRow> : null}
        {request.paymentTerms ? <FactRow label={t("Payment terms")}><span className={styles.text}>{request.paymentTerms}</span></FactRow> : null}
        {request.contractReference ? <FactRow label={t("Contract reference")}>{request.contractReference}</FactRow> : null}
        {request.orderNumber ? <FactRow label={t("Order")}>{request.orderNumber}{request.orderGross ? <span>{money(request.orderGross)}</span> : null}</FactRow> : null}
        {request.invoiceNumber ? <FactRow label={t("Client invoice number")}>{request.invoiceNumber}</FactRow> : null}
        {request.reason ? <FactRow label={t("Reason")}><span className={styles.text}>{request.reason}</span></FactRow> : null}
        {request.paymentMethod ? <FactRow label={request.kind === "refund" ? t("Refund method") : t("Payment method")}>{request.paymentMethod}</FactRow> : null}
        {request.kind === "refund" && request.hasBankDetails ? <FactRow label={t("Client bank details")}><span className={styles.text}>{request.bankDetails ?? t("Given (Finance only)")}</span></FactRow> : null}
        {request.expectedRefundOn ? <FactRow label={t("Expected refund")}>{format.day(request.expectedRefundOn)}</FactRow> : null}
        {request.supplierReference ? <FactRow label={t("Supplier quote or invoice")}>{request.supplierReference}{request.invoicePending ? <Badge tone="warning">{t("Invoice pending")}</Badge> : null}</FactRow> : null}
        {request.authorisedByName ? <FactRow label={t("Authorised by")}>{request.authorisedByName}</FactRow> : null}
        {request.materialLocation ? <FactRow label={t("Material needed at")}>{locations[request.materialLocation]}</FactRow> : null}
        {request.paidOnStatement ? <FactRow label={t("Monthly statement")}>{request.statementAmount ? t("Checked: {amount}", { amount: money(request.statementAmount) }) : t("Provisional until the statement arrives")}</FactRow> : null}
        {request.remarks ? <FactRow label={t("Remarks")}><span className={styles.text}>{request.remarks}</span></FactRow> : null}
        {request.financeReference ? <FactRow label={t("Accounting reference")}>{request.financeReference}</FactRow> : null}
      </EditableFieldList>

      {detail.lines.length ? <section className={styles.part}>
        <h3 className={styles.subhead}>{request.kind === "refund" ? t("Items not delivered") : t("Lines")}</h3>
        <ul className={styles.list}>{detail.lines.map((line) => <li key={line.id}><span>{line.description}</span><span className={styles.money}>{money(line.amount)}</span></li>)}</ul>
      </section> : null}
      <dl className={styles.totals}>
        {request.kind === "invoice" ? <>
          <div><dt>{t("Net")}</dt><dd>{money(request.net)}</dd></div>
          <div><dt>{t("{tax} {rate}%", { tax: request.taxLabel || t("Tax"), rate: plain(request.taxRate) || "0" })}</dt><dd>{money(request.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(request.total)}</strong></dd></div>
        </> : request.kind === "payable" ? <>
          <div><dt>{t("Full amount")}</dt><dd>{money(request.total)}</dd></div>
          <div><dt>{t("Pay now")}</dt><dd><strong>{money(request.payNow)}</strong></dd></div>
          <div><dt>{t("Balance")}</dt><dd>{money(request.balance)}</dd></div>
        </> : <div><dt>{t("To refund")}</dt><dd><strong>{money(request.total)}</strong></dd></div>}
      </dl>

      {detail.approval ? <section className={styles.part} aria-label={t("Approval")}>
        <h3 className={styles.subhead}>{t("Approval")}</h3>
        <EditableFieldList>{detail.approval.steps.map((step) => <FactRow key={step.position} label={step.label}>
          <StateChip state={stepStates[step.state] ?? "upcoming"} label={step.state === "done" ? t("Approved") : undefined} />
          <span className={styles.muted}>{step.state === "current" ? detail.approval!.waitingFor.join(", ")
            : [step.decidedBy, step.decidedAt ? format.when(step.decidedAt) : "", step.note].filter(Boolean).join(" · ")}</span>
        </FactRow>)}</EditableFieldList>
        {/* §0.3 P0: the request is approved, sent back or rejected in a review of what was asked and its files, never one click. */}
        {detail.canDecide ? <div><Button variant="primary" isDisabled={Boolean(busy)} onPress={() => { setNotice(""); setDeciding(true); }}>{t("Review")}</Button></div> : null}
      </section> : null}

      {finance && open ? <TextAreaField label={t("Note to the requester")} maxLength={1000} value={note} onChange={setNote} /> : null}

      {finance ? <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Finance")}</h3>
        <TextInput label={t("Accounting reference")} description={t("For example the invoice number in your accounting system.")} maxLength={120} value={reference} onChange={setReference} />
        <TextAreaField label={t("Internal note")} description={t("Only Finance sees this.")} maxLength={4000} value={internalNote} onChange={setInternalNote} />
        {request.kind === "payable" && request.paidOnStatement ? <MoneyField label={t("Amount on the statement")} currency={request.currency} value={statement} onChange={setStatement} /> : null}
        <div className={styles.actions}><Button intent="write" isLoading={busy === "update"} isDisabled={Boolean(busy)} onPress={() => void act("update", () => api.command("update", { id, version: request.version,
          financeReference: reference.trim(), internalNote, ...(request.kind === "payable" && request.paidOnStatement ? { statementAmount: statement || null } : {}) }))}>{t("Save")}</Button></div>
      </section> : null}

      <section className={styles.part}>
        <ReviewFiles label={t("Files")} files={files} empty={<EmptyState illustration={null} title={t("No files yet.")} />} />
        {detail.canAttach ? <div className={styles.actions}>
          <SelectField label={t("Kind of file")} selectedKey={fileKind} onSelectionChange={(key) => setFileKind((key as FileKind) ?? "quote")}
            items={(request.kind === "payable" ? ["quote", "tax_invoice", "proof", "other"] as const : ["quote", "proof", "other"] as const).map((kind) => ({ id: kind, label: fileKinds[kind] }))} />
          <FileUploader appearance="button" multiple={false} accept="application/pdf,image/*" label={t("Add a file")}
            onFiles={(files) => { const file = files[0]; if (file) void act("file", () => api.upload(id, fileKind, file)); }} />
        </div> : null}
      </section>

      <section className={styles.part}>
        <h3 className={styles.subhead}>{t("History")}</h3>
        <RecordHistory workspaceId={api.workspaceId} recordType="finance_request" recordId={id} />
      </section>
    </div>}
    {deciding && detail?.approval && request ? <ReviewDialog title={t("Review")} description={`${request.reference} · ${kinds[request.kind]}`} onClose={() => setDeciding(false)}
      confirmLabel={t("Approve")} returnLabel={t("Send back")} rejectLabel={t("Reject")}
      facts={[
        { label: request.kind === "payable" ? t("Pay now") : request.kind === "refund" ? t("To refund") : t("Total"), value: money(request.kind === "payable" ? request.payNow : request.total) },
        { label: request.kind === "payable" ? t("Supplier") : t("Client"), value: (request.kind === "payable" ? request.supplierName : request.clientName) ?? "" },
        { label: t("Requested by"), value: request.requesterName },
        ...(request.reason ? [{ label: t("Reason"), value: request.reason }] : []),
      ]}
      files={files}
      onConfirm={(text) => decide("approve", text)} onReturn={(text) => decide("return", text)} onReject={(text) => decide("reject", text)} /> : null}
    {answering && detail ? <RequestForm api={api} existing={detail} onClose={() => setAnswering(false)} onSaved={(next) => { setAnswering(false); show(next); onChanged(); }} /> : null}
  </InspectorSheet>;
}
