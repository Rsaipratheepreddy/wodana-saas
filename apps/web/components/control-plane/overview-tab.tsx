"use client";

import { parseDate } from "@internationalized/date";
import { Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Callout, ControlledModalDialog, DateField, InlineNotice, RecordTable, SelectField, TextAreaField,
  EmptyState, type DataGridColumn, FormDialog } from "@/design-system";
import type { OperatorPermission } from "@/lib/internal/auth";
import { useT } from "@/lib/i18n/i18n-provider";
import {
  consoleApi, type AccountOrganization, type LifecycleOverview, type LifecycleState, type TenantOperationsOverview,
} from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

type Operation = TenantOperationsOverview["operations"][number];
type HistoryRow = LifecycleOverview["history"][number];

/** Lifecycle: the state and why, the owner's invitation, exports (needed to archive) and every change. */
export function OverviewTab({ orgKey, organization, lifecycle, permissions, onChanged }: {
  orgKey: string; organization: AccountOrganization; lifecycle: LifecycleOverview | null;
  permissions: OperatorPermission[]; onChanged: () => void;
}) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const can = (permission: OperatorPermission) => permissions.includes(permission);
  const history = useMemo<DataGridColumn<HistoryRow>[]>(() => [
    { id: "state", header: t("State"), size: 130, accessorFn: (row) => row.state, meta: { primary: true, renderCell: (row) =>
      <Badge tone={labels.state[row.state].tone}>{labels.state[row.state].label}</Badge> } },
    { id: "reason", header: t("Reason"), size: 320, accessorFn: (row) => row.reason },
    { id: "by", header: t("By"), size: 160, accessorFn: (row) => row.createdByName ?? "", meta: { renderCell: (row) =>
      row.automated ? <span className={styles.muted}>{t("Automatic")}</span> : row.createdByName ?? "" } },
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
    { id: "notice", header: t("Notice"), size: 150, accessorFn: (row) => row.noticeDeliveryState, meta: { renderCell: (row) =>
      <Badge tone={labels.delivery[row.noticeDeliveryState].tone}>{labels.delivery[row.noticeDeliveryState].label}</Badge> } },
  ], [format, labels, t]);

  return <div className={styles.panel}>
    {lifecycle?.state === "suspended" ? <Callout tone="danger" title={t("Read-only")}>{t("Changes are blocked. Reads and exports still work.")}</Callout> : null}
    {lifecycle?.state === "grace" && lifecycle.graceEndsAt
      ? <Callout tone="warning" title={t("In grace")}>{t("Suspends automatically on {date}.", { date: format.date(lifecycle.graceEndsAt) })}</Callout> : null}
    <OwnerInvitation orgKey={orgKey} organization={organization} canSend={can("invitations.send")} onChanged={onChanged} />
    <Exports orgKey={orgKey} canManage={can("data.manage")} lifecycle={lifecycle} onChanged={onChanged} />
    <section className={styles.section} aria-label={t("History")}>
      <h2 className={styles.subhead}>{t("History")}</h2>
      <RecordTable<HistoryRow> ariaLabel={t("History")} columns={history} data={lifecycle?.history ?? []} getRowId={(row) => row.id}
        isLoading={!lifecycle} emptyContent={<EmptyState illustration={null} title={t("No changes yet")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    </section>
  </div>;
}

function OwnerInvitation({ orgKey, organization, canSend, onChanged }: {
  orgKey: string; organization: AccountOrganization; canSend: boolean; onChanged: () => void;
}) {
  const t = useT();
  const labels = useConsoleLabels();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const status = labels.invitation(organization.owner.invitationStatus, organization.owner.deliveryStatus);
  const accepted = organization.owner.invitationStatus === "accepted";
  // Once the owner accepted, the header says so; this section is only for getting the owner in.
  if (!organization.externalTenantId || accepted) return null;
  const send = async () => {
    setBusy(true); setError(""); setLink(""); setSent(false);
    try {
      const sent = await consoleApi.sendOwnerInvitation(orgKey, key);
      if (sent.deliveryStatus !== "sent" && sent.invitationToken) {
        setLink(`${window.location.origin}/login?tenant=${encodeURIComponent(organization.slug)}&invitation=${encodeURIComponent(sent.invitationToken)}`);
      }
      if (sent.deliveryStatus !== "sent") setKey(crypto.randomUUID());
      setSent(sent.deliveryStatus === "sent");
      onChanged();
    } catch (cause) { setError((cause as Error).message || t("The link could not be sent.")); }
    finally { setBusy(false); }
  };
  return <section className={styles.section} aria-label={t("Owner invitation")}>
    <div className={styles.sectionHead}>
      <h2 className={styles.subhead}>{t("Owner invitation")}</h2>
      {canSend ? <Button size="compact" isLoading={busy} onPress={() => void send()}>{t("Send new link")}</Button> : null}
    </div>
    <p className={styles.inline}>{organization.owner.email}<Badge tone={status.tone}>{status.label}</Badge></p>
    {link ? <div className={styles.link}>
      <InlineNotice tone="info" message={t("Email isn't delivered. Share this one-time link with the owner only.")} />
      <code>{link}</code>
      <div><Button size="compact" onPress={() => void navigator.clipboard.writeText(link)}><Copy aria-hidden="true" size={14} />{t("Copy link")}</Button></div>
    </div> : null}
    {sent ? <InlineNotice tone="success" message={t("Link sent")} /> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </section>;
}

function Exports({ orgKey, canManage, lifecycle, onChanged }: { orgKey: string; canManage: boolean; lifecycle: LifecycleOverview | null; onChanged: () => void }) {
  const t = useT();
  const format = useConsoleFormat();
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const load = useCallback(async () => {
    try { setOperations((await consoleApi.operations(orgKey)).operations.filter((operation) => operation.operationType === "export")); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Exports didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const approve = async (operation: Operation) => {
    try {
      await consoleApi.decideOperation(orgKey, operation.id, { expectedVersion: operation.version, decision: "approve",
        reason: t("Export approved by a second operator") });
      await load(); onChanged();
    } catch (cause) { setError((cause as Error).message || t("The export could not be approved.")); }
  };
  const statusLabel: Record<string, string> = { planned: t("Waiting for approval"), blocked: t("Blocked"), running: t("Running"),
    succeeded: t("Ready"), failed: t("Failed"), cancelled: t("Cancelled"), queued: t("Queued") };
  const columns: DataGridColumn<Operation>[] = [
    { id: "status", header: t("Export"), size: 180, accessorFn: (row) => row.status, meta: { primary: true, renderCell: (row) =>
      <Badge tone={row.status === "succeeded" ? "success" : row.status === "failed" || row.status === "blocked" ? "danger" : "info"}>{statusLabel[row.status] ?? row.status}</Badge> } },
    { id: "reason", header: t("Reason"), size: 280, accessorFn: (row) => row.reason },
    { id: "when", header: t("Requested"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
    { id: "action", header: "", size: 150, accessorFn: () => "", meta: { renderCell: (row) => row.status === "succeeded" && row.result?.exportId
      ? <a href={consoleApi.exportUrl(orgKey, row.result.exportId)}>{t("Download")}</a>
      : canManage && row.canApprove ? <Button size="compact" onPress={() => void approve(row)}>{t("Approve")}</Button> : null } },
  ];
  return <section className={styles.section} aria-label={t("Exports")}>
    <div className={styles.sectionHead}>
      <h2 className={styles.subhead}>{t("Exports")}</h2>
      {lifecycle?.readiness.exportReady ? <Badge tone="success">{t("Ready to archive")}</Badge> : null}
      {canManage ? <Button size="compact" onPress={() => setRequesting(true)}>{t("Request export")}</Button> : null}
    </div>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <RecordTable<Operation> ariaLabel={t("Exports")} columns={columns} data={operations ?? []} getRowId={(row) => row.id} isLoading={!operations && !error}
      emptyContent={<EmptyState illustration={null} title={t("No exports yet")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    {requesting ? <ReasonDialog title={t("Request export")} action={t("Request")} onClose={() => setRequesting(false)}
      onSave={async (reason) => { await consoleApi.planExport(orgKey, reason, crypto.randomUUID()); setRequesting(false); await load(); }} /> : null}
  </section>;
}

/** A command that needs only a reason (10 characters or more). Save is bottom-end. */
export function ReasonDialog({ title, action, onClose, onSave }: { title: string; action: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = reason.trim().length >= 10;
  return <FormDialog size="md" title={title} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={action} onSubmit={async () => { setError("");
        try { await onSave(reason.trim()); } catch (cause) { setError((cause as Error).message || t("The change could not be saved.")); }
        finally { }
      }}>
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} description={t("At least 10 characters.")} />
  </FormDialog>;
}

/** Changes the organization's state with a reason; grace needs its end date and archive needs a current export. */
export function TransitionDialog({ orgKey, lifecycle, onClose, onDone }: { orgKey: string; lifecycle: LifecycleOverview; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const labels = useConsoleLabels();
  const [to, setTo] = useState<LifecycleState>(lifecycle.nextStates[0]);
  const [reason, setReason] = useState("");
  const [graceEnds, setGraceEnds] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const blockers = to === "archived" ? [
    ...(!lifecycle.readiness.retentionPolicySet ? [t("Set a retention policy")] : []),
    ...(!lifecycle.readiness.exportReady ? [t("Download a current export")] : []),
    ...(lifecycle.readiness.legalHold ? [t("Release the legal hold")] : []),
  ] : [];
  const graceIso = graceEnds ? new Date(`${graceEnds}T23:59:00`).toISOString() : null;
  const valid = reason.trim().length >= 10 && !blockers.length && (to !== "grace" || (graceIso !== null && new Date(graceIso) > new Date()));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await consoleApi.transition(orgKey, { expectedVersion: lifecycle.version, to, reason: reason.trim(),
        ...(to === "grace" && graceIso ? { graceEndsAt: graceIso } : {}) }, key);
      onDone();
    } catch (cause) { setError((cause as Error).message || t("The state could not be changed.")); }
    finally { setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Change state")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant={to === "suspended" || to === "archived" ? "danger" : "primary"} isLoading={busy} isDisabled={!valid} onPress={() => void save()}>
        {to === "suspended" ? t("Suspend") : to === "archived" ? t("Archive") : t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={t("New state")} accent="neutral" isRequired selectedKey={to}
        items={lifecycle.nextStates.map((state) => ({ id: state, label: labels.state[state].label }))}
        onSelectionChange={(value) => { if (value) setTo(value as LifecycleState); }} />
      {to === "grace" ? <DateField label={t("Grace ends")} isRequired value={graceEnds ? parseDate(graceEnds) : null}
        onChange={(value) => setGraceEnds(value ? value.toString() : null)} /> : null}
      {blockers.length ? <Callout tone="warning" title={t("Before archiving")}><ul className={styles.muted}>{blockers.map((item) => <li key={item}>{item}</li>)}</ul></Callout> : null}
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} description={t("At least 10 characters.")} />
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}
