"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, ControlledModalDialog, EmptyState, ErrorState, InlineNotice, RecordTable, SelectField, TextAreaField,
  type DataGridColumn,
} from "@/design-system";
import type { OperatorPermission } from "@/lib/internal/auth";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type SupportActivity, type SupportMembers, type SupportSession } from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

type Command = "approve" | "reject" | "start" | "revoke";
type Member = SupportMembers["members"][number];
type Event = SupportActivity["events"][number];

/**
 * Support sessions: requested → approved (by a second operator) → active (started by the requester, time-boxed)
 * → expired or revoked. Tenant records open only inside the operator's own active session.
 */
export function SupportTab({ orgKey, permissions, operatorUserId }: { orgKey: string; permissions: OperatorPermission[]; operatorUserId: string }) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [sessions, setSessions] = useState<SupportSession[] | null>(null);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const canRequest = permissions.includes("support.request");
  const load = useCallback(async () => {
    try { setSessions((await consoleApi.supportSessions(orgKey)).sessions); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Support sessions didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const mine = sessions?.find((session) => session.requestedBy === operatorUserId && session.status === "active") ?? null;
  useEffect(() => {
    if (!mine) return;
    const timer = window.setTimeout(() => void load(), Math.max(1_000, new Date(mine.expiresAt).getTime() - Date.now() + 500));
    return () => window.clearTimeout(timer);
  }, [load, mine]);

  const run = useCallback(async (session: SupportSession, command: Command) => {
    setBusy(`${session.id}:${command}`); setError("");
    try { await consoleApi.supportCommand(orgKey, session.id, command, { expectedVersion: session.version }); }
    catch (cause) { setError((cause as Error).message || t("The session could not be updated.")); }
    finally { setBusy(null); await load(); }
  }, [load, orgKey, t]);

  const columns = useMemo<DataGridColumn<SupportSession>[]>(() => [
    { id: "status", header: t("State"), size: 120, accessorFn: (row) => row.status, meta: { primary: true, renderCell: (row) =>
      <Badge tone={labels.support[row.status].tone}>{labels.support[row.status].label}</Badge> } },
    { id: "reason", header: t("Reason"), size: 280, accessorFn: (row) => row.reason },
    { id: "people", header: t("Requested by"), size: 190, accessorFn: (row) => row.requestedByName ?? "", meta: { renderCell: (row) =>
      <span className={styles.nameCell}><strong>{row.requestedByName}</strong>{row.approvedByName ? <small>{t("Approved by {name}", { name: row.approvedByName })}</small> : null}</span> } },
    { id: "time", header: t("Time"), size: 170, accessorFn: (row) => row.expiresAt, meta: { renderCell: (row) => row.status === "active"
      ? t("Ends {when}", { when: format.relative(row.expiresAt) })
      : row.status === "requested" || row.status === "approved"
        ? <span className={styles.nameCell}><strong>{t("{minutes} min", { minutes: row.durationMinutes })}</strong><small>{t("Start by {when}", { when: format.dateTime(row.expiresAt) })}</small></span>
        : format.dateTime(row.endedAt ?? row.expiresAt) } },
    { id: "actions", header: "", size: 210, accessorFn: () => "", meta: { renderCell: (row) => <span className={styles.inline}>
      {row.canStart ? <Button size="compact" variant="primary" isLoading={busy === `${row.id}:start`} onPress={() => void run(row, "start")}>{t("Start")}</Button> : null}
      {row.canApprove ? <Button size="compact" variant="primary" isLoading={busy === `${row.id}:approve`} onPress={() => void run(row, "approve")}>{t("Approve")}</Button> : null}
      {row.canReject ? <Button size="compact" isLoading={busy === `${row.id}:reject`} onPress={() => void run(row, "reject")}>{t("Reject")}</Button> : null}
      {row.canRevoke ? <Button size="compact" variant="quiet" isLoading={busy === `${row.id}:revoke`} onPress={() => void run(row, "revoke")}>{t("Revoke")}</Button> : null}
    </span> } },
  ], [busy, format, labels, run, t]);

  if (error && !sessions) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={styles.panel}>
    {canRequest ? <div className={styles.toolbar}><span /><div className={styles.toolbarActions}>
      <Button onPress={() => setRequesting(true)}>{t("Request access")}</Button></div></div> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <RecordTable<SupportSession> ariaLabel={t("Support sessions")} columns={columns} data={sessions ?? []} getRowId={(row) => row.id}
      isLoading={!sessions} emptyContent={<EmptyState illustration={null} title={t("No support sessions")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    {canRequest ? <TenantRecords orgKey={orgKey} session={mine} /> : null}
    {requesting ? <RequestDialog onClose={() => setRequesting(false)} onSave={async (reason, durationMinutes) => {
      await consoleApi.requestSupport(orgKey, { reason, durationMinutes }, crypto.randomUUID());
      setRequesting(false); await load();
    }} /> : null}
  </div>;
}

function TenantRecords({ orgKey, session }: { orgKey: string; session: SupportSession | null }) {
  const t = useT();
  const format = useConsoleFormat();
  const labels = useConsoleLabels();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!session) return;
    let live = true;
    Promise.all([consoleApi.supportMembers(orgKey), consoleApi.supportActivity(orgKey)])
      .then(([nextMembers, nextEvents]) => { if (live) { setMembers(nextMembers.members); setEvents(nextEvents.events); setError(""); } })
      .catch((cause: Error) => { if (live) setError(cause.message || t("Tenant records didn't load.")); });
    return () => { live = false; };
  }, [orgKey, session, t]);
  const memberColumns: DataGridColumn<Member>[] = [
    { id: "name", header: t("Member"), size: 240, accessorFn: (row) => row.displayName, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{row.displayName}</strong><small dir="ltr">{row.email}</small></span> } },
    { id: "roles", header: t("Roles"), size: 220, accessorFn: (row) => row.roles.join(", ") },
    { id: "status", header: t("Status"), size: 110, accessorFn: (row) => row.status, meta: { renderCell: (row) =>
      <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? t("Active") : row.status === "invited" ? t("Invited") : t("Suspended")}</Badge> } },
  ];
  const eventColumns: DataGridColumn<Event>[] = [
    { id: "action", header: t("Action"), size: 260, accessorFn: (row) => row.action, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{labels.action[row.action] ?? row.action}</strong><small>{row.entityType}</small></span> } },
    { id: "actor", header: t("By"), size: 180, accessorFn: (row) => row.actorName ?? "" },
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.occurredAt, meta: { renderCell: (row) => format.dateTime(row.occurredAt) } },
  ];
  if (!session) return <section className={styles.section} aria-label={t("Tenant records")}>
    <EmptyState illustration={null} title={t("Tenant records are closed")} description={t("They open during your approved, active session.")} />
  </section>;
  return <section className={styles.section} aria-label={t("Tenant records")}>
    <div className={styles.sectionHead}><h2 className={styles.subhead}>{t("Tenant records")}</h2>
      <Badge tone="success">{t("Open until {time}", { time: format.dateTime(session.expiresAt) })}</Badge></div>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <RecordTable<Member> ariaLabel={t("Members")} columns={memberColumns} data={members ?? []} getRowId={(row) => row.id} isLoading={!members && !error}
      emptyContent={<EmptyState illustration={null} title={t("No members")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    <RecordTable<Event> ariaLabel={t("Recent activity")} columns={eventColumns} data={events ?? []} getRowId={(row) => row.id} isLoading={!events && !error}
      emptyContent={<EmptyState illustration={null} title={t("No activity")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
  </section>;
}

const DURATIONS = [15, 30, 60, 120, 240, 480];

function RequestDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string, minutes: number) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ControlledModalDialog isOpen size="md" title={t("Request access")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={reason.trim().length < 10} onPress={async () => {
        setBusy(true); setError("");
        try { await onSave(reason.trim(), minutes); } catch (cause) { setError((cause as Error).message || t("Access could not be requested.")); }
        finally { setBusy(false); }
      }}>{t("Request")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={t("Length")} accent="neutral" isRequired selectedKey={String(minutes)}
        items={DURATIONS.map((value) => ({ id: String(value), label: value < 60 ? t("{minutes} min", { minutes: value }) : t("{hours} h", { hours: value / 60 }) }))}
        onSelectionChange={(value) => { if (value) setMinutes(Number(value)); }} />
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} description={t("At least 10 characters.")} />
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}
