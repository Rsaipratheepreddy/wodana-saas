"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Badge, Button, DataGrid, DateField, FormDialog, FormRow, EmptyState, ErrorState, InlineNotice, SelectField, Skeleton, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { commercialPath, jsonRequest, paymentMethodLabel } from "@/lib/commercial/client";
import { translateKnown } from "@/lib/i18n/keys";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/commercial/types";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import { addExact } from "@/lib/purchasing/amounts";
import type { Milestone, Milestones, MilestoneState } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { EvidenceField } from "@/components/evidence/evidence-field";
import type { EvidenceFile } from "@/lib/evidence/evidence";
import styles from "./project-money.module.css";

/**
 * The client side of a project's money: each payment milestone of its sealed quotations with its invoice and
 * receipt, what's still due, and the next step on each — record the receipt (reported by the team or
 * Finance), then Finance verifies it. Both reuse the deal's own receipt commands, version-checked.
 */
export function ProjectClientMoney({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; switcher: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<Milestones | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState<Milestone | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.milestones(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Payments didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const labels: Record<MilestoneState, string> = { to_invoice: t("To invoice"), invoiced: t("Invoiced"), reported: t("Waiting for Finance"), verified: t("Received") };
  const tones: Record<MilestoneState, "neutral" | "info" | "warning" | "success"> = { to_invoice: "neutral", invoiced: "info", reported: "warning", verified: "success" };

  /** Runs a deal receipt command; a dialog passes `inDialog` to show a refusal itself instead of on the page. */
  const command = useCallback(async (action: string, input: Record<string, unknown>, inDialog = false) => {
    if (!state?.caseRevision) return false;
    setNotice("");
    try {
      await jsonRequest(commercialPath(workspaceId, `cases/${state.caseId}`), "POST", { action, revision: state.caseRevision, ...input });
      await load();
      return true;
    } catch (cause) {
      await load();
      if (inDialog) throw cause;
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      return false;
    }
  }, [load, state, t, workspaceId]);

  const columns = useMemo<DataGridColumn<Milestone>[]>(() => [
    { id: "milestone", header: t("Milestone"), accessorFn: (row) => row.title, size: 280, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.title}</span>{row.trigger ? <small>{row.trigger}</small> : null}</span> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueDate ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => {
      if (!row.dueDate) return <span className={styles.muted}>—</span>;
      const until = row.state === "verified" ? null : format.until(row.dueDate);
      return <span className={until?.late ? styles.over : undefined}>{format.day(row.dueDate)}</span>;
    } } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 140, meta: { renderCell: (row) => <span className={styles.number}>{format.money(row.amount, row.currency)}</span> } },
    { id: "invoice", header: t("Invoice"), accessorFn: (row) => row.invoice?.number ?? "", size: 150, meta: { mobileHidden: true, renderCell: (row) => row.invoice
      ? <Link href={`/workspace/finance/client-invoices?invoice=${row.invoice.id}`}>{row.invoice.number}</Link> : <span className={styles.muted}>{t("Not invoiced")}</span> } },
    { id: "state", header: t("Status"), accessorFn: (row) => row.state, size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span><Badge tone={tones[row.state]}>{labels[row.state]}</Badge></span>
      {row.receipt && row.state !== "verified" ? <small>{t("Reported by {name}", { name: row.receipt.reportedBy })}</small> : null}
      {row.state === "verified" && row.receipt?.verifiedBy ? <small>{t("Verified by {name}", { name: row.receipt.verifiedBy })}</small> : null}</span> } },
    { id: "next", header: "", accessorFn: () => "", size: 150, meta: { renderCell: (row) => row.state === "reported" && state?.canVerify
      ? <Button size="compact" variant="primary" onPress={() => void command("verify_payment", { paymentId: row.id })}>{t("Verify")}</Button>
      : (row.state === "to_invoice" || row.state === "invoiced") && state?.canReport ? <Button size="compact" onPress={() => setRecording(row)}>{t("Record receipt")}</Button> : null } },
  ], [t, format, labels, tones, state, command]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={5} shape="rows" />;
  const verified = state.milestones.filter((row) => row.state === "verified");
  // Exact decimal sums (never floats) of the milestones' amounts.
  const total = (rows: Milestone[]) => addExact(...rows.map((row) => row.amount));
  const due = state.milestones.filter((row) => row.state !== "verified");
  return <div className={styles.money}>
    <dl className={styles.facts}>
      <div><dt>{t("Received")}</dt><dd>{format.money(total(verified), state.currency)}<small>{t("{count} of {total} milestones", { count: verified.length, total: state.milestones.length })}</small></dd></div>
      <div><dt>{t("Still due")}</dt><dd>{format.money(total(due), state.currency)}<small>{t("{count} not invoiced", { count: state.milestones.filter((row) => row.state === "to_invoice").length })}</small></dd></div>
    </dl>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    <DataGrid<Milestone> ariaLabel={t("Payment milestones")} columns={columns} data={state.milestones} getRowId={(row) => row.id} rowNumbers={false} wrapText toolbarLeading={switcher}
      emptyContent={<EmptyState title={t("No payment milestones")} description={t("They come from the accepted quotation's payment terms.")} />} />
    {recording ? <ReceiptDialog workspaceId={workspaceId} milestone={recording} onClose={() => setRecording(null)}
      onSave={async (receipt) => { if (await command("report_payment_receipt", { paymentId: recording.id, ...receipt }, true)) setRecording(null); }} /> : null}
  </div>;
}

type ReceiptInput = { reference: string; evidence: string; evidenceFileIds: string[]; method: ManualPaymentMethod; receivedOn: string };

function ReceiptDialog({ workspaceId, milestone, onClose, onSave }: { workspaceId: string; milestone: Milestone; onClose: () => void; onSave: (receipt: ReceiptInput) => Promise<void> }) {
  const t = useT();
  const format = useProjectFormat();
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  // §0.3 P0: the proof of payment is a photo or PDF Finance sees when verifying it.
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [method, setMethod] = useState<ManualPaymentMethod>("bank");
  const [receivedOn, setReceivedOn] = useState(format.today());
  return <FormDialog size="md" title={t("Record receipt")} description={`${milestone.title} · ${format.money(milestone.amount, milestone.currency)}`} onClose={onClose}
    isDirty={Boolean(reference.trim() || evidence.trim() || files.length)} submitLabel={t("Save")} isSubmitDisabled={uploading || !files.length}
    onSubmit={() => onSave({ reference: reference.trim(), evidence: evidence.trim(), evidenceFileIds: files.map((file) => file.id), method, receivedOn })}>
    <FormRow>
      <SelectField isRequired label={t("Payment method")} selectedKey={method}
        items={MANUAL_PAYMENT_METHODS.map((id) => ({ id, label: translateKnown(t, paymentMethodLabel[id]) }))}
        onSelectionChange={(key) => setMethod(String(key ?? "bank") as ManualPaymentMethod)} />
      <DateField label={t("Received on")} isRequired maxValue={parseDate(format.today())} value={receivedOn ? parseDate(receivedOn) : null}
        onChange={(date) => setReceivedOn(date?.toString() ?? "")} />
    </FormRow>
    <TextInput label={t("Bank or cheque reference")} isRequired maxLength={240} value={reference} onChange={setReference} />
    <EvidenceField workspaceId={workspaceId} kind="receipt" isRequired label={t("Proof of payment")} value={files} onChange={setFiles} onBusy={setUploading} />
    <TextAreaField label={t("Note")} maxLength={3000} value={evidence} onChange={setEvidence} />
  </FormDialog>;
}
