"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FileSignature, Upload } from "lucide-react";
import { Badge, Button, DocumentTable, EmptyState, ErrorState, FileUploader, FormDialog, FormNotSaved, InlineNotice, MoneyField, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { proposalApi, type ClientPresentation, type DocumentCard, type SigningRequest } from "@/lib/proposals/client";
import type { BuilderState } from "@/lib/quotation/types";
import { ClientPriceBreakdown } from "./client-price-breakdown";
import styles from "./quote-files.module.css";

const STATE_TONE: Record<SigningRequest["state"], "info" | "success" | "neutral" | "warning"> = { open: "info", signed: "success", revoked: "neutral", expired: "warning" };
const STATE_LABEL: Record<SigningRequest["state"], string> = { open: "Waiting for signature", signed: "Signed", revoked: "Withdrawn", expired: "Expired" };
const PURPOSE_LABEL = { upload: "Uploaded", issued: "Sent", signed: "Signed copy" } as const;

/**
 * The quotation's proposal and files (PLM-085, R8, R3): the five-page proposal PDF (the firm's locked pages around
 * this quote), sending it for signature, how the client reads the price, and the case's quotation documents —
 * each a card with its history, including quotations made outside Wodana under their own number.
 */
export function QuoteFiles({ workspaceId, caseId, state }: { workspaceId: string; caseId: string; state: BuilderState }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const api = proposalApi(workspaceId, caseId);
  const [documents, setDocuments] = useState<DocumentCard[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [client, setClient] = useState<{ presentation: ClientPresentation; currency: string; decimals: number; taxLabel?: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const quoteId = state.quote.id;
  const load = useCallback(async () => {
    const files = proposalApi(workspaceId, caseId);
    try {
      const [list, view] = await Promise.all([files.documents(), files.clientView(quoteId).catch(() => null)]);
      setDocuments(list.documents); setCanEdit(list.canEdit); setClient(view); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the files.")); }
  }, [workspaceId, caseId, quoteId, t]);
  useEffect(() => { void load(); }, [load]);

  if (error && !documents) return <ErrorState title={t("The files didn't load")} description={error} onRetry={() => void load()} />;
  if (!documents) return <Skeleton lines={6} shape="rows" />;
  const proposal = documents.find((item) => item.kind === "proposal" && item.quoteId === quoteId) ?? null;
  const others = documents.filter((item) => item !== proposal);
  const sent = state.quote.status === "issued";
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

  const sendForSignature = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await api.requestSignature(quoteId, crypto.randomUUID());
      setNotice(result.emailed ? { tone: "success", message: t("Sent to {email} for signature.", { email: result.emailed }) }
        : { tone: "info", message: t("The signing link is ready but the email didn't go out. Share this link: {link}", { link: result.link ?? "" }) });
      await load();
    } catch (cause) { setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("Could not send it for signature.") }); }
    finally { setBusy(false); }
  };

  return <div className={styles.files}>
    <section className={styles.section} aria-labelledby="proposal-heading">
      <header className={styles.head}>
        <h2 id="proposal-heading">{t("Proposal")}</h2>
        <span className={styles.meta}>{state.quote.reference ?? t("Numbered when it's sent")}</span>
        <span className={styles.spacer} />
        <a className="wd-button" data-size="compact" data-variant="quiet" href={api.previewUrl(quoteId)} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={14} />{t("Preview PDF")}</a>
        {sent && canEdit ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void sendForSignature()}><FileSignature aria-hidden="true" size={14} />{t("Send for signature")}</Button> : null}
      </header>
      {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}
      {!sent && !proposal ? <p className={styles.meta}>{t("Pages 1–3 and 5 come from the proposal template in Settings; page 4 is this quote. Send the quote to the client to sign it.")}</p> : null}
      {proposal?.signing.length ? <ul className={styles.list} aria-label={t("Signatures")}>
        {proposal.signing.map((request) => <li key={request.id}>
          <Badge tone={STATE_TONE[request.state]}>{t(STATE_LABEL[request.state] as never)}</Badge>
          <span>{request.signerName}</span>
          <span className={styles.meta}>{request.signedAt ? t("Signed {date}", { date: date(request.signedAt) }) : t("Until {date}", { date: date(request.expiresAt) })}</span>
          <span className={styles.spacer} />
          {request.signedDocumentVersion ? <a className="wd-button" data-size="compact" data-variant="quiet" href={api.fileUrl(proposal.id, request.signedDocumentVersion, true)}>
            <Download aria-hidden="true" size={14} />{t("Signed copy")}</a> : null}
          {request.state === "open" && canEdit ? <Button size="compact" variant="quiet" onPress={async () => {
            try { await api.revokeSignature(request.id, request.version); await load(); }
            catch (cause) { setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("Could not save.") }); }
          }}>{t("Withdraw")}</Button> : null}
        </li>)}
      </ul> : null}
      {proposal ? <Versions card={proposal} fileUrl={(number) => api.fileUrl(proposal.id, number)} date={date} /> : null}
    </section>

    {client && client.presentation.mode !== "all_inclusive" ? <section className={styles.section} aria-labelledby="client-view-heading">
      <header className={styles.head}><h2 id="client-view-heading">{t("Price as the client sees it")}</h2></header>
      <ClientPriceBreakdown presentation={client.presentation} currency={client.currency} decimals={client.decimals} taxLabel={client.taxLabel} />
    </section> : null}

    <section className={styles.section} aria-labelledby="documents-heading">
      <header className={styles.head}>
        <h2 id="documents-heading">{t("Quotation documents")}</h2>
        <span className={styles.spacer} />
        {canEdit ? <Button size="compact" variant="quiet" onPress={() => setUploading(true)}><Upload aria-hidden="true" size={14} />{t("Upload a quotation")}</Button> : null}
      </header>
      {others.length ? others.map((card) => <article key={card.id} className={styles.card}>
        <header className={styles.head}>
          <strong>{card.reference ?? card.title}</strong>
          {card.reference && card.title !== card.reference ? <span className={styles.meta}>{card.title}</span> : null}
          {card.amount && card.currency ? <span className={styles.meta}>{new Intl.NumberFormat(locale, { style: "currency", currency: card.currency }).format(Number(card.amount))}</span> : null}
          <span className={styles.spacer} />
          {canEdit && card.kind === "external_quotation" ? <FileUploader accept="application/pdf" appearance="button" multiple={false} label={t("New version")}
            onFiles={async (files) => {
              if (!files[0]) return;
              try { setDocuments((await api.addVersion(card.id, card.version, files[0])).documents); }
              catch (cause) { setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("Could not save.") }); }
            }} /> : null}
        </header>
        <Versions card={card} fileUrl={(number) => api.fileUrl(card.id, number)} date={date} />
      </article>) : <EmptyState title={t("No other quotation documents")} description={t("Upload a quotation made elsewhere; it keeps its own number.")} />}
    </section>

    {uploading ? <UploadQuotationDialog currency={state.quote.currency} onClose={() => setUploading(false)}
      onUpload={async (input) => { setDocuments((await api.uploadExternal(input)).documents); setUploading(false); }} /> : null}
  </div>;
}

function Versions({ card, fileUrl, date }: { card: DocumentCard; fileUrl: (number: number) => string; date: (value: string) => string }) {
  const t = useT();
  return <DocumentTable label={t("Versions of {name}", { name: card.reference ?? card.title })} getRowKey={(row) => String(row.number)} rows={card.versions} columns={[
    { id: "version", header: t("Version"), cell: (row) => t("V{number}", { number: row.number }) },
    { id: "what", header: t("What"), cell: (row) => t(PURPOSE_LABEL[row.purpose] as never) },
    { id: "who", header: t("By"), cell: (row) => row.createdByName ?? (row.purpose === "signed" ? t("Client") : "—") },
    { id: "when", header: t("Date"), cell: (row) => date(row.createdAt) },
    { id: "file", header: t("File"), align: "end", cell: (row) => <a href={fileUrl(row.number)} target="_blank" rel="noreferrer">{t("View")}</a> },
  ]} />;
}

function UploadQuotationDialog({ currency, onClose, onUpload }: { currency: string; onClose: () => void;
  onUpload: (input: { id: string; reference: string; title: string; amount?: string; currency?: string; file: File }) => Promise<void> }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  return <FormDialog title={t("Upload a quotation")} onClose={onClose} submitLabel={t("Upload")} error={error || undefined}
    isDirty={Boolean(file || reference || title || amount)} isSubmitDisabled={!file || !reference.trim()}
    onSubmit={async () => {
      setError("");
      try { await onUpload({ id, reference: reference.trim(), title: title.trim() || reference.trim(), file: file!, ...(amount.trim() ? { amount: amount.trim(), currency } : {}) }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); throw new FormNotSaved(); }
    }}>
    <FileUploader accept="application/pdf" appearance="button" multiple={false} label={file ? file.name : t("Choose the PDF")} onFiles={(files) => setFile(files[0] ?? null)} />
    <TextInput label={t("Its quotation number")} description={t("Kept as it is; it doesn't use your numbering.")} isRequired maxLength={120} value={reference} onChange={setReference} />
    <TextInput label={t("Title")} maxLength={240} value={title} onChange={setTitle} />
    <MoneyField label={t("Amount")} currency={currency} value={amount} onChange={setAmount} />
  </FormDialog>;
}
