"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button, EmptyState, ErrorState, RecordTable, Skeleton, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { readWithin } from "@/lib/workspace/read-within";
import { FinishesSchedule } from "./finishes-schedule";
import styles from "./finishes.module.css";

type Share = { caseId: string; number: number; sharedAt: string; sharedByName: string | null; note: string; clientName: string; projectId: string | null; project: string | null };

/**
 * PLM-156 in the Factory: the sample logs the lead designers shared with it (newest first), each opening the job's
 * finishes schedule read-only, with its samples, photos and the installation view.
 */
export function FactorySharedFinishes({ workspaceId, caseId, onOpen }: { workspaceId: string; caseId: string | null; onOpen: (caseId: string | null) => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await readWithin(fetch(`/api/factory/finishes?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" }));
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : t("The sample logs didn't load."));
      setShares((data as { shares: Share[] }).shares); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The sample logs didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (caseId) return <section className={styles.schedule} aria-label={t("Sample log")}>
    <div className={styles.toolbar}><Button size="compact" variant="quiet" onPress={() => onOpen(null)}><ChevronLeft aria-hidden="true" size={14} />{t("All sample logs")}</Button></div>
    <FinishesSchedule source={{ kind: "factory", workspaceId, caseId }} />
  </section>;
  if (error && !shares) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!shares) return <Skeleton lines={3} shape="rows" />;
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)); } catch { return iso; } };
  const columns: DataGridColumn<Share>[] = [
    { id: "job", header: t("Job"), accessorFn: (row) => row.project ?? row.clientName, meta: { primary: true }, cell: ({ row }: { row: { original: Share } }) => <span className={styles.cell}>
      <span>{row.original.project ?? row.original.clientName}</span>{row.original.project ? <small>{row.original.clientName}</small> : null}</span> },
    { id: "shared", header: t("Shared"), accessorFn: (row) => row.sharedAt, cell: ({ row }: { row: { original: Share } }) => <span className={styles.cell}>
      <span>{day(row.original.sharedAt)}</span>{row.original.sharedByName ? <small>{row.original.sharedByName}</small> : null}</span> },
    { id: "note", header: t("Note"), accessorFn: (row) => row.note, meta: { priority: "low" } },
  ];
  return <section className={styles.section} aria-label={t("Shared sample logs")}>
    <h3 className={styles.sectionTitle}>{t("Shared sample logs")}</h3>
    {shares.length ? <RecordTable ariaLabel={t("Shared sample logs")} data={shares} columns={columns} getRowId={(row) => row.caseId} showToolbar={false} selectable={false} rowNumbers={false} wrapText
      onRowAction={(row) => onOpen(row.caseId)} /> : <EmptyState illustration={null} title={t("No sample logs shared yet")} />}
  </section>;
}
