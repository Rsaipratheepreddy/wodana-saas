"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, ControlledModalDialog, InlineNotice, TextAreaField, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { PortalError, staffPortalApi } from "@/lib/client-portal/client";
import type { StaffPaymentReport } from "@/lib/client-portal/types";
import { ClientFiles } from "@/components/client-activity/client-files";
import { useProjectFormat } from "@/components/project-core/format";
import styles from "./client-payment-reports.module.css";

type Status = StaffPaymentReport["status"];
type Reports = { reports: StaffPaymentReport[]; canDecide: boolean };
const valid = (next: Reports | null) => (Array.isArray(next?.reports) ? next : null);
const TONE: Record<Status, StatusTone> = { submitted: "warning", recorded: "success", not_received: "danger" };

export function useReportStatusLabel() {
  const t = useT();
  return (status: Status) => ({ submitted: t("Reported paid"), recorded: t("Recorded"), not_received: t("Not received") })[status];
}

/** The payments the client reported in the portal on a case ("I've paid", with proof), for finance to check. */
export function useClientPaymentReports(workspaceId: string, caseId: string, active = true) {
  const t = useT();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [data, setData] = useState<Reports | null>(null);
  const load = useCallback(async () => {
    try { const next = valid(await api.paymentReports(caseId)); if (next) setData(next); } catch { /* No reports to show: the milestones work without them. */ }
  }, [api, caseId]);
  useEffect(() => { if (active) queueMicrotask(() => void load()); }, [active, load]);
  /** Recorded (the receipt is in) or not received (with why, for the client); a clash reloads the reports. */
  const decide = useCallback(async (report: StaffPaymentReport, decision: "recorded" | "not_received", note: string) => {
    try { const next = valid(await api.decidePaymentReport(report.id, { decision, note, version: report.version })); if (next) setData(next); }
    catch (cause) {
      if (cause instanceof PortalError && cause.status === 409 && decision === "not_received") await load();
      throw cause;
    }
  }, [api, load]);
  const fileUrl = useCallback((assetId: string, preview = false) => api.clientFile(caseId, assetId, preview), [api, caseId]);
  return { reports: data?.reports ?? [], canDecide: Boolean(data?.canDecide), load, decide, fileUrl };
}

export type ClientPaymentReports = ReturnType<typeof useClientPaymentReports>;

/** A milestone's latest report in the payments table: its state and a way to open it. */
export function ClientReportCell({ reports, onOpen }: { reports: StaffPaymentReport[]; onOpen: () => void }) {
  const t = useT();
  const label = useReportStatusLabel();
  const latest = reports[0];
  if (!latest) return <span className={styles.none}>—</span>;
  return <span className={styles.cell}>
    <Badge tone={TONE[latest.status]}>{label(latest.status)}</Badge>
    <Button size="compact" variant="quiet" onPress={onOpen}>{t("Open")}</Button>
  </span>;
}

/**
 * The client's payment reports on one milestone, newest first: who, when they paid, how much, the reference,
 * their note and proof. Finance marks the open one recorded (once its receipt is recorded) or not received, with why.
 */
export function ClientReportDialog({ milestone, reports, currency, milestoneAmount, client, hasReceipt, canRecordReceipt, onRecordReceipt, onClose }: {
  milestone: string; reports: StaffPaymentReport[]; currency: string; milestoneAmount: number | null; client: ClientPaymentReports; hasReceipt: boolean; canRecordReceipt: boolean;
  onRecordReceipt: (report: StaffPaymentReport) => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const label = useReportStatusLabel();
  const [busy, setBusy] = useState<"recorded" | "not_received" | null>(null);
  const [error, setError] = useState("");
  const [declining, setDeclining] = useState(false);
  const open = client.canDecide ? reports.find((report) => report.status === "submitted") : undefined;
  const decide = async (report: StaffPaymentReport, decision: "recorded" | "not_received", note = "") => {
    setBusy(decision); setError("");
    try { await client.decide(report, decision, note); setDeclining(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(null);
  };
  return <>
    <ControlledModalDialog isOpen size="md" title={milestone} onOpenChange={(value) => { if (!value && !busy) onClose(); }}
      footer={open ? <div className="wd-dialog-actions">
        <Button isDisabled={Boolean(busy)} onPress={() => setDeclining(true)}>{t("Not received")}</Button>
        {!hasReceipt && canRecordReceipt ? <Button isDisabled={Boolean(busy)} onPress={() => onRecordReceipt(open)}>{t("Record receipt")}</Button> : null}
        <Button variant="primary" isDisabled={!hasReceipt || Boolean(busy)} isLoading={busy === "recorded"} onPress={() => void decide(open, "recorded")}>{t("Mark recorded")}</Button>
      </div> : undefined}>
      <div className={styles.body}>
        {error && !declining ? <InlineNotice tone="error" message={error} /> : null}
        {open && !hasReceipt ? <p className={styles.hint}>{t("Record the receipt first, then mark it recorded.")}</p> : null}
        <ol className={styles.reports} aria-label={t("Client payment reports")}>{reports.map((report) => <li key={report.id} className={styles.report} aria-label={t("Reported by {name}", { name: report.grantName })}>
          <div className={styles.head}>
            <strong>{report.grantName}</strong>
            <span className={styles.muted}>{format.when(report.at)}</span>
            <span className={styles.spacer} />
            <Badge tone={TONE[report.status]}>{label(report.status)}</Badge>
          </div>
          <dl className={styles.facts}>
            <div><dt>{t("Paid on")}</dt><dd>{format.day(report.paidOn)}</dd></div>
            <div><dt>{t("Amount")}</dt><dd>{format.money(report.amount ?? milestoneAmount, report.currency ?? currency)}</dd></div>
            <div><dt>{t("Reference")}</dt><dd>{report.reference || "—"}</dd></div>
            {report.note ? <div data-wide><dt>{t("Note")}</dt><dd>{report.note}</dd></div> : null}
          </dl>
          <ClientFiles files={report.files} url={client.fileUrl} />
          {report.status !== "submitted" && (report.decidedBy || report.reason) ? <p className={styles.muted}>
            {[report.decidedBy, report.decidedAt ? format.when(report.decidedAt) : null].filter(Boolean).join(" · ")}{report.reason ? `: ${report.reason}` : ""}
          </p> : null}
        </li>)}</ol>
      </div>
    </ControlledModalDialog>
    {declining && open ? <NotReceivedDialog busy={busy === "not_received"} error={error} onClose={() => { setDeclining(false); setError(""); }}
      onSave={(note) => void decide(open, "not_received", note)} /> : null}
  </>;
}

/** Not received: the client reads why (what couldn't be found in the bank). */
function NotReceivedDialog({ busy, error, onClose, onSave }: { busy: boolean; error: string; onClose: () => void; onSave: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <ControlledModalDialog isOpen size="md" title={t("Payment not received")} onOpenChange={(value) => { if (!value && !busy) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => onSave(note.trim())}>{t("Not received")}</Button></div>}>
    <div className={styles.body}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField autoFocus label={t("What couldn't be found")} isRequired maxLength={1000} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}
