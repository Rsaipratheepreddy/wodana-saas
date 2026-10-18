"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { parseDate } from "@internationalized/date";
import {
  AmountList, Badge, Button, ConfirmationDialog, DataGrid, DateField, ErrorState, IconButton, InlineNotice, MoneyField, ReviewDialog, SelectField, Skeleton, TextInput,
  useDesignSystem, VisuallyHidden, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { manualJournalsApi, newId, type JournalDetail, type JournalOptions } from "@/lib/books/settings-client";
import { JOURNAL_STATUS_LABELS, PARTY_LABELS } from "../settings/ledger-labels";
import { fromUnits, lineTotals, moneyText, toUnits } from "./journal-amounts";
import styles from "./journals.module.css";

export const J = {
  account: tKey("Account"),
  description: tKey("Description"),
  debit: tKey("Debit"),
  credit: tKey("Credit"),
  project: tKey("Project"),
  party: tKey("Party"),
  none: tKey("None"),
  addLine: tKey("Add line"),
  removeLine: tKey("Remove line {number}"),
  lines: tKey("Journal lines"),
  date: tKey("Date"),
  memo: tKey("Memo"),
  total: tKey("Total"),
  balanced: tKey("Balanced"),
  offBy: tKey("Off by {amount}"),
  save: tKey("Save"),
  submit: tKey("Submit for approval"),
  approve: tKey("Approve"),
  sendBack: tKey("Send back"),
  sendBackTitle: tKey("Send {reference} back"),
  reason: tKey("What needs to change"),
  cancelJournal: tKey("Cancel journal"),
  cancelTitle: tKey("Cancel {reference}?"),
  cancelBody: tKey("It won't post. Its approval request is withdrawn."),
  keep: tKey("Keep"),
  loadFailed: tKey("The journal didn't load"),
  retry: tKey("Retry"),
  returned: tKey("Returned: {reason}"),
  postedAs: tKey("Posted as {number}"),
  notOn: tKey("The Ledger is not on for this company."),
  lockedUpTo: tKey("Locked up to {date}"),
} as const;

type LineDraft = { key: string; accountId: string; description: string; debit: string; credit: string; projectId: string | null; party: string | null };

const blankLine = (): LineDraft => ({ key: newId(), accountId: "", description: "", debit: "", credit: "", projectId: null, party: null });
const trimAmount = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

/**
 * The manual journal editor (plan §6.21b P15): a date, a memo and lines (account, description, debit or credit,
 * project and party), the debit and credit totals with a balance indicator, and Save bottom-end. A saved draft is
 * submitted for approval; a Ledger approver who didn't prepare it approves (it posts with its JV number) or sends it
 * back with the reason. Mounted by the Ledger's Journals tab (slice C).
 */
export function ManualJournalEditor({ workspaceId, legalEntityId, journalId = null, onDone }: {
  workspaceId: string; legalEntityId: string; journalId?: string | null; onDone?: (detail: JournalDetail) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => manualJournalsApi(workspaceId), [workspaceId]);
  const [id] = useState(() => journalId ?? newId());
  const [options, setOptions] = useState<JournalOptions | null>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [journalDate, setJournalDate] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine(), blankLine()]);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const adopt = useCallback((next: JournalDetail) => {
    setDetail(next);
    setJournalDate(next.journal.journalDate);
    setMemo(next.journal.memo);
    const drafts = next.lines.map((line): LineDraft => ({ key: line.id, accountId: line.accountId, description: line.description,
      debit: toUnits(line.debit) ? trimAmount(line.debit) : "", credit: toUnits(line.credit) ? trimAmount(line.credit) : "", projectId: line.projectId,
      party: line.partyType && line.partyId ? `${line.partyType}:${line.partyId}` : null }));
    setLines(drafts.length ? drafts : [blankLine(), blankLine()]);
    setSaved(JSON.stringify({ journalDate: next.journal.journalDate, memo: next.journal.memo, lines: drafts.map(({ key: _key, ...rest }) => rest) }));
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [nextOptions, nextDetail] = await Promise.all([api.options(legalEntityId), journalId ? api.detail(journalId) : Promise.resolve(null)]);
      setOptions(nextOptions);
      if (nextDetail) adopt(nextDetail);
    } catch (cause) { setLoadError(cause instanceof Error ? cause.message : t("Could not save.")); }
  }, [adopt, api, journalId, legalEntityId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const totals = lineTotals(lines);
  const currency = detail?.journal.currency ?? options?.company.currency ?? "";
  const decimals = options?.company.decimals ?? 2;
  const editable = !detail || detail.canEdit;
  const current = JSON.stringify({ journalDate, memo, lines: lines.map(({ key: _key, ...rest }) => rest) });
  const dirty = editable && current !== (saved || JSON.stringify({ journalDate: null, memo: "", lines: [blankLine(), blankLine()].map(({ key: _key, ...rest }) => rest) }));
  const show = (units: bigint) => moneyText(fromUnits(units), currency, locale, decimals);

  if (loadError && !options) return <ErrorState title={t(J.loadFailed)} description={loadError} onRetry={() => void load()} />;
  if (!options || (journalId && !detail)) return <Skeleton lines={6} shape="form" />;
  if (!options.settings?.enabled && !detail) return <InlineNotice tone="info" message={t(J.notOn)} />;

  const accounts = options.accounts.filter((account) => account.allowManual || lines.some((line) => line.accountId === account.id))
    .map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }));
  const projects = [{ id: "", label: t(J.none) }, ...options.projects.map((project) => ({ id: project.id, label: project.name }))];
  const parties = [{ id: "", label: t(J.none) }, ...options.parties.map((party) => ({ id: `${party.type}:${party.id}`, label: `${party.name} · ${t(PARTY_LABELS[party.type])}` }))];
  const update = (key: string, patch: Partial<LineDraft>) => setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const hidden = (text: string) => <VisuallyHidden>{text}</VisuallyHidden>;

  const columns: DataGridColumn<LineDraft>[] = [
    { id: "account", header: t(J.account), size: 240, accessorFn: (row) => row.accountId, meta: { renderCell: (row) =>
      <SelectField label={hidden(t(J.account))} isDisabled={!editable} placeholder={t(J.account)} selectedKey={row.accountId || null} items={accounts}
        onSelectionChange={(key) => update(row.key, { accountId: key ? String(key) : "" })} /> } },
    { id: "description", header: t(J.description), size: 200, accessorFn: (row) => row.description, meta: { renderCell: (row) =>
      <TextInput label={hidden(t(J.description))} isReadOnly={!editable} maxLength={500} value={row.description} onChange={(description) => update(row.key, { description })} /> } },
    { id: "debit", header: t(J.debit), size: 140, accessorFn: (row) => row.debit, meta: { align: "end", renderCell: (row) =>
      <MoneyField aria-label={t(J.debit)} label={hidden(t(J.debit))} currency={currency} isReadOnly={!editable} value={row.debit}
        onChange={(debit) => update(row.key, { debit, credit: debit ? "" : row.credit })} /> } },
    { id: "credit", header: t(J.credit), size: 140, accessorFn: (row) => row.credit, meta: { align: "end", renderCell: (row) =>
      <MoneyField aria-label={t(J.credit)} label={hidden(t(J.credit))} currency={currency} isReadOnly={!editable} value={row.credit}
        onChange={(credit) => update(row.key, { credit, debit: credit ? "" : row.debit })} /> } },
    { id: "project", header: t(J.project), size: 180, accessorFn: (row) => row.projectId ?? "", meta: { priority: "medium", renderCell: (row) =>
      <SelectField label={hidden(t(J.project))} accent="neutral" isDisabled={!editable} selectedKey={row.projectId ?? ""} items={projects}
        onSelectionChange={(key) => update(row.key, { projectId: key ? String(key) : null })} /> } },
    { id: "party", header: t(J.party), size: 180, accessorFn: (row) => row.party ?? "", meta: { priority: "medium", renderCell: (row) =>
      <SelectField label={hidden(t(J.party))} accent="neutral" isDisabled={!editable} selectedKey={row.party ?? ""} items={parties}
        onSelectionChange={(key) => update(row.key, { party: key ? String(key) : null })} /> } },
    ...(editable ? [{ id: "remove", header: "", size: 56, enableSorting: false, meta: { renderCell: (row: LineDraft) =>
      <IconButton aria-label={t(J.removeLine, { number: lines.indexOf(row) + 1 })} size="compact" variant="quiet" isDisabled={lines.length <= 2}
        onPress={() => setLines((rows) => rows.filter((item) => item.key !== row.key))}><Trash2 aria-hidden="true" size={14} /></IconButton> } }] : []),
  ];

  const run = async (work: () => Promise<JournalDetail>) => {
    setBusy(true); setError("");
    try {
      const next = await work();
      adopt(next);
      onDone?.(next);
      return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); return null; } finally { setBusy(false); }
  };
  const save = () => run(() => api.command(id, "save", {
    legalEntityId, journalDate, memo, version: detail?.journal.version ?? 0,
    lines: lines.filter((line) => line.accountId || toUnits(line.debit) || toUnits(line.credit)).map((line) => {
      const [type, partyId] = (line.party ?? "").split(":");
      return { accountId: line.accountId, description: line.description, debit: line.debit || null, credit: line.credit || null, projectId: line.projectId || null,
        party: partyId ? { type, id: partyId } : null };
    }),
  }));
  // An approver approves or sends it back from the review; a failure shows there and the review stays open.
  const decide = async (command: "approve" | "return", body: Record<string, unknown>) => {
    const next = await api.command(id, command, body);
    adopt(next); onDone?.(next); setReviewing(false);
  };
  const submit = async () => {
    const latest = dirty || !detail ? await save() : detail;
    if (latest) await run(() => api.command(id, "submit", { version: latest.journal.version }));
  };
  const status = detail?.journal.status;
  const lockDate = options.settings?.lockDate;

  return <div className={styles.editor}>
    {detail ? <div className={styles.reference}>
      <strong>{detail.journal.reference}</strong>
      <Badge tone={status === "approved" ? "success" : status === "returned" ? "warning" : status === "cancelled" ? "neutral" : "info"}>{t(JOURNAL_STATUS_LABELS[status!])}</Badge>
      {detail.journal.postedNumber ? <span className={styles.muted}>{t(J.postedAs, { number: detail.journal.postedNumber })}</span> : null}
    </div> : null}
    {detail?.journal.status === "returned" && detail.journal.returnedReason ? <InlineNotice tone="info" message={t(J.returned, { reason: detail.journal.returnedReason })} /> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className={styles.head}>
      <DateField label={t(J.date)} isRequired isDisabled={!editable} value={journalDate ? parseDate(journalDate) : null} onChange={(value) => setJournalDate(value ? value.toString() : null)}
        description={lockDate ? t(J.lockedUpTo, { date: lockDate }) : undefined} />
      <TextInput label={t(J.memo)} isReadOnly={!editable} maxLength={1000} value={memo} onChange={setMemo} />
    </div>
    <DataGrid ariaLabel={t(J.lines)} data={lines} getRowId={(row) => row.key} columns={columns} showToolbar={false} showFooter={false} selectable={false} rowNumbers={false}
      pinFirstColumn={false} />
    <div className={styles.foot}>
      {editable ? <Button size="compact" variant="quiet" onPress={() => setLines((rows) => [...rows, blankLine()])}><Plus aria-hidden="true" size={14} />{t(J.addLine)}</Button> : null}
      <span className={styles.spacer} />
      <AmountList label={t(J.total)} rows={[{ id: "debit", label: t(J.debit), amount: show(totals.debit) }, { id: "credit", label: t(J.credit), amount: show(totals.credit) }]} />
      <span role="status" data-state={totals.balanced ? "balanced" : totals.debit || totals.credit ? "off" : "empty"}>
        {totals.balanced ? <Badge tone="success">{t(J.balanced)}</Badge>
          : totals.debit || totals.credit ? <Badge tone="warning">{t(J.offBy, { amount: show(totals.difference < 0n ? -totals.difference : totals.difference) })}</Badge> : null}
      </span>
    </div>
    <div className={styles.actions}>
      {detail?.canCancel ? <Button variant="quiet" isDisabled={busy} onPress={() => setCancelling(true)}>{t(J.cancelJournal)}</Button> : null}
      <span className={styles.spacer} />
      {detail?.canApprove ? <Button variant="primary" isDisabled={busy} onPress={() => setReviewing(true)}>{t("Review")}</Button> : null}
      {editable ? <>
        <Button isDisabled={busy || !journalDate || (!dirty && Boolean(detail))} onPress={() => void save()}>{t(J.save)}</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!journalDate || !totals.balanced} onPress={() => void submit()}>{t(J.submit)}</Button>
      </> : null}
    </div>
    {reviewing && detail ? <ReviewDialog title={detail.journal.reference} description={detail.journal.memo || undefined} onClose={() => setReviewing(false)}
      facts={[{ label: t(J.debit), value: show(totals.debit) }, { label: t(J.credit), value: show(totals.credit) }]}
      confirmLabel={t(J.approve)} onConfirm={() => decide("approve", { version: detail.journal.version })}
      returnLabel={t(J.sendBack)} onReturn={(note) => decide("return", { version: detail.journal.version, note })} /> : null}
    {detail ? <ConfirmationDialog isOpen={cancelling} onOpenChange={setCancelling} isConfirming={busy} title={t(J.cancelTitle, { reference: detail.journal.reference })}
      body={t(J.cancelBody)} confirmLabel={t(J.cancelJournal)} cancelLabel={t(J.keep)}
      onConfirm={() => void run(() => api.command(id, "cancel", { version: detail.journal.version })).then(() => setCancelling(false))} /> : null}
  </div>;
}

