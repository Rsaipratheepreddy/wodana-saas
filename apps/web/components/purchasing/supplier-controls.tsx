"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Badge,
  Button, DateField, EmptyState, FileUploader, FormDialog, FormRow, InlineNotice, MoneyField, SelectField, Skeleton, Switch, Tabs, TextAreaField, TextInput, VisuallyHidden,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { BankAccount, BankSource, DocumentKind, SupplierControlsState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

const KINDS: DocumentKind[] = ["trade_licence", "tax_certificate", "insurance", "bank_letter", "other"];
const SOURCES: BankSource[] = ["supplier_letter", "email", "in_person", "phone"];

function useControlLabels() {
  const t = useT();
  return useMemo(() => ({
    kind: { trade_licence: t("Trade licence"), tax_certificate: t("Tax certificate"), insurance: t("Insurance"), bank_letter: t("Bank letter"), other: t("Other") } satisfies Record<DocumentKind, string>,
    source: { supplier_letter: t("Letter from the supplier"), email: t("Email"), in_person: t("In person"), phone: t("Phone") } satisfies Record<BankSource, string>,
    bank: { pending: t("Waiting for checks"), approved: t("In use"), rejected: t("Refused"), retired: t("Replaced") } satisfies Record<BankAccount["status"], string>,
  }), [t]);
}

/**
 * A supplier's controls, in tabs: documents (with expiry; a required one that expires puts the supplier
 * on hold), bank details (changed only after a call-back and someone else's approval), and performance
 * from the records.
 */
export function SupplierControls({ api, supplierId, onChanged }: { api: PurchasingApi; supplierId: string; onChanged: () => void }) {
  const t = useT();
  const [state, setState] = useState<SupplierControlsState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.supplierControls(supplierId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the supplier.")); }
  }, [api, supplierId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const accept = (next: SupplierControlsState) => { setState(next); onChanged(); };
  if (error && !state) return <InlineNotice tone="error" message={error} />;
  if (!state) return <Skeleton lines={4} shape="form" />;
  return <Tabs items={[
    { id: "documents", label: t("Documents"), panel: <Documents api={api} state={state} onState={accept} /> },
    { id: "bank", label: t("Bank details"), panel: <Bank api={api} state={state} onState={accept} /> },
    { id: "contracts", label: t("Rate contracts"), panel: <Contracts api={api} state={state} onState={accept} /> },
    { id: "performance", label: t("Performance"), panel: <Performance state={state} /> },
  ]} />;
}

function Documents({ api, state, onState }: { api: PurchasingApi; state: SupplierControlsState; onState: (next: SupplierControlsState) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useControlLabels();
  const [adding, setAdding] = useState(false);
  const current = state.documents.filter((document) => !document.replacedAt);
  const today = format.today();
  return <div className={styles.stack}>
    {!current.length ? <EmptyState illustration={null} title={t("No documents yet")} /> : <ul className={styles.receipts} aria-label={t("Documents")}>{current.map((document) => {
      const expired = document.expiresOn !== null && document.expiresOn < today;
      return <li key={document.id}>
        <span className={styles.nameCell}><span>{document.kind === "other" ? document.label : labels.kind[document.kind]}</span>
          <small>{[document.number, document.required ? t("Required") : ""].filter(Boolean).join(" · ")}</small></span>
        <span className={expired ? styles.lateText : styles.muted}>{document.expiresOn ? (expired ? t("Expired {date}", { date: format.day(document.expiresOn) }) : t("Until {date}", { date: format.day(document.expiresOn) })) : "—"}</span>
        {document.hasFile ? <a href={api.documentUrl(document.id)} target="_blank" rel="noreferrer">{t("Open")}</a> : null}
      </li>;
    })}</ul>}
    {state.canManage ? <div><Button size="compact" onPress={() => setAdding(true)}>{t("Add document")}</Button></div> : null}
    {adding ? <DocumentDialog api={api} supplierId={state.supplier.id} onClose={() => setAdding(false)} onSaved={(next) => { setAdding(false); onState(next); }} /> : null}
  </div>;
}

function DocumentDialog({ api, supplierId, onClose, onSaved }: { api: PurchasingApi; supplierId: string; onClose: () => void; onSaved: (next: SupplierControlsState) => void }) {
  const t = useT();
  const labels = useControlLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<DocumentKind>("trade_licence");
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [required, setRequired] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const save = async () => {
    let next = await api.addDocument(supplierId, { id, kind, label: label.trim(), number: number.trim(), expiresOn, required });
    if (file) next = await api.uploadDocument(supplierId, id, file);
    onSaved(next);
  };
  return <FormDialog size="md" title={t("Add document")} onClose={onClose} isDirty={Boolean(label.trim() || number.trim() || file)}
    isSubmitDisabled={(kind === "other" && !label.trim()) || (required && !expiresOn)} submitLabel={t("Save")} onSubmit={save}>
      <FormRow>
        <SelectField label={t("Document")} isRequired selectedKey={kind} onSelectionChange={(key) => setKind(key as DocumentKind)} items={KINDS.map((item) => ({ id: item, label: labels.kind[item] }))} />
        {kind === "other" ? <TextInput label={t("Name")} isRequired maxLength={160} value={label} onChange={setLabel} /> : <TextInput label={t("Number")} maxLength={120} value={number} onChange={setNumber} />}
      </FormRow>
      <DateField label={t("Expires on")} isRequired={required} value={expiresOn ? parseDate(expiresOn) : null} onChange={(value) => setExpiresOn(value ? value.toString() : null)} />
      <Switch isSelected={required} onChange={setRequired}>{t("Required: the supplier goes on hold when it expires")}</Switch>
      <FileUploader appearance="button" accept="application/pdf,image/*" label={file ? file.name : t("Attach the file")} multiple={false} onFiles={(files) => setFile(files[0] ?? null)} />
  </FormDialog>;
}

function Bank({ api, state, onState }: { api: PurchasingApi; state: SupplierControlsState; onState: (next: SupplierControlsState) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useControlLabels();
  const [requesting, setRequesting] = useState(false);
  const [dialog, setDialog] = useState<{ account: BankAccount; action: "callback" | "reject" } | null>(null);
  const [notice, setNotice] = useState("");
  const run = async (account: BankAccount, input: Record<string, unknown>, inDialog = false) => {
    setNotice("");
    try { onState(await api.bankAccountCommand(state.supplier.id, account.id, input)); return true; }
    catch (cause) { if (inDialog) throw cause; setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  return <div className={styles.stack}>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {!state.bankAccounts.length ? <EmptyState illustration={null} title={t("No bank details yet")} /> : <ul className={styles.bankAccounts} aria-label={t("Bank details")}>{state.bankAccounts.map((account) => {
      const mine = account.requestedBy === state.me;
      return <li key={account.id}>
        <span className={styles.nameCell}><span>{`${account.bankName} · ${account.accountNumber}`}</span>
          <small>{[account.accountName, account.swift, account.currency, labels.source[account.source], t("by {name}", { name: account.requestedByName })].filter(Boolean).join(" · ")}</small>
          {account.callbackByName ? <small>{t("Called back by {name}: {note}", { name: account.callbackByName, note: account.callbackNote })}</small> : null}
          {account.rejectReason ? <small>{t("Refused: {reason}", { reason: account.rejectReason })}</small> : null}</span>
        <Badge tone={account.status === "approved" ? "success" : account.status === "pending" ? "warning" : "neutral"}>{labels.bank[account.status]}</Badge>
        {account.status === "pending" && state.canApprove && !mine ? <span className={styles.filters}>
          {!account.callbackByName ? <Button size="compact" onPress={() => setDialog({ account, action: "callback" })}>{t("Record the call-back")}</Button>
            : <Button size="compact" variant="primary" onPress={() => void run(account, { action: "approve" })}>{t("Approve")}</Button>}
          <Button size="compact" variant="quiet" onPress={() => setDialog({ account, action: "reject" })}>{t("Refuse")}</Button>
        </span> : account.status === "pending" && mine ? <small className={styles.muted}>{t("Someone else checks details you recorded.")}</small> : null}
        {account.decidedAt ? <small className={styles.muted}>{format.when(account.decidedAt)}</small> : null}
      </li>;
    })}</ul>}
    {state.canManage && !state.bankAccounts.some((account) => account.status === "pending") ? <div><Button size="compact" onPress={() => setRequesting(true)}>{t("New bank details")}</Button></div> : null}
    {requesting ? <BankDialog onClose={() => setRequesting(false)} onSave={async (input) => {
      onState(await api.requestBankAccount(state.supplier.id, { id: crypto.randomUUID(), ...input })); setRequesting(false);
    }} /> : null}
    {dialog ? <NoteDialog title={dialog.action === "callback" ? t("Record the call-back") : t("Refuse the bank details")}
      label={dialog.action === "callback" ? t("Who you called, on which number the firm already had") : t("Why they're refused")}
      onClose={() => setDialog(null)} onSave={async (note) => { await run(dialog.account, dialog.action === "callback" ? { action: "callback", note } : { action: "reject", reason: note }, true); setDialog(null); }} /> : null}
  </div>;
}

function BankDialog({ onClose, onSave }: { onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const labels = useControlLabels();
  const [form, setForm] = useState({ accountName: "", bankName: "", accountNumber: "", swift: "", source: "supplier_letter" as BankSource });
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  return <FormDialog size="md" title={t("New bank details")} onClose={onClose} isDirty={Boolean(form.accountName.trim() || form.bankName.trim() || form.accountNumber.trim())}
    isSubmitDisabled={!form.accountName.trim() || !form.bankName.trim() || !form.accountNumber.trim()} submitLabel={t("Save")} onSubmit={() => onSave(form)}>
    <TextInput label={t("Account name")} isRequired maxLength={160} value={form.accountName} onChange={set("accountName")} />
    <FormRow>
      <TextInput label={t("Bank")} isRequired maxLength={160} value={form.bankName} onChange={set("bankName")} />
      <TextInput label={t("SWIFT")} maxLength={11} value={form.swift} onChange={set("swift")} />
    </FormRow>
    <TextInput label={t("Account number or IBAN")} isRequired maxLength={34} value={form.accountNumber} onChange={set("accountNumber")} />
    <SelectField label={t("How the details came")} isRequired selectedKey={form.source} onSelectionChange={(key) => set("source")(String(key))} items={SOURCES.map((item) => ({ id: item, label: labels.source[item] }))} />
  </FormDialog>;
}

function NoteDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={title} onClose={onClose} cancelLabel={t("Back")} isDirty={Boolean(note.trim())} isSubmitDisabled={!note.trim()} submitLabel={t("Save")} onSubmit={() => onSave(note.trim())}>
    <TextAreaField label={label} isRequired value={note} onChange={setNote} />
  </FormDialog>;
}

function Contracts({ api, state, onState }: { api: PurchasingApi; state: SupplierControlsState; onState: (next: SupplierControlsState) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const stateLabel = { upcoming: t("Starts later"), valid: t("Valid"), expired: t("Expired"), cancelled: t("Cancelled") };
  return <div className={styles.stack}>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {!state.contracts.length ? <EmptyState illustration={null} title={t("No rate contracts")} /> : <ul className={styles.bankAccounts} aria-label={t("Rate contracts")}>{state.contracts.map((contract) => <li key={contract.id}>
      <span className={styles.nameCell}><span>{contract.reference}</span>
        <small>{`${format.day(contract.validFrom)} – ${format.day(contract.validTo)} · ${contract.currency}`}</small>
        {contract.lines.map((line) => <small key={line.id}>{[`${line.itemName}: ${format.money(line.unitPrice, contract.currency)} / ${line.unit}`,
          line.packSize ? t("packs of {pack}", { pack: quantityText(line.packSize) }) : "", line.minimum ? t("at least {minimum}", { minimum: quantityText(line.minimum) }) : ""].filter(Boolean).join(" · ")}</small>)}
        {contract.cancelReason ? <small>{t("Cancelled: {reason}", { reason: contract.cancelReason })}</small> : null}</span>
      <Badge tone={contract.state === "valid" ? "success" : contract.state === "upcoming" ? "info" : "neutral"}>{stateLabel[contract.state]}</Badge>
      {state.canManage && contract.status === "active" ? <Button size="compact" variant="quiet" onPress={() => setCancelling(contract.id)}>{t("Cancel")}</Button> : null}
    </li>)}</ul>}
    {state.canManage ? <div><Button size="compact" onPress={() => setAdding(true)}>{t("Add rate contract")}</Button></div> : null}
    {adding ? <ContractDialog state={state} onClose={() => setAdding(false)} onSave={async (input) => {
      onState(await api.saveContract(state.supplier.id, { id: crypto.randomUUID(), ...input })); setAdding(false);
    }} /> : null}
    {cancelling ? <NoteDialog title={t("Cancel the rate contract")} label={t("Why it's cancelled")} onClose={() => setCancelling(null)} onSave={async (reason) => {
      onState(await api.cancelContract(state.supplier.id, cancelling, reason)); setCancelling(null);
    }} /> : null}
  </div>;
}

type ContractLine = { catalogItemId: string | null; unitPrice: string; packSize: string; minimum: string };

function ContractDialog({ state, onClose, onSave }: { state: SupplierControlsState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [reference, setReference] = useState("");
  const [currency, setCurrency] = useState(state.supplier.currency ?? "");
  const [validFrom, setValidFrom] = useState<string | null>(null);
  const [validTo, setValidTo] = useState<string | null>(null);
  const [lines, setLines] = useState<ContractLine[]>([{ catalogItemId: null, unitPrice: "", packSize: "", minimum: "" }]);
  const setLine = (index: number, patch: Partial<ContractLine>) => setLines(lines.map((line, item) => (item === index ? { ...line, ...patch } : line)));
  const filled = lines.filter((line) => line.catalogItemId && line.unitPrice !== "");
  const ready = reference.trim() && /^[A-Za-z]{3}$/.test(currency.trim()) && validFrom && validTo && validTo >= validFrom && filled.length > 0;
  const numeric = (value: string) => value.replace(/[^\d.]/g, "");
  return <FormDialog size="lg" title={t("Add rate contract")} onClose={onClose} isDirty={Boolean(reference.trim() || filled.length)} isSubmitDisabled={!ready} submitLabel={t("Save")}
    onSubmit={() => onSave({ reference: reference.trim(), currency: currency.trim().toUpperCase(), validFrom, validTo,
      lines: filled.map((line) => ({ catalogItemId: line.catalogItemId, unitPrice: line.unitPrice, packSize: line.packSize || null, minimum: line.minimum || null })) })}>
      <FormRow>
        <TextInput label={t("Reference")} isRequired maxLength={120} value={reference} onChange={setReference} />
        <TextInput label={t("Currency")} isRequired value={currency} onChange={(value) => setCurrency(value.toUpperCase().slice(0, 3))} />
      </FormRow>
      <FormRow>
        <DateField label={t("Valid from")} isRequired value={validFrom ? parseDate(validFrom) : null} onChange={(value) => setValidFrom(value ? value.toString() : null)} />
        <DateField label={t("Valid to")} isRequired minValue={validFrom ? parseDate(validFrom) : undefined} value={validTo ? parseDate(validTo) : null} onChange={(value) => setValidTo(value ? value.toString() : null)} />
      </FormRow>
      <ul className={styles.draftLines} aria-label={t("Prices")}>{lines.map((line, index) => <li key={index}>
        <SelectField label={<VisuallyHidden>{t("Item, line {number}", { number: index + 1 })}</VisuallyHidden>} placeholder={t("Choose an item")} selectedKey={line.catalogItemId}
          onSelectionChange={(key) => setLine(index, { catalogItemId: key === null ? null : String(key) })} items={state.catalogItems.map((item) => ({ id: item.id, label: `${item.name} (${item.unit})` }))} />
        <MoneyField label={<VisuallyHidden>{t("Price, line {number}", { number: index + 1 })}</VisuallyHidden>} currency={/^[A-Z]{3}$/.test(currency) ? currency : undefined} value={line.unitPrice} onChange={(unitPrice) => setLine(index, { unitPrice })} />
        <TextInput aria-label={t("Pack size, line {number}", { number: index + 1 })} label={null} placeholder={t("Pack size")} inputMode="decimal" value={line.packSize} onChange={(value) => setLine(index, { packSize: numeric(value) })} />
        <TextInput aria-label={t("Minimum, line {number}", { number: index + 1 })} label={null} placeholder={t("Minimum")} inputMode="decimal" value={line.minimum} onChange={(value) => setLine(index, { minimum: numeric(value) })} />
        <span />
      </li>)}</ul>
      <div><Button size="compact" variant="quiet" onPress={() => setLines([...lines, { catalogItemId: null, unitPrice: "", packSize: "", minimum: "" }])}>{t("Add line")}</Button></div>
  </FormDialog>;
}

function Performance({ state }: { state: SupplierControlsState }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const card = state.scorecard;
  return <div className={styles.stack}>
    <dl className={styles.facts}>
      <div><dt>{t("Orders")}</dt><dd>{card.orders.length ? card.orders.map((row) => `${row.orders} · ${format.money(row.value, row.currency)}`).join(", ") : "—"}</dd></div>
      <div><dt>{t("On time")}</dt><dd>{card.onTimePercent === null ? "—" : t("{percent}% of {count} lines", { percent: card.onTimePercent, count: card.deliveredLines })}</dd></div>
      <div><dt>{t("Rejected")}</dt><dd>{card.rejectPercent === null ? "—" : t("{percent}% ({quantity} of {received})", { percent: card.rejectPercent, quantity: quantityText(card.rejected), received: quantityText(card.received) })}</dd></div>
      <div><dt>{t("Returns")}</dt><dd>{card.returns}</dd></div>
      <div><dt>{t("Price requests")}</dt><dd>{card.priceRequests ? t("Answers {percent}%, in {days} days on average", { percent: card.replyPercent ?? "0", days: card.replyDays ?? "—" }) : "—"}</dd></div>
    </dl>
    {state.openOrders.length ? <ul className={styles.receipts} aria-label={t("Open orders")}>{state.openOrders.map((order) => <li key={order.id}>
      <span className={styles.nameCell}><span>{order.number}</span></span><span className={styles.muted}>{labels.status[order.status]}</span>
      <span className={styles.money}>{format.money(order.total, order.currency)}</span>
    </li>)}</ul> : null}
  </div>;
}
