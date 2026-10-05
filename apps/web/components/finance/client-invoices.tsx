"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DataGrid, DateField, EmptyState, ErrorState, FormDialog, FormRow, InlineNotice, InspectorSheet, MoreDetails, NoResultsState, ListTabs, RecordName, Skeleton, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ReceivablesApi } from "@/lib/receivables/client";
import type { ClientInvoice, InvoicePreview, InvoiceState, MilestoneToInvoice, PaymentReminder, ReceivablesState } from "@/lib/receivables/types";
import { useProjectFormat } from "../project-core/format";
import { plain } from "./finance-labels";
import styles from "./finance.module.css";

type View = "to_invoice" | "invoices";

/** When the client was last reminded to pay, and how. */
function LastReminder({ reminder }: { reminder?: PaymentReminder | null }) {
  const t = useT();
  const format = useProjectFormat();
  if (!reminder) return <span className={styles.nameCell}><small>—</small></span>;
  return <span className={styles.nameCell}><span>{format.day(reminder.on)}</span><small>{reminder.channel === "whatsapp" ? "WhatsApp" : t("Email")}</small></span>;
}

/** Where a client invoice stands: credited, paid, overdue, part paid or to be paid. */
function InvoiceStatus({ invoice }: { invoice: ClientInvoice }) {
  const t = useT();
  const [key, tone, label] = invoice.status === "credited" ? ["credited", "neutral", t("Credited")]
    : Number(invoice.balance) <= 0 ? ["paid", "success", t("Paid")]
    : invoice.overdue ? ["overdue", "danger", t("Overdue")]
    : Number(invoice.paid) > 0 ? ["part_paid", "info", t("Part paid")] : ["to_pay", "info", t("To be paid")];
  return <span className={styles.status} data-tone={tone} data-state={key}>{label}</span>;
}

/** Tax invoices to clients: the projects' milestones still to invoice, and the invoices with where each stands. */
export function ClientInvoices({ api, openId, onOpen }: { api: ReceivablesApi; openId: string | null; onOpen: (id: string | null) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<ReceivablesState | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("to_invoice");
  const [search, setSearch] = useState("");
  const [issuing, setIssuing] = useState<MilestoneToInvoice | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const remind = useCallback(async (caseId: string, paymentId: string) => {
    setReminding(`${caseId}|${paymentId}`); setError(""); setNotice("");
    try {
      const result = await api.remind(caseId, paymentId);
      setNotice(result.already ? t("Already reminded today.") : result.channel === "whatsapp" ? t("Reminder sent on WhatsApp.") : t("Reminder sent by email."));
      setState(await api.state());
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The reminder couldn't be sent.")); }
    finally { setReminding(null); }
  }, [api, t]);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Client invoices didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const needle = search.trim().toLocaleLowerCase();
  const milestoneColumns = useMemo<DataGridColumn<MilestoneToInvoice>[]>(() => [
    { id: "milestone", header: t("Milestone"), accessorFn: (row) => row.title, size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={row.title} detail={`${row.clientName} · ${row.projectReference} · ${row.projectName}`} /> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueDate ?? "", size: 140, meta: { mobileHidden: true, renderCell: (row) => <span className={row.dueDate && row.dueDate < format.today()
      ? styles.lateText : undefined}>{row.dueDate ? format.day(row.dueDate) : "—"}</span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 170, meta: { align: "end", renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.amount, row.currency ?? "")}</span>
      {Number(row.paid) > 0 ? <small>{t("{amount} paid", { amount: format.money(row.paid, row.currency ?? "") })}</small> : null}</span> } },
    { id: "reminded", header: t("Reminded"), accessorFn: (row) => row.lastReminder?.on ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => <LastReminder reminder={row.lastReminder} /> } },
    { id: "action", header: "", accessorFn: () => "", size: 250, meta: { renderCell: (row) => state?.canManage ? <span className={styles.rowActions}>
      <Button size="compact" onPress={() => setIssuing(row)}>{t("Issue invoice")}</Button>
      {row.dueDate && Number(row.amount) > Number(row.paid) ? <Button size="compact" variant="quiet" isLoading={reminding === `${row.caseId}|${row.paymentId}`} onPress={() => void remind(row.caseId, row.paymentId)}>{t("Send reminder")}</Button> : null}
    </span> : null } },
  ], [t, format, state?.canManage, reminding, remind]);
  const invoiceColumns = useMemo<DataGridColumn<ClientInvoice>[]>(() => [
    { id: "invoice", header: t("Invoice"), accessorFn: (row) => row.number, size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={`${row.number} · ${row.customerName}`} detail={`${row.projectReference} · ${row.milestoneTitle}`} /> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueDate, size: 150, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span className={row.overdue ? styles.lateText : undefined}>{format.day(row.dueDate)}</span><small>{t("Issued {date}", { date: format.day(row.issueDate) })}</small></span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.total), size: 170, meta: { align: "end", renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.total, row.currency)}</span>
      {row.status === "issued" && Number(row.paid) > 0 && Number(row.balance) > 0 ? <small>{t("{amount} left", { amount: format.money(row.balance, row.currency) })}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <InvoiceStatus invoice={row} /> } },
    { id: "reminded", header: t("Reminded"), accessorFn: (row) => row.lastReminder?.on ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => <LastReminder reminder={row.lastReminder} /> } },
    { id: "action", header: "", accessorFn: () => "", size: 150, meta: { renderCell: (row) => state?.canManage && row.status === "issued" && Number(row.balance) > 0
      ? <Button size="compact" variant="quiet" isLoading={reminding === `${row.caseId}|${row.paymentId}`} onPress={() => void remind(row.caseId, row.paymentId)}>{t("Send reminder")}</Button> : null } },
  ], [t, format, state?.canManage, reminding, remind]);
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  const toolbar = <ListTabs label={t("Show")} value={view} onChange={(value) => { setView(value); setSearch(""); }}
    items={[{ id: "to_invoice", label: t("To invoice") }, { id: "invoices", label: t("Invoices") }]} />;
  const milestones = (state?.toInvoice ?? []).filter((row) => !needle || `${row.title} ${row.clientName} ${row.projectReference} ${row.projectName}`.toLocaleLowerCase().includes(needle));
  const invoices = (state?.invoices ?? []).filter((row) => !needle || `${row.number} ${row.customerName} ${row.projectReference} ${row.milestoneTitle}`.toLocaleLowerCase().includes(needle));
  return <>
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {error && state ? <InlineNotice tone="error" message={error} /> : null}
    {view === "to_invoice"
      ? <DataGrid<MilestoneToInvoice> ariaLabel={t("Milestones to invoice")} columns={milestoneColumns} data={milestones} getRowId={(row) => `${row.caseId}|${row.paymentId}`}
          isLoading={!state} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search milestones")} rowNumbers={false} toolbarLeading={toolbar}
          emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("Every milestone is invoiced")} />} />
      : <DataGrid<ClientInvoice> ariaLabel={t("Client invoices")} columns={invoiceColumns} data={invoices} getRowId={(row) => row.id} isLoading={!state}
          onRowAction={(row) => onOpen(row.id)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search invoices")} rowNumbers={false} toolbarLeading={toolbar}
          emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No client invoices yet")} />} />}
    {issuing ? <IssueDialog api={api} milestone={issuing} onClose={() => setIssuing(null)} onIssued={(id) => { setIssuing(null); setView("invoices"); void load(); onOpen(id); }} /> : null}
    {openId ? <InvoiceSheet api={api} invoiceId={openId} onChanged={() => void load()} onClose={() => onOpen(null)} /> : null}
  </>;
}

/** Issuing a milestone's invoice: what it will say (lines by tax rate, client and company), its dates and the client's tax number. */
function IssueDialog({ api, milestone, onClose, onIssued }: { api: ReceivablesApi; milestone: MilestoneToInvoice; onClose: () => void; onIssued: (id: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [id] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [issueDate, setIssueDate] = useState<string | null>(format.today());
  const [dueDate, setDueDate] = useState<string | null>(milestone.dueDate && milestone.dueDate > format.today() ? milestone.dueDate : format.today());
  const [taxNumber, setTaxNumber] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.preview(milestone.caseId, milestone.paymentId).then((next) => { if (live) setPreview(next); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, milestone, t]);
  const money = (value: string) => format.money(value, preview?.currency ?? milestone.currency ?? "");
  return <FormDialog size="lg" title={t("Issue invoice")} description={`${milestone.clientName} · ${milestone.title}`} onClose={onClose} error={error || undefined}
    isDirty={Boolean(taxNumber.trim() || note.trim())} isSubmitDisabled={!preview || !issueDate || !dueDate || dueDate < issueDate} submitLabel={t("Issue invoice")}
    onSubmit={async () => { setError(""); onIssued((await api.issue({ id, caseId: milestone.caseId, paymentId: milestone.paymentId, issueDate, dueDate, customerTaxNumber: taxNumber.trim(), note: note.trim() })).invoice.id); }}>
    {!preview && !error ? <Skeleton lines={6} shape="facts" /> : <>
      {preview ? <>
        <dl className={styles.facts}>
          <div><dt>{t("From")}</dt><dd>{[preview.company.name, preview.company.taxNumber].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>{t("To")}</dt><dd>{[preview.customer.name, preview.customer.address].filter(Boolean).join(" · ")}</dd></div>
        </dl>
        <ul className={styles.list}>{preview.lines.map((line, index) => <li key={index}>
          <span className={styles.nameCell}><span>{line.description}</span>
            <small>{t("{net} + tax {tax} at {rate}%", { net: money(line.net), tax: money(line.tax), rate: plain(line.rate) })}</small></span>
          <span className={styles.money}>{money(line.total)}</span></li>)}</ul>
        <dl className={styles.totals}>
          <div><dt>{t("Net")}</dt><dd>{money(preview.net)}</dd></div>
          <div><dt>{t("Tax")}</dt><dd>{money(preview.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(preview.total)}</strong></dd></div>
        </dl>
      </> : null}
      <FormRow>
        <DateField label={t("Invoice date")} isRequired value={issueDate ? parseDate(issueDate) : null} onChange={(value) => setIssueDate(value ? value.toString() : null)} />
        <DateField label={t("Due date")} isRequired minValue={issueDate ? parseDate(issueDate) : undefined} value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)} />
      </FormRow>
      <TextInput label={t("Client tax number")} maxLength={60} value={taxNumber} onChange={setTaxNumber} />
      <MoreDetails filled={note.trim() ? 1 : 0}>
        <TextAreaField label={t("Note on the invoice")} value={note} onChange={setNote} />
      </MoreDetails>
    </>}
  </FormDialog>;
}

/** One invoice: who it's from and to, its lines by tax rate, what's paid, and its credit note if it was credited. */
function InvoiceSheet({ api, invoiceId, onChanged, onClose }: { api: ReceivablesApi; invoiceId: string; onChanged: () => void; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<InvoiceState | null>(null);
  const [error, setError] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.invoice(invoiceId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The invoice didn't load.")); }
  }, [api, invoiceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const invoice = state?.invoice;
  const money = (value: string) => (invoice ? format.money(value, invoice.currency) : value);
  return <InspectorSheet isOpen size="lg" title={invoice ? `${invoice.number} · ${invoice.customerName}` : t("Client invoice")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state?.canCredit ? <div className="wd-dialog-actions"><Button variant="quiet" onPress={() => { setReason(""); setCrediting(true); }}>{t("Credit invoice")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !invoice ? <Skeleton lines={8} shape="facts" /> : <div className={styles.sheet}>
      <div className={styles.headRow}><InvoiceStatus invoice={invoice} /><span className={styles.muted}>{`${invoice.projectReference} · ${invoice.milestoneTitle}`}</span></div>
      {invoice.status === "credited" ? <InlineNotice tone="info" message={t("Credited by {note} on {date}: {reason}", { note: invoice.creditNoteNumber ?? "", date: format.day(invoice.creditedOn),
        reason: invoice.creditReason ?? "" })} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("From")}</dt><dd>{[invoice.companyName, invoice.companyTaxNumber, invoice.companyAddress].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("To")}</dt><dd>{[invoice.customerName, invoice.customerTaxNumber, invoice.customerAddress].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Invoice date")}</dt><dd>{format.day(invoice.issueDate)}</dd></div>
        <div><dt>{t("Due")}</dt><dd className={invoice.overdue ? styles.lateText : undefined}>{format.day(invoice.dueDate)}</dd></div>
        {invoice.status === "issued" ? <div><dt>{t("Paid")}</dt><dd className={styles.money}>{t("{paid} of {total}", { paid: money(invoice.paid), total: money(invoice.total) })}</dd></div> : null}
        <div><dt>{t("Issued by")}</dt><dd>{invoice.issuedByName}</dd></div>
        {invoice.note ? <div><dt>{t("Note")}</dt><dd>{invoice.note}</dd></div> : null}
      </dl>
      <section className={styles.part} aria-label={t("Lines")}>
        <ul className={styles.list}>{state.lines.map((line) => <li key={line.id}>
          <span className={styles.nameCell}><span>{line.description}</span>
            <small>{t("{net} + tax {tax} at {rate}%", { net: money(line.net), tax: money(line.tax), rate: plain(line.taxRate) })}</small></span>
          <span className={styles.money}>{money(line.total)}</span></li>)}</ul>
        <dl className={styles.totals}>
          <div><dt>{t("Net")}</dt><dd>{money(invoice.net)}</dd></div>
          <div><dt>{t("Tax")}</dt><dd>{money(invoice.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(invoice.total)}</strong></dd></div>
        </dl>
      </section>
    </div>}
    {crediting && invoice ? <FormDialog size="md" title={t("Credit invoice")} onClose={() => setCrediting(false)} cancelLabel={t("Back")}
      isDirty={Boolean(reason.trim())} isSubmitDisabled={!reason.trim()} submitLabel={t("Credit invoice")} submitVariant="danger"
      onSubmit={async () => { setState(await api.credit(invoice.id, invoice.version, reason.trim())); onChanged(); setCrediting(false); }}>
      <TextAreaField label={t("Why it's credited")} description={t("The whole invoice is credited; the milestone can then be invoiced again.")} isRequired value={reason} onChange={setReason} />
    </FormDialog> : null}
  </InspectorSheet>;
}
