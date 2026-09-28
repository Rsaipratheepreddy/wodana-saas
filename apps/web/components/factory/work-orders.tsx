"use client";

import { useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DataGrid, DateField, EmptyState, ErrorState, InlineNotice, ListTabs, NoResultsState, SelectField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { FactoryState, WorkOrderNext, WorkOrderRow, Workcenter } from "@/lib/factory/types";
import { Cell, ProjectFilterChip, ProjectLinks } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber, useFactoryLabels } from "./factory-labels";
import { WorkOrderSheet, type WorkOrderIntent } from "./work-order-sheet";
import styles from "./factory.module.css";

type View = "mine" | "blocked" | "making" | "send" | "open" | "all";
const OPEN = ["planned", "released", "in_production", "on_hold"];
// The row's next step, done in place (release, start) or by opening the work order into its dialog.
const INTENT: Partial<Record<Exclude<WorkOrderNext, null>, WorkOrderIntent>> = { report: "report", check: "check", send: "dispatch" };

/**
 * Work orders: what waits for me first, then what's blocked (and why), what's being made and what's ready
 * to send; each row with its project, where and when, how far it is, its state and its one next step.
 */
export function WorkOrders({ api, state, error, openId, intent = null, onReload, onOpen, onBatched, projectId = null, onProject = () => undefined }: {
  api: FactoryApi; state: FactoryState | null; error: string; openId: string | null; intent?: WorkOrderIntent; onReload: () => void;
  onOpen: (id: string | null, intent?: WorkOrderIntent) => void; onBatched: (batchId: string) => void; projectId?: string | null; onProject?: (projectId: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useFactoryLabels();
  const [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState<WorkOrderRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const today = state?.today ?? format.today();
  const needle = search.trim().toLocaleLowerCase();
  const scoped = (state?.orders ?? []).filter((row) => (!projectId || row.projectId === projectId)
    && (!needle || `${orderNumber(row.number)} ${row.title} ${row.projectReference} ${row.projectName} ${row.workcenterName ?? ""}`.toLocaleLowerCase().includes(needle)));
  const late = (row: WorkOrderRow) => Boolean(row.plannedEnd && row.plannedEnd < today && OPEN.includes(row.status));
  const queues: Record<View, (row: WorkOrderRow) => boolean> = {
    mine: (row) => Boolean(row.mine && row.next), blocked: (row) => row.next === "fix" || row.status === "on_hold",
    making: (row) => ["released", "in_production"].includes(row.status), send: (row) => row.next === "send", open: (row) => OPEN.includes(row.status), all: () => true,
  };
  const counts = Object.fromEntries((Object.keys(queues) as View[]).map((key) => [key, scoped.filter(queues[key]).length])) as Record<View, number>;
  // Start where there's something to do.
  const current: View = view ?? (counts.mine ? "mine" : "open");
  // Late first, then by when it's due.
  const rows = scoped.filter(queues[current]).sort((a, b) => Number(late(b)) - Number(late(a)) || (a.plannedEnd ?? "9999").localeCompare(b.plannedEnd ?? "9999") || a.number - b.number);

  /** Releases or starts work orders one at a time, saying which didn't go and why. */
  const runAll = async (orders: WorkOrderRow[], action: "release" | "start") => {
    setNotice(null);
    const failed: string[] = [];
    for (const order of orders) {
      setBusy(order.id);
      try { await api.command(order.id, action, { version: order.version }); } catch (cause) { failed.push(`${orderNumber(order.number)}: ${cause instanceof Error ? cause.message : t("Could not save.")}`); }
    }
    setBusy(null);
    onReload();
    const done = orders.length - failed.length;
    const said = action === "release" ? t("Released {count}.", { count: done }) : t("Started {count}.", { count: done });
    setNotice(failed.length ? { tone: "error", text: [done ? said : "", t("Not done: {orders}", { orders: failed.join("; ") })].filter(Boolean).join(" ") } : { tone: "success", text: said });
  };
  const act = (row: WorkOrderRow) => {
    if (row.next === "release" || row.next === "start") void runAll([row], row.next);
    else onOpen(row.id, row.next ? INTENT[row.next] ?? null : null);
  };

  const columns = useMemo<DataGridColumn<WorkOrderRow>[]>(() => [
    { id: "order", header: t("Work order"), accessorFn: (row) => row.number, size: 280, meta: { primary: true, renderCell: (row) =>
      <Cell title={row.title} meta={[orderNumber(row.number), row.packageName].filter(Boolean).join(" · ")} /> } },
    { id: "project", header: t("Project"), accessorFn: (row) => row.projectReference, size: 120, meta: { mobileHidden: true, renderCell: (row) =>
      <ProjectLinks projects={[{ id: row.projectId, reference: row.projectReference, name: row.projectName }]} /> } },
    { id: "where", header: t("Where and when"), accessorFn: (row) => row.plannedEnd ?? "", size: 210, meta: { mobileHidden: true, renderCell: (row) =>
      <Cell title={row.workcenterName ?? "—"} tone={late(row) ? "danger" : undefined}
        meta={[[format.short(row.plannedStart), format.short(row.plannedEnd)].filter(Boolean).join(" – "), late(row) ? t("Late") : "",
          row.batchName ? t("Batch {number}: {name}", { number: row.batchNumber ?? 0, name: row.batchName }) : ""].filter(Boolean).join(" · ") || null} /> } },
    { id: "progress", header: t("Ready"), accessorFn: (row) => Number(row.passed) / Number(row.quantity), size: 170, meta: { renderCell: (row) =>
      <Cell title={<span className={styles.number}>{t("{ready} of {quantity}", { ready: quantityText(row.passed) || "0", quantity: `${quantityText(row.quantity)} ${row.unit}`.trim() })}</span>}
        meta={[Number(row.pending) ? t("{quantity} to approve", { quantity: quantityText(row.pending) }) : "", Number(row.toCheck) ? t("{quantity} to check", { quantity: quantityText(row.toCheck) }) : "",
          Number(row.atFactory) > 0 && row.next === "send" ? t("{quantity} at the factory", { quantity: quantityText(row.atFactory ?? "0") }) : ""].filter(Boolean).join(" · ") || null} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => labels.status[row.status], size: 190, meta: { renderCell: (row) => {
      // Why it's where it is: what blocks release, why it's held, what changed.
      const why = OPEN.includes(row.status) && (row.lineStatus === "omitted" || Number(row.scopeOver) > 0) ? t("Scope changed")
        : row.blocked?.length ? row.blocked.map((check) => labels.blocked[check.key]).join(" · ")
        : row.status === "on_hold" ? (row.holdKind === "drawing" ? t("Drawing changed") : t("Put on hold"))
        : row.drawingNewer && OPEN.includes(row.status) ? t("Newer drawing R{number}", { number: row.drawingNewer })
        : Number(row.reworked) > 0 && row.status === "in_production" ? t("{quantity} to make again", { quantity: quantityText(row.reworked ?? "0") }) : null;
      return <Cell title={<WorkOrderStatusLabel status={row.status} />} meta={why} tone={why && (row.blocked?.length || row.lineStatus === "omitted" || Number(row.scopeOver) > 0) ? "danger" : why ? "warning" : undefined} />;
    } } },
    { id: "next", header: t("Next"), accessorFn: () => "", size: 150, meta: { align: "end", renderCell: (row) => {
      if (!row.next || !row.mine) return null;
      const label = row.next === "fix" ? t("Fix") : labels.next[row.next];
      return <Button size="compact" variant={row.next === "release" || row.next === "approve" || row.next === "check" ? "secondary" : "quiet"} isLoading={busy === row.id}
        aria-label={`${label} ${orderNumber(row.number)}`} onPress={() => act(row)}>{label}</Button>;
    } } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, format, labels, busy, today]);

  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const bulk = (chosen: WorkOrderRow[]) => {
    const releasable = chosen.filter((row) => row.next === "release" && state?.canManage);
    const batchable = chosen.filter((row) => ["planned", "released"].includes(row.status) && !row.batchId);
    return <>
      {releasable.length ? <Button size="compact" onPress={() => void runAll(releasable, "release")}>{t("Release ({count})", { count: releasable.length })}</Button> : null}
      {batchable.length ? <Button size="compact" onPress={() => setGrouping(batchable)}>{t("Run together ({count})", { count: batchable.length })}</Button> : null}
    </>;
  };
  const emptyTitle = { mine: t("Nothing waits for you"), blocked: t("Nothing is blocked"), making: t("Nothing is being made"), send: t("Nothing to send to site"),
    open: t("No open work orders"), all: t("No work orders yet") }[current];
  const project = projectId ? (state?.orders.find((row) => row.projectId === projectId) ?? state?.toMake.find((line) => line.projectId === projectId)) : null;
  return <div className={styles.stack}>
    {notice ? <InlineNotice tone={notice.tone} message={notice.text} /> : null}
    <DataGrid<WorkOrderRow> ariaLabel={t("Work orders")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search work orders")} rowNumbers={false} selectable={Boolean(state?.canManage)} wrapText
      selectionResetKey={`${current}:${projectId ?? ""}`} bulkActions={bulk}
      toolbarLeading={<div className={styles.filters}>
        <ListTabs label={t("Work orders")} value={current} onChange={setView} items={[
          { id: "mine", label: t("Needs me"), count: counts.mine },
          { id: "blocked", label: t("Blocked"), count: counts.blocked },
          { id: "making", label: t("In production"), count: counts.making },
          { id: "send", label: t("To send"), count: counts.send },
          { id: "open", label: t("Open"), count: counts.open },
          { id: "all", label: t("All") },
        ]} />
        <ProjectFilterChip project={projectId ? { id: projectId, reference: project?.projectReference ?? t("This project"), name: project?.projectName } : null} onClear={() => onProject(null)} />
      </div>}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={emptyTitle} description={current === "all" ? t("Plan one from a line in To make.") : null} />} />
    {openId ? <WorkOrderSheet key={openId} api={api} orderId={openId} intent={intent} onChanged={onReload} onClose={() => onOpen(null)} /> : null}
    {grouping && state ? <BatchDialog api={api} orders={grouping} workcenters={state.workcenters} onClose={() => setGrouping(null)} onSaved={(id) => { setGrouping(null); onBatched(id); }} /> : null}
  </div>;
}

/** Work orders from any projects run together: a name, where and when. */
function BatchDialog({ api, orders, workcenters, onClose, onSaved }: { api: FactoryApi; orders: WorkOrderRow[]; workcenters: Workcenter[]; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const shared = orders.every((order) => order.workcenterId === orders[0].workcenterId) ? orders[0].workcenterId : null;
  const [name, setName] = useState("");
  const [workcenterId, setWorkcenterId] = useState(shared ?? "");
  const [plannedOn, setPlannedOn] = useState<string | null>(orders.map((order) => order.plannedStart).filter((value): value is string => Boolean(value)).sort()[0] ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Run together")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={async () => {
        setBusy(true); setError("");
        try { await api.saveBatch({ id, name: name.trim(), workcenterId: workcenterId || null, plannedOn, orderIds: orders.map((order) => order.id) }); onSaved(id); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
      }}>{t("Create batch")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <p className={styles.muted}>{orders.map((order) => `${orderNumber(order.number)} · ${order.projectReference}`).join(", ")}</p>
      <TextInput label={t("Name")} isRequired value={name} onChange={setName} />
      <div className={styles.pair}>
        <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
          items={workcenters.map((center) => ({ id: center.id, label: center.name }))} />
        <DateField label={t("Day")} value={plannedOn ? parseDate(plannedOn) : null} onChange={(value) => setPlannedOn(value ? value.toString() : null)} />
      </div>
    </div>
  </ControlledModalDialog>;
}
