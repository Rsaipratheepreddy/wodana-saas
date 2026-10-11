"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, RecordTable, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import {
  CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, NEXT_STEP_LABEL, REASON_LABEL, projectChangesApi, signedMoney,
  type ProjectChangeRow, type ProjectChangesView,
} from "@/lib/change-requests/project";
import { useProjectFormat } from "../project-core/format";
import { RaiseChangeDialog } from "./raise-change-dialog";
import styles from "./project-changes.module.css";

type Legacy = { id: string; number: number; title: string; status: string; total: string; appliedAs: string | null };
type Row = (ProjectChangeRow & { legacy?: false }) | (Legacy & { legacy: true });

/**
 * The project's changes (Scope › Changes, plan §6.10 "Scope: the live BOQ, material list, changes and sealed
 * documents"): each change with its status, what it adds or takes off the price, the days it moves the plan and the
 * next step; the sealed value and the approved variations beside it. "Raise a change" is the one primary action.
 */
export function ProjectChanges({ workspaceId, projectId, onChanged }: { workspaceId: string; projectId: string; onChanged?: () => void }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const api = useMemo(() => projectChangesApi(workspaceId, projectId), [workspaceId, projectId]);
  const [view, setView] = useState<(ProjectChangesView & { legacy?: Legacy[] }) | null>(null);
  const [error, setError] = useState("");
  const [raising, setRaising] = useState(false);
  const load = useCallback(async () => {
    try { setView(await api.list()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The changes didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (error && !view) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!view) return <Skeleton lines={4} shape="rows" />;
  const currency = view.money.currency ?? view.changes[0]?.currency ?? "";
  const open = (row: Row) => router.push(`/workspace/projects/${projectId}/changes/${row.id}`);
  const rows: Row[] = [...view.changes, ...(view.legacy ?? []).map((item) => ({ ...item, legacy: true as const }))];
  const raise = view.canRaise && view.projectOpen ? <Button size="compact" variant="primary" onPress={() => setRaising(true)}><Plus aria-hidden="true" size={14} />{t("Raise a change")}</Button> : undefined;
  const columns: DataGridColumn<Row>[] = [
    { id: "change", header: t("Change"), accessorFn: (row) => `${row.legacy ? `V${row.number}` : row.reference} ${row.title}`, meta: { primary: true },
      cell: ({ row: { original } }: { row: { original: Row } }) => <span className={styles.cell}>
        <span>{original.legacy ? original.appliedAs ?? t("V{number}", { number: original.number }) : original.reference} · {original.title}</span>
        {original.legacy ? null : <small>{[t(REASON_LABEL[original.reason]), original.raisedByName].filter(Boolean).join(" · ")}</small>}
      </span> },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, cell: ({ row: { original } }: { row: { original: Row } }) => original.legacy
      ? <Badge tone={original.appliedAs ? "success" : "neutral"}>{original.appliedAs ? t("Applied") : t("In the builder")}</Badge>
      : <Badge tone={CHANGE_STATUS_TONE[original.status]}>{t(CHANGE_STATUS_LABEL[original.status])}</Badge> },
    { id: "value", header: t("Value"), accessorFn: (row) => (row.legacy ? row.total : row.value ?? ""), meta: { align: "end" },
      cell: ({ row: { original } }: { row: { original: Row } }) => {
        const value = original.legacy ? original.total : original.value;
        return value === null ? <span className={styles.muted}>{t("Not priced")}</span> : <bdi className={styles.number} dir="ltr">{signedMoney(value, format.money, currency)}</bdi>;
      } },
    { id: "days", header: t("Days"), accessorFn: (row) => (row.legacy ? 0 : row.days), meta: { align: "end" },
      cell: ({ row: { original } }: { row: { original: Row } }) => !original.legacy && original.days
        ? <span className={styles.cell}><span className={styles.number}>{t("+{count} days", { count: original.days })}</span>
          {original.handoverAfter && original.handoverAfter !== original.handoverBefore ? <small>{t("Handover {date}", { date: format.short(original.handoverAfter) })}</small> : null}</span>
        : <span className={styles.muted}>—</span> },
    { id: "next", header: t("Next step"), accessorFn: (row) => (row.legacy ? "" : row.next ?? ""), meta: { priority: "low" },
      cell: ({ row: { original } }: { row: { original: Row } }) => original.legacy ? null
        : original.applyProblem ? <span className={styles.muted}>{t("Apply")}</span>
        : original.next ? <span>{t(NEXT_STEP_LABEL[original.next])}</span> : null },
  ];
  return <section className={styles.list} aria-label={t("Changes")}>
    <div className={styles.toolbar}>
      {view.money.sealed ? <p className={styles.money}>
        <span>{t("Sealed {label}", { label: view.money.sealed.label })} <strong>{format.money(view.money.sealed.total, currency)}</strong></span>
        <span>{t("Variations")} <strong><bdi dir="ltr">{signedMoney(view.money.variationsTotal, format.money, currency)}</bdi></strong></span>
        <span>{t("Agreed value")} <strong>{format.money(view.money.agreed, currency)}</strong></span>
      </p> : <span />}
      {rows.length ? raise : null}
    </div>
    {rows.length ? <RecordTable ariaLabel={t("Changes")} data={rows} columns={columns} getRowId={(row) => row.id} showToolbar={false} selectable={false} rowNumbers={false} wrapText
      onRowAction={open} />
      : <EmptyState illustration={null} title={t("No changes yet")} description={t("A change after the scope is sealed is priced, approved and applied here.")} action={raise} />}
    {raising ? <RaiseChangeDialog api={api} onClose={() => setRaising(false)} onSaved={(record) => { setRaising(false); onChanged?.(); router.push(`/workspace/projects/${projectId}/changes/${record.change.id}`); }} /> : null}
  </section>;
}
