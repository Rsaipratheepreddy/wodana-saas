"use client";

import { FileSignature, Mail, MessageCircle } from "lucide-react";
import { Badge, DataGrid, formatDate, useDesignSystem, type DataGridColumn, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { JobDocuments, SendState } from "@/lib/jobs/journey";

type Send = JobDocuments["sends"][number];
type Signature = JobDocuments["signatures"][number];
const TONE: Record<SendState, StatusTone> = { failed: "danger", sent: "neutral", delivered: "info", opened: "info", signed: "success" };

/**
 * §0.3 P4: what the job sent the client and what the client signed, read from the records: each send with where it
 * got to (sent, delivered, opened, signed, or failed and why), and each signature with how the signer was verified.
 * Shown only when there is something; never an empty box.
 */
/** Each kind of document wears its own chip colour. */
const KIND_HUE: Record<string, 1 | 2 | 6> = { quotation: 1, invoice: 6, signature_request: 2, change_request: 2, design_completed: 6 };

export function JobDocumentsBlock({ documents }: { documents: JobDocuments }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  if (!documents.sends.length && !documents.signatures.length) return null;
  const when = (value: string) => formatDate(value, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" });
  const kind: Record<string, string> = { quotation: t("Quotation"), invoice: t("Invoice"), signature_request: t("Signing link"), change_request: t("Change request"),
    design_completed: t("Design complete") };
  const state: Record<SendState, string> = { failed: t("Failed"), sent: t("Sent"), delivered: t("Delivered"), opened: t("Opened"), signed: t("Signed") };
  const sendColumns: DataGridColumn<Send>[] = [
    { accessorKey: "title", header: t("Document"), size: 220, cell: ({ row: { original: send } }) => <span className="wd-job-doc">
      <strong>{send.title || kind[send.kind] || send.kind}</strong><Badge hue={KIND_HUE[send.kind] ?? "auto"}>{kind[send.kind] ?? send.kind}</Badge></span> },
    { accessorKey: "recipient", header: t("To"), size: 210, cell: ({ row: { original: send } }) => <span className="wd-job-doc-chips" data-inline="">
      {send.channel === "whatsapp" ? <MessageCircle aria-hidden="true" size={13} data-hue={6} /> : <Mail aria-hidden="true" size={13} data-hue={1} />}
      <span>{send.recipient || (send.channel === "whatsapp" ? t("WhatsApp") : t("Email"))}</span></span> },
    { accessorKey: "state", header: t("Status"), size: 170, cell: ({ row: { original: send } }) => <span className="wd-job-doc-chips">
      <Badge tone={TONE[send.state]}>{state[send.state]}</Badge>{send.state === "failed" && send.reason ? <small>{send.reason}</small> : null}</span> },
    { accessorKey: "sentAt", header: t("When"), size: 140, cell: ({ row: { original: send } }) => <span className="wd-job-doc-muted">{when(send.signedAt ?? send.openedAt ?? send.sentAt)}</span> },
  ];
  const signatureColumns: DataGridColumn<Signature>[] = [
    { accessorKey: "title", header: t("Document"), size: 220, cell: ({ row: { original: signature } }) => <span className="wd-job-doc">
      <strong>{signature.title}</strong>{signature.fingerprint ? <small dir="ltr" title={signature.fingerprint}>{signature.fingerprint.slice(0, 16)}…</small> : null}</span> },
    { accessorKey: "signer", header: t("Signed by"), size: 170 },
    { id: "verified", header: t("Verified by"), size: 210, enableSorting: false, cell: ({ row: { original: signature } }) => <span className="wd-job-doc-chips">
      <Badge tone="success">{signature.method === "esign" ? t("Signing link") : t("Code")}</Badge>
      {signature.verifiedBy === "whatsapp" ? <Badge hue={6}>{t("WhatsApp")}</Badge> : signature.verifiedBy === "email" ? <Badge hue={1}>{t("Email")}</Badge> : null}
      {signature.device ? <small>{signature.device}</small> : null}</span> },
    { accessorKey: "signedAt", header: t("Signed on"), size: 140, cell: ({ row: { original: signature } }) => <span className="wd-job-doc-muted">{when(signature.signedAt)}</span> },
  ];
  // Named by its tab ("Documents"), so no title of its own.
  return <section className="wd-job-documents" aria-label={t("Documents")}>
    {documents.sends.length ? <div data-sales-grid><DataGrid ariaLabel={t("Sent")} columns={sendColumns} data={documents.sends} getRowId={(send) => send.id} rowNumbers={false}
      selectable={false} showToolbar={false} emptyTitle="" emptyDescription="" /></div> : null}
    {documents.signatures.length ? <>
      <h3 className="wd-job-subtitle"><FileSignature aria-hidden="true" size={14} />{t("Signatures")}</h3>
      <div data-sales-grid><DataGrid ariaLabel={t("Signatures")} columns={signatureColumns} data={documents.signatures} getRowId={(signature) => signature.id} rowNumbers={false}
        selectable={false} showToolbar={false} emptyTitle="" emptyDescription="" /></div>
    </> : null}
  </section>;
}
