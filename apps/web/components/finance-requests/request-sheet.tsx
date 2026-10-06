"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, FileUploader, InlineNotice, InspectorSheet, MoneyField, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
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
  const finance = Boolean(detail?.canManage);
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
      <dl className={styles.facts}>
        <div><dt>{t("Status")}</dt><dd><RequestStatusLabel status={request.status} />{request.closeNote && request.status === "rejected" ? <span>{request.closeNote}</span> : null}</dd></div>
        {request.kind === "payable"
          ? <div><dt>{t("Supplier")}</dt><dd>{request.supplierName}{request.supplierTaxNumber ? <span className={styles.muted}>{request.supplierTaxNumber}</span> : null}</dd></div>
          : <div><dt>{t("Client")}</dt><dd>{request.partyId ? <Link href={`/workspace/crm/customers?record=${request.partyId}`}>{request.clientName}</Link> : request.clientName}
            {request.clientEmail ? <span className={styles.muted}>{request.clientEmail}</span> : null}</dd></div>}
        {request.clientTaxNumber ? <div><dt>{t("Client tax number")}</dt><dd>{request.clientTaxNumber}</dd></div> : null}
        {request.opportunityReference ? <div><dt>{t("Deal")}</dt><dd>{`${request.opportunityReference} · ${request.opportunityTitle ?? ""}`}</dd></div> : null}
        {request.projectId ? <div><dt>{t("Project")}</dt><dd><Link href={`/workspace/projects/${request.projectId}`}>{[request.projectReference, request.projectName].filter(Boolean).join(" · ")}</Link></dd></div> : null}
        <div><dt>{t("Requested by")}</dt><dd>{request.requesterName}<span className={styles.muted}>{format.when(request.createdAt)}</span></dd></div>
        {request.salespersonName ? <div><dt>{t("Salesperson")}</dt><dd>{request.salespersonName}</dd></div> : null}
        {request.companyName ? <div><dt>{request.kind === "payable" ? t("Paying company") : t("Issuing company")}</dt><dd>{request.companyName}</dd></div> : null}
        {request.invoiceKind ? <div><dt>{t("Kind of invoice")}</dt><dd>{invoiceKinds[request.invoiceKind]}</dd></div> : null}
        {request.paymentStageTitle ? <div><dt>{t("Payment stage")}</dt><dd>{request.paymentStageTitle}</dd></div> : null}
        {request.paymentTerms ? <div><dt>{t("Payment terms")}</dt><dd>{request.paymentTerms}</dd></div> : null}
        {request.contractReference ? <div><dt>{t("Contract reference")}</dt><dd>{request.contractReference}</dd></div> : null}
        {request.orderNumber ? <div><dt>{t("Order")}</dt><dd>{request.orderNumber}{request.orderGross ? <span>{money(request.orderGross)}</span> : null}</dd></div> : null}
        {request.invoiceNumber ? <div><dt>{t("Client invoice number")}</dt><dd>{request.invoiceNumber}</dd></div> : null}
        {request.reason ? <div><dt>{t("Reason")}</dt><dd>{request.reason}</dd></div> : null}
        {request.paymentMethod ? <div><dt>{request.kind === "refund" ? t("Refund method") : t("Payment method")}</dt><dd>{request.paymentMethod}</dd></div> : null}
        {request.kind === "refund" && request.hasBankDetails ? <div><dt>{t("Client bank details")}</dt><dd>{request.bankDetails ?? t("Given (Finance only)")}</dd></div> : null}
        {request.expectedRefundOn ? <div><dt>{t("Expected refund")}</dt><dd>{format.day(request.expectedRefundOn)}</dd></div> : null}
        {request.supplierReference ? <div><dt>{t("Supplier quote or invoice")}</dt><dd>{request.supplierReference}{request.invoicePending ? <span className={styles.status} data-tone="warning">{t("Invoice pending")}</span> : null}</dd></div> : null}
        {request.authorisedByName ? <div><dt>{t("Authorised by")}</dt><dd>{request.authorisedByName}</dd></div> : null}
        {request.materialLocation ? <div><dt>{t("Material needed at")}</dt><dd>{locations[request.materialLocation]}</dd></div> : null}
        {request.paidOnStatement ? <div><dt>{t("Monthly statement")}</dt><dd>{request.statementAmount ? t("Checked: {amount}", { amount: money(request.statementAmount) }) : t("Provisional until the statement arrives")}</dd></div> : null}
        {request.remarks ? <div><dt>{t("Remarks")}</dt><dd>{request.remarks}</dd></div> : null}
        {request.financeReference ? <div><dt>{t("Accounting reference")}</dt><dd>{request.financeReference}</dd></div> : null}
      </dl>

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

      {detail.approval ? <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Approval")}</h3>
        <ul className={styles.list}>{detail.approval.steps.map((step) => <li key={step.position}><span>{step.label}</span>
          <small>{step.state === "current" ? detail.approval!.waitingFor.join(", ") || t("Waiting") : [step.decidedBy, step.decidedAt ? format.when(step.decidedAt) : "", step.note].filter(Boolean).join(" · ")}</small></li>)}</ul>
        {detail.canDecide ? <div className={styles.actions}>
          <Button variant="primary" isLoading={busy === "approve"} isDisabled={Boolean(busy)} onPress={() => void act("approve", () => api.command("decide", { id, decision: "approve", note: note.trim(), approvalVersion: detail.approval!.version }))}>{t("Approve")}</Button>
          <Button intent="write" isLoading={busy === "return"} isDisabled={Boolean(busy)} onPress={() => (note.trim() ? void act("return", () => api.command("decide", { id, decision: "return", note: note.trim(), approvalVersion: detail.approval!.version })) : setNotice(t("Say what needs to change.")))}>{t("Send back")}</Button>
          <Button variant="danger" intent="write" isLoading={busy === "decline"} isDisabled={Boolean(busy)} onPress={() => (note.trim() ? void act("decline", () => api.command("decide", { id, decision: "reject", note: note.trim(), approvalVersion: detail.approval!.version })) : setNotice(t("Say why it's rejected.")))}>{t("Reject")}</Button>
        </div> : null}
      </section> : null}

      {(finance && open) || detail.canDecide ? <TextAreaField label={finance && open ? t("Note to the requester") : t("Note")} maxLength={1000} value={note} onChange={setNote} /> : null}

      {finance ? <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Finance")}</h3>
        <TextInput label={t("Accounting reference")} description={t("For example the invoice number in your accounting system.")} maxLength={120} value={reference} onChange={setReference} />
        <TextAreaField label={t("Internal note")} description={t("Only Finance sees this.")} maxLength={4000} value={internalNote} onChange={setInternalNote} />
        {request.kind === "payable" && request.paidOnStatement ? <MoneyField label={t("Amount on the statement")} currency={request.currency} value={statement} onChange={setStatement} /> : null}
        <div className={styles.actions}><Button intent="write" isLoading={busy === "update"} isDisabled={Boolean(busy)} onPress={() => void act("update", () => api.command("update", { id, version: request.version,
          financeReference: reference.trim(), internalNote, ...(request.kind === "payable" && request.paidOnStatement ? { statementAmount: statement || null } : {}) }))}>{t("Save")}</Button></div>
      </section> : null}

      <section className={styles.part}>
        <h3 className={styles.subhead}>{t("Files")}</h3>
        {detail.files.length ? <ul className={styles.list}>{detail.files.map((file) => <li key={file.id}>
          <a href={api.fileUrl(id, file.id)} target="_blank" rel="noreferrer">{file.name}</a><small>{[fileKinds[file.kind], file.uploadedByName, format.when(file.uploadedAt)].join(" · ")}</small></li>)}</ul>
          : <p className={styles.muted}>{t("No files yet.")}</p>}
        {detail.canAttach ? <div className={styles.actions}>
          <SelectField label={t("Kind of file")} selectedKey={fileKind} onSelectionChange={(key) => setFileKind((key as FileKind) ?? "quote")}
            items={(request.kind === "payable" ? ["quote", "tax_invoice", "proof", "other"] as const : ["quote", "proof", "other"] as const).map((kind) => ({ id: kind, label: fileKinds[kind] }))} />
          <FileUploader appearance="button" multiple={false} accept="application/pdf,image/*" label={t("Add a file")}
            onFiles={(files) => { const file = files[0]; if (file) void act("file", () => api.upload(id, fileKind, file)); }} />
        </div> : null}
      </section>

      <section className={styles.part}>
        <h3 className={styles.subhead}>{t("History")}</h3>
        <ul className={styles.list}>{detail.events.map((event) => <li key={event.id}>
          <span>{event.toStatus && event.kind !== "file" ? statuses[event.toStatus as keyof typeof statuses] ?? event.kind : event.kind === "file" ? t("File added") : event.kind === "approval" ? t("Approved") : event.kind}</span>
          <small>{[event.actorName ?? t("Automatic"), format.when(event.occurredAt), event.note].filter(Boolean).join(" · ")}</small></li>)}</ul>
      </section>
    </div>}
    {answering && detail ? <RequestForm api={api} existing={detail} onClose={() => setAnswering(false)} onSaved={(next) => { setAnswering(false); show(next); onChanged(); }} /> : null}
  </InspectorSheet>;
}
