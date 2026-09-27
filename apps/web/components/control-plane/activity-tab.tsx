"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, ErrorState, RecordTable, EmptyState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type ActivityEvent, type ControlNotice } from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

/** Every operator action on the account (who, what, when, why) and every notice it sent, with its delivery. */
export function ActivityTab({ accountId, notices }: { accountId: string; notices: ControlNotice[] }) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setEvents((await consoleApi.activity(accountId)).events); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Activity didn't load.")); }
  }, [accountId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const eventColumns = useMemo<DataGridColumn<ActivityEvent>[]>(() => [
    { id: "action", header: t("Action"), size: 260, accessorFn: (row) => labels.action[row.action] ?? row.action, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{labels.action[row.action] ?? row.action}</strong>{row.reason ? <small>{row.reason}</small> : null}</span> } },
    { id: "organization", header: t("Organization"), size: 180, accessorFn: (row) => row.organizationName ?? "" },
    { id: "by", header: t("By"), size: 180, accessorFn: (row) => row.actorName ?? "", meta: { renderCell: (row) =>
      row.actorName ?? <span className={styles.muted}>{t("Automatic")}</span> } },
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
  ], [format, labels, t]);
  const noticeColumns = useMemo<DataGridColumn<ControlNotice>[]>(() => [
    { id: "event", header: t("Notice"), size: 240, accessorFn: (row) => labels.event[row.eventType] ?? row.eventType, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{labels.event[row.eventType] ?? row.eventType}</strong><small>{row.subject}</small></span> } },
    { id: "to", header: t("To"), size: 220, accessorFn: (row) => row.recipient, meta: { renderCell: (row) =>
      <span className={styles.nameCell}><strong dir="ltr">{row.recipient}</strong>
        <small>{row.audience === "operator" ? t("Operator") : t("Owner")} · {row.channel === "email" ? t("Email") : t("In app")}</small></span> } },
    { id: "status", header: t("Delivery"), size: 130, accessorFn: (row) => row.status, meta: { renderCell: (row) =>
      <Badge tone={labels.notice[row.status].tone}>{labels.notice[row.status].label}</Badge> } },
    { id: "when", header: t("When"), size: 150, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.dateTime(row.createdAt) } },
  ], [format, labels, t]);

  if (error && !events) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={styles.panel}>
    <RecordTable<ActivityEvent> ariaLabel={t("Actions")} columns={eventColumns} data={events ?? []} getRowId={(row) => row.id} isLoading={!events}
      emptyContent={<EmptyState illustration={null} title={t("No activity yet")} />} rowNumbers={false} selectable={false} showToolbar={false} wrapText />
    <section className={styles.section} aria-label={t("Notices")}>
      <h2 className={styles.subhead}>{t("Notices")}</h2>
      <RecordTable<ControlNotice> ariaLabel={t("Notices")} columns={noticeColumns} data={notices} getRowId={(row) => row.id}
        emptyContent={<EmptyState illustration={null} title={t("No notices yet")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    </section>
  </div>;
}
