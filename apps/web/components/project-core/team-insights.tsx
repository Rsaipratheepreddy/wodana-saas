"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, ErrorState, GroupedTable, Kpi, Skeleton, type GroupedTableColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { WorkInsightRow, WorkInsights } from "@/lib/project-core/types";
import styles from "./work.module.css";

const percent = (row: Pick<WorkInsightRow, "onTime" | "doneWithDue">) => (row.doneWithDue ? Math.round((row.onTime / row.doneWithDue) * 100) : null);

/**
 * The team's work across projects: who has how much, what's late or blocked, and how work finished
 * over the last 30 or 90 days (on time, and the median days from start to done). A person opens their work.
 */
export function TeamInsights({ api, days, onPerson }: { api: ProjectApi; days: 30 | 90; onPerson: (membershipId: string | null, name: string) => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState<{ days: number; data: WorkInsights } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setLoaded({ days, data: await api.insights(days) }); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The team's work didn't load.")); }
  }, [api, days, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const data = loaded?.days === days ? loaded.data : null;
  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  const number = (value: number) => <span className={styles.count} data-zero={value === 0 || undefined}>{value}</span>;
  const columns: GroupedTableColumn<WorkInsightRow>[] = [
    { id: "person", label: t("Person"), width: "24%", render: (row) => row.name
      ? <span className={styles.person}><Avatar name={row.name} seed={row.name} size="sm" />{row.name}</span> : <span className={styles.muted}>{t("No one")}</span> },
    { id: "open", label: t("Open"), width: "9%", render: (row) => number(row.open) },
    { id: "late", label: t("Late"), width: "9%", render: (row) => <span className={styles.count} data-late={row.late > 0 || undefined} data-zero={row.late === 0 || undefined}>{row.late}</span> },
    { id: "week", label: t("Due in 7 days"), width: "12%", mobileHidden: true, render: (row) => number(row.dueThisWeek) },
    { id: "blocked", label: t("Blocked"), width: "10%", mobileHidden: true, render: (row) => number(row.blocked) },
    { id: "done", label: t("Done"), width: "9%", render: (row) => number(row.done) },
    { id: "onTime", label: t("On time"), width: "13%", mobileHidden: true, render: (row) => {
      const value = percent(row);
      return value === null ? <span className={styles.muted}>—</span> : <span title={t("{done} of {count} finished by their due date", { done: row.onTime, count: row.doneWithDue })}>{value}%</span>;
    } },
    { id: "cycle", label: t("Days to finish"), width: "14%", mobileHidden: true, render: (row) => row.cycleDays === null ? <span className={styles.muted}>—</span> : <span className={styles.count}>{row.cycleDays}</span> },
  ];

  return <div className={styles.team}>
    {!data ? <Skeleton lines={6} shape="rows" /> : <>
      {data.total ? <div className={styles.kpis}>
        <Kpi label={t("Open")} value={data.total.open} />
        <Kpi label={t("Late")} value={data.total.late} />
        <Kpi label={t("Blocked")} value={data.total.blocked} />
        <Kpi label={t("Finished on time")} formatter="percent" value={percent(data.total)} />
        <Kpi label={t("Median days to finish")} value={data.total.cycleDays} />
      </div> : null}
      <GroupedTable<WorkInsightRow> ariaLabel={t("Team")} columns={columns} selectable={false} getRowId={(row) => row.membershipId ?? "none"} getRowLabel={(row) => row.name ?? t("No one")}
        onRowAction={(row) => onPerson(row.membershipId, row.name ?? t("No one"))}
        sections={[{ id: "people", label: t("People"), rows: data.people, emptyMessage: t("No work yet") }]} />
    </>}
  </div>;
}
