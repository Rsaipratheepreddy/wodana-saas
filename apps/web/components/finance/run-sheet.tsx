"use client";

import { useCallback, useEffect, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, Checkbox, DateField, ErrorState, FormDialog, FormNotSaved, InlineNotice, InspectorSheet, MenuButton, MoneyField, Skeleton, TextAreaField, TextInput, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { Bill, RunState } from "@/lib/payables/types";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { plain, RunStatusLabel } from "./finance-labels";
import styles from "./finance.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type Dialog = "return" | "cancel" | "paid" | null;
type Action = "save" | "submit" | "approve" | "return" | "paid" | "cancel";

/**
 * One payment run. As a draft: approved invoices with something to pay now, how much of each (all of it
 * unless changed), and everything due by a date at once. Then it's submitted, approved by someone else or
 * sent back, downloaded for the bank, and marked paid with the bank's reference for each payment.
 */
export function RunSheet({ api, runId, bills, canManage, onChanged, onCreated, onClose }: {
  api: PayablesApi; runId: string | null; bills: Bill[]; canManage: boolean; onChanged: () => void; onCreated: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [id] = useState(() => runId ?? crypto.randomUUID());
  const [state, setState] = useState<RunState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Action | "download" | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [dueBy, setDueBy] = useState<string | null>(format.today());
  const [paidOn, setPaidOn] = useState<string | null>(format.today());
  const [references, setReferences] = useState<Record<string, string>>({});
  const take = useCallback((next: RunState) => {
    setState(next);
    setPicks(Object.fromEntries(next.items.map((item) => [item.invoiceId, plain(item.amount)])));
    setNote(next.run.note);
  }, []);
  const load = useCallback(async () => {
    if (!runId) return;
    try { take(await api.run(runId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The run didn't load.")); }
  }, [api, runId, t, take]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  /** Runs one change; a clash with someone else's change reloads the run and says so. */
  const command = async (action: Action, input: Record<string, unknown>) => {
    setBusy(action); setNotice("");
    try { const next = await api.runCommand(action, { id, ...input }); take(next); onChanged(); return next; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return null;
    } finally { setBusy(null); }
  };

  const run = state?.run;
  const editing = runId ? Boolean(state?.canEdit) : canManage;
  const mine = new Set((state?.items ?? []).map((item) => item.invoiceId));
  // What can go in: approved invoices with something to pay now (a draft reserves nothing), and what's in it already.
  const candidates = bills.filter((bill) => bill.status === "approved" && (Number(bill.payable) > 0 || mine.has(bill.id)))
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.supplierName.localeCompare(b.supplierName) || a.number.localeCompare(b.number));
  const picked = candidates.filter((bill) => picks[bill.id] !== undefined);
  const over = (bill: Bill) => subtractExact(picks[bill.id] ?? "0", bill.payable) !== "0";
  const ready = picked.length > 0 && picked.every((bill) => Number(picks[bill.id]) > 0 && !over(bill));
  const pickedTotals = [...new Set(picked.map((bill) => bill.currency))].map((currency) => ({ currency, amount: addExact(...picked.filter((bill) => bill.currency === currency).map((bill) => picks[bill.id])) }));
  const toggle = (bill: Bill, on: boolean) => {
    const next = { ...picks };
    if (on) next[bill.id] = plain(bill.payable); else delete next[bill.id];
    setPicks(next);
  };
  /** Everything due by the date, at what each can be paid now. */
  const addDue = () => {
    if (!dueBy) return;
    const next = { ...picks };
    for (const bill of candidates) if (bill.dueDate && bill.dueDate <= dueBy && next[bill.id] === undefined && Number(bill.payable) > 0) next[bill.id] = plain(bill.payable);
    setPicks(next);
  };
  const save = async (submit: boolean) => {
    const saved = await command("save", { version: state?.run.version, note: note.trim(), items: picked.map((bill) => ({ invoiceId: bill.id, amount: picks[bill.id] })) });
    if (saved && submit) await command("submit", { version: saved.run.version });
    if (saved && !runId) onCreated(id);
  };
  const download = async () => {
    setBusy("download"); setNotice("");
    try {
      const file = await api.runFile(id);
      const url = URL.createObjectURL(file.body);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The file could not be made.")); }
    finally { setBusy(null); }
  };
  const openDialog = (next: Dialog) => {
    setText(""); setNotice("");
    if (next === "paid" && state) { setPaidOn(format.today()); setReferences(Object.fromEntries(state.payments.map((payment) => [payment.key, payment.reference]))); }
    setDialog(next);
  };

  const more = !state || !run ? [] : [
    ...(state.canReturn && run.status !== "draft" ? [{ id: "return", label: t("Send back") }] : []),
    ...(state.canCancel ? [{ id: "cancel", label: t("Cancel run") }] : []),
  ];
  const primary = editing ? <>
    <Button isLoading={busy === "save"} isDisabled={!ready || Boolean(busy)} onPress={() => void save(false)}>{t("Save draft")}</Button>
    <Button variant="primary" isLoading={busy === "submit"} isDisabled={!ready || Boolean(busy)} onPress={() => void save(true)}>{t("Submit")}</Button>
  </> : !state || !run ? null
    : run.status === "submitted" && state.canApproveThis ? <Button variant="primary" isLoading={busy === "approve"}
      onPress={() => void command("approve", { version: run.version })}>{t("Approve")}</Button>
    : run.status === "approved" && (state.canPay || state.canDownload) ? <>
      {state.canDownload ? <Button isLoading={busy === "download"} onPress={() => void download()}>{t("Download file")}</Button> : null}
      {state.canPay ? <Button variant="primary" onPress={() => openDialog("paid")}>{t("Mark paid")}</Button> : null}
    </> : null;
  const money = (value: string, currency: string) => format.money(value, currency);

  return <InspectorSheet isOpen size="lg" title={run ? t("Run {number}", { number: run.number }) : t("New run")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={primary || more.length ? <div className="wd-dialog-actions">
      {more.length ? <MenuButton size="compact" label={t("More")} onAction={(key) => openDialog(key as Dialog)} items={more} /> : null}
      <span className={styles.spacer} />{primary}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : runId && !state ? <Skeleton lines={8} shape="facts" /> : <div className={styles.sheet}>
      {run ? <div className={styles.headRow}><RunStatusLabel status={run.status} /><span className={styles.muted}>{t("Prepared by {name}", { name: run.preparedByName })}</span></div> : null}
      {notice && !dialog ? <InlineNotice tone="error" message={notice} /> : null}
      {run?.status === "draft" && run.returnNote ? <InlineNotice tone="info" message={t("Sent back: {note}", { note: run.returnNote })} /> : null}
      {run?.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: run.cancelReason ?? "" })} /> : null}
      {(state?.payments ?? []).flatMap((payment) => !payment.bank ? [<InlineNotice key={`${payment.key}-bank`} tone="error" message={t("{supplier} has no approved bank account.", { supplier: payment.supplierName })} />]
        : payment.bankChanged ? [<InlineNotice key={`${payment.key}-changed`} tone="error" message={t("{supplier}'s bank account changed since the run was approved; send it back.", { supplier: payment.supplierName })} />]
        : payment.bankChangePending && run?.status !== "paid" ? [<InlineNotice key={`${payment.key}-pending`} tone="info" message={t("New bank details for {supplier} are waiting for approval.", { supplier: payment.supplierName })} />]
        : [])}

      {editing ? <>
        <TextInput label={t("Note")} value={note} onChange={setNote} />
        <div className={styles.pickBar}>
          <DateField label={t("Due by")} value={dueBy ? parseDate(dueBy) : null} onChange={(value) => setDueBy(value ? value.toString() : null)} />
          <Button size="compact" isDisabled={!dueBy} onPress={addDue}>{t("Add all due")}</Button>
        </div>
        {candidates.length ? <section className={styles.part} aria-label={t("Invoices to pay")}>
          <div className={styles.allocations}>{candidates.map((bill) => <div key={bill.id} className={styles.allocation}>
            <Checkbox isSelected={picks[bill.id] !== undefined} onChange={(on) => toggle(bill, on)}>
              <span className={styles.nameCell}><span>{`${bill.supplierName} · ${bill.number}`}</span>
                <small>{[bill.dueDate ? t("Due {date}", { date: format.day(bill.dueDate) }) : "", t("{amount} to pay", { amount: money(bill.payable, bill.currency) })].filter(Boolean).join(" · ")}</small></span>
            </Checkbox>
            {picks[bill.id] !== undefined ? <MoneyField label={<VisuallyHidden>{t("Amount for {invoice}", { invoice: bill.number })}</VisuallyHidden>} currency={bill.currency}
              value={picks[bill.id]} max={plain(bill.payable)} onChange={(value) => setPicks({ ...picks, [bill.id]: value })} /> : <span />}
          </div>)}</div>
          {pickedTotals.length ? <dl className={styles.totals}>{pickedTotals.map((total) => <div key={total.currency}><dt>{t("Total")}</dt><dd><strong>{money(total.amount, total.currency)}</strong></dd></div>)}</dl> : null}
        </section> : <p className={styles.muted}>{t("No approved invoices to pay.")}</p>}
      </> : state && run ? <>
        <dl className={styles.facts}>
          <div><dt>{t("Total")}</dt><dd>{run.totals.map((total) => <span key={total.currency} className={styles.money}>{money(total.amount, total.currency)}</span>)}</dd></div>
          {run.note ? <div><dt>{t("Note")}</dt><dd>{run.note}</dd></div> : null}
          {run.approvedByName ? <div><dt>{t("Approved by")}</dt><dd>{run.approvedByName}</dd></div> : null}
          {run.paidOn ? <div><dt>{t("Paid on")}</dt><dd>{[format.day(run.paidOn), run.paidByName].filter(Boolean).join(" · ")}</dd></div> : null}
        </dl>
        <section className={styles.part} aria-label={t("Payments")}>
          <h3 className={styles.subhead}>{t("Payments")}</h3>
          <ul className={styles.list}>{state.payments.map((payment) => <li key={payment.key}>
            <span className={styles.nameCell}><span>{`${payment.supplierName} · ${payment.companyName}`}</span>
              <small>{[payment.invoices.map((invoice) => `${invoice.number} ${money(invoice.amount, payment.currency)}`).join(", "),
                payment.bank ? t("{bank} ending {digits}", { bank: payment.bank.bankName, digits: payment.bank.last4 }) : "", payment.paymentId ? payment.reference : ""].filter(Boolean).join(" · ")}</small></span>
            <span className={styles.money}>{money(payment.amount, payment.currency)}</span>
          </li>)}</ul>
        </section>
      </> : null}
    </div>}

    {dialog === "return" || dialog === "cancel" ? <FormDialog size="md" title={dialog === "return" ? t("Send back run") : t("Cancel run")} onClose={() => setDialog(null)} cancelLabel={t("Back")}
      error={notice || undefined} isSubmitting={busy === dialog} isDirty={Boolean(text.trim())} isSubmitDisabled={!text.trim()}
      submitLabel={dialog === "return" ? t("Send back") : t("Cancel run")} submitVariant={dialog === "return" ? "primary" : "danger"}
      onSubmit={async () => { if (!run || !(await command(dialog, dialog === "return" ? { version: run.version, note: text.trim() } : { version: run.version, reason: text.trim() }))) throw new FormNotSaved(); setDialog(null); }}>
      <TextAreaField label={dialog === "return" ? t("What to change") : t("Why it's cancelled")} isRequired value={text} onChange={setText} />
    </FormDialog> : null}
    {dialog === "paid" && state && run ? <FormDialog size="md" title={t("Mark paid")} onClose={() => setDialog(null)} cancelLabel={t("Back")}
      error={notice || undefined} isSubmitting={busy === "paid"} submitLabel={t("Mark paid")}
      isSubmitDisabled={!paidOn || state.payments.some((payment) => !references[payment.key]?.trim())}
      onSubmit={async () => {
        const done = await command("paid", { version: run.version, paidOn, references: state.payments.map((payment) => ({ vendorId: payment.vendorId, legalEntityId: payment.legalEntityId,
          currency: payment.currency, reference: references[payment.key].trim() })) });
        if (!done) throw new FormNotSaved();
        setDialog(null);
      }}>
        <DateField label={t("Paid on")} isRequired value={paidOn ? parseDate(paidOn) : null} onChange={(value) => setPaidOn(value ? value.toString() : null)} />
        <div className={styles.allocations}>{state.payments.map((payment) => <div key={payment.key} className={styles.allocation}>
          <span className={styles.nameCell}><span>{payment.supplierName}</span><small>{money(payment.amount, payment.currency)}</small></span>
          <TextInput label={<VisuallyHidden>{t("Reference for {supplier}", { supplier: payment.supplierName })}</VisuallyHidden>} isRequired maxLength={240} value={references[payment.key] ?? ""}
            onChange={(value) => setReferences({ ...references, [payment.key]: value })} />
        </div>)}</div>
    </FormDialog> : null}
  </InspectorSheet>;
}
