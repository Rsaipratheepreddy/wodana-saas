"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, InlineNotice, ListTabs, NoAccessState, NoResultsState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { OrderRow, OrdersState } from "@/lib/purchasing/types";
import { Cell, DueText, ProjectFilterChip, ProjectLinks } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { OPEN_ORDERS, OrderStatusLabel, useOrderLabels } from "./order-labels";
import { OrderSheet, type OrderIntent } from "./order-sheet";
import styles from "./purchasing.module.css";

type View = "mine" | "approval" | "send" | "confirm" | "late" | "all";
type Step = { key: "place" | "approve" | "send" | "confirm" | "chase" | "receive" | "close"; mine: boolean };
const RECEIVABLE = ["sent", "confirmed", "partly_received"];

/** Late: something still to come was due before today. */
export const isLate = (row: OrderRow, today: string) => RECEIVABLE.includes(row.status) && (row.linesLeft ?? 1) > 0 && Boolean(row.due && row.due < today);

/** An order's one next step and whether it's the viewer's to take (nobody approves an order they raised). */
export function orderNext(row: OrderRow, rights: { canBuy: boolean; canApprove: boolean; canReceive: boolean; me?: string }, today: string): Step | null {
  switch (row.status) {
    case "draft": return { key: "place", mine: rights.canBuy };
    case "pending_approval": return { key: "approve", mine: rights.canApprove && row.createdBy !== rights.me && row.submittedBy !== rights.me };
    case "approved": return { key: "send", mine: rights.canBuy };
    case "sent": return isLate(row, today) ? { key: "chase", mine: rights.canBuy } : { key: "confirm", mine: rights.canBuy };
    case "confirmed": case "partly_received": return isLate(row, today) && rights.canBuy ? { key: "chase", mine: true } : { key: "receive", mine: rights.canReceive };
    case "received": return { key: "close", mine: rights.canBuy };
    default: return null;
  }
}

/**
 * Purchase orders, as queues: what needs me, waiting for approval, to send, to confirm and late, then all orders
 * (open ones unless the Status filter is cleared). Each row says where the order is, what's still to come and when, and its one next step; approving
 * and marking sent work on several at once. A row opens the order.
 */
export function Orders({ api, openId, intent = null, onOpen, onReceipt, refreshKey, projectId = null, onProject = () => undefined }: {
  api: PurchasingApi; openId: string | null; intent?: OrderIntent | null; onOpen: (id: string | null, intent?: OrderIntent) => void; onReceipt: (receiptId: string) => void; refreshKey: number;
  projectId?: string | null; onProject?: (projectId: string | null) => void;
}) {
  const t = useT();
  const labels = useOrderLabels();
  const format = useProjectFormat();
  const [state, setState] = useState<OrdersState | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View | null>(null);
  // All shows the open orders until the Status filter is cleared.
  const [openOnly, setOpenOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.orders()); setError(""); } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("The orders didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const today = format.today();
  const rights = { canBuy: Boolean(state?.canBuy), canApprove: Boolean(state?.canApprove), canReceive: Boolean(state?.canReceive ?? state?.canBuy), me: state?.me };
  const needle = search.trim().toLocaleLowerCase();
  const scoped = useMemo(() => (state?.orders ?? []).filter((order) => (!projectId || order.projects.some((project) => project.id === projectId))
    && (!needle || `${order.number} ${order.supplierName} ${order.projects.map((project) => project.reference).join(" ")}`.toLocaleLowerCase().includes(needle))), [state, projectId, needle]);
  const queues: Record<View, (row: OrderRow) => boolean> = {
    mine: (row) => Boolean(orderNext(row, rights, today)?.mine), approval: (row) => row.status === "pending_approval", send: (row) => row.status === "approved",
    confirm: (row) => row.status === "sent" && !isLate(row, today), late: (row) => isLate(row, today), all: (row) => !openOnly || OPEN_ORDERS.includes(row.status),
  };
  const counts = Object.fromEntries((Object.keys(queues) as View[]).map((key) => [key, scoped.filter(queues[key]).length])) as Record<View, number>;
  // Start where there's something to do.
  const current: View = view ?? (counts.mine ? "mine" : "all");
  // Late first, then by when it's due, then the newest.
  const rows = scoped.filter(queues[current]).sort((a, b) => Number(isLate(b, today)) - Number(isLate(a, today)) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.createdAt.localeCompare(a.createdAt));

  const approve = async (orders: OrderRow[]) => {
    setNotice(null);
    const failed: string[] = [];
    for (const order of orders) {
      setBusy(order.id);
      try { await api.orderCommand(order.id, order.version, "approve"); } catch (cause) { failed.push(`${order.number}: ${cause instanceof Error ? cause.message : t("Could not save.")}`); }
    }
    setBusy(null);
    await load();
    const done = orders.length - failed.length;
    setNotice(failed.length ? { tone: "error", text: [done ? t("Approved {count}.", { count: done }) : "", t("Not approved: {orders}", { orders: failed.join("; ") })].filter(Boolean).join(" ") }
      : { tone: "success", text: t("Approved {count}.", { count: done }) });
  };
  const markSent = async (orders: OrderRow[]) => {
    setNotice(null);
    const failed: string[] = [];
    for (const order of orders) {
      setBusy(order.id);
      try { await api.orderCommand(order.id, order.version, "send", { to: null }); } catch (cause) { failed.push(`${order.number}: ${cause instanceof Error ? cause.message : t("Could not save.")}`); }
    }
    setBusy(null);
    await load();
    const done = orders.length - failed.length;
    setNotice(failed.length ? { tone: "error", text: [done ? t("Marked {count} as sent.", { count: done }) : "", t("Not sent: {orders}", { orders: failed.join("; ") })].filter(Boolean).join(" ") }
      : { tone: "success", text: t("Marked {count} as sent.", { count: done }) });
  };
  const stepLabel: Record<Step["key"], string> = {
    place: t("Place"), approve: t("Approve"), send: t("Send"), confirm: t("Confirm"), chase: t("Chase"), receive: t("Receive"), close: t("Close"),
  };
  const act = (row: OrderRow, step: Step) => {
    if (step.key === "approve") void approve([row]);
    else onOpen(row.id, step.key === "place" ? undefined : step.key);
  };

  const columns = useMemo<DataGridColumn<OrderRow>[]>(() => [
    { id: "number", header: t("Order"), accessorFn: (row) => `${row.number} ${row.supplierName}`, size: 240, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell} data-tour="order-row" data-tour-safe>
      <span>{row.number}{row.revision ? ` · ${t("change {number}", { number: row.revision })}` : ""}</span><small>{row.supplierName}</small></span> } },
    { id: "projects", header: t("For"), accessorFn: (row) => row.projects.map((project) => project.reference).join(", "), size: 130, meta: { mobileHidden: true,
      renderCell: (row) => <ProjectLinks projects={row.projects} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => labels.status[row.status], size: 200, meta: { renderCell: (row) => {
      const detail = row.inspecting ? t("Delivery to inspect")
        : row.shipment && RECEIVABLE.includes(row.status) ? [labels.shipment[row.shipment.status], row.shipment.eta ? t("expected {date}", { date: format.short(row.shipment.eta) }) : ""].filter(Boolean).join(" · ")
        : RECEIVABLE.includes(row.status) && row.linesLeft ? (row.linesLeft === 1 ? t("1 line to come") : t("{count} lines to come", { count: row.linesLeft })) : null;
      return <Cell title={<OrderStatusLabel status={row.status} />} meta={detail} tone={row.shipment?.status === "delayed" ? "danger" : undefined} />;
    } } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.due ?? row.promisedDate ?? row.expectedDate ?? "", size: 130, meta: { renderCell: (row) =>
      <DueText date={row.due ?? row.promisedDate ?? row.expectedDate} done={!RECEIVABLE.includes(row.status) && row.status !== "approved"} /> } },
    { id: "total", header: t("Total"), accessorFn: (row) => row.total, size: 130, meta: { align: "end", mobileHidden: true, renderCell: (row) => <span className={styles.money}>{format.money(row.total, row.currency)}</span> } },
    { id: "next", header: t("Next"), accessorFn: () => "", size: 120, meta: { align: "end", renderCell: (row) => {
      const step = orderNext(row, rights, today);
      if (!step?.mine) return null;
      return <Button size="compact" variant={step.key === "approve" || step.key === "chase" ? "secondary" : "quiet"} isLoading={busy === row.id}
        aria-label={`${stepLabel[step.key]} ${row.number}`} onPress={() => act(row, step)}>{stepLabel[step.key]}</Button>;
    } } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, labels, format, state, busy, today]);

  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  const bulk = (chosen: OrderRow[]) => {
    const approvable = chosen.filter((row) => orderNext(row, rights, today)?.key === "approve" && orderNext(row, rights, today)?.mine);
    const sendable = chosen.filter((row) => row.status === "approved" && rights.canBuy);
    return <>
      {approvable.length ? <Button size="compact" onPress={() => void approve(approvable)}>{t("Approve ({count})", { count: approvable.length })}</Button> : null}
      {sendable.length ? <Button size="compact" onPress={() => void markSent(sendable)}>{t("Mark as sent ({count})", { count: sendable.length })}</Button> : null}
    </>;
  };
  const emptyTitle = { mine: t("Nothing waits for you"), approval: t("Nothing waits for approval"), send: t("Nothing to send"), confirm: t("Nothing to confirm"), late: t("Nothing is late"),
    all: openOnly ? t("No open orders") : t("No orders yet") }[current];
  return <div className={styles.stack}>
    {notice ? <InlineNotice tone={notice.tone} message={notice.text} /> : null}
    <DataGrid<OrderRow>
      ariaLabel={t("Orders")}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={!state}
      onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search orders")}
      toolbarLeading={<div className={styles.filters}>
        <ListTabs label={t("Orders")} value={current} onChange={setView} items={[
          { id: "mine", label: t("Needs me"), count: counts.mine },
          { id: "approval", label: t("Waiting for approval"), count: counts.approval },
          { id: "send", label: t("To send"), count: counts.send },
          { id: "confirm", label: t("To confirm"), count: counts.confirm },
          { id: "late", label: t("Late"), count: counts.late },
          { id: "all", label: t("All") },
        ]} />
        <ProjectFilterChip project={projectId ? (state?.orders.flatMap((order) => order.projects).find((project) => project.id === projectId) ?? { id: projectId, reference: t("This project") }) : null}
          onClear={() => onProject(null)} />
      </div>}
      filters={current === "all" ? [{ id: "status", label: t("Status"), options: [{ id: "open", label: t("Open") }], value: openOnly ? "open" : undefined,
        onChange: (value) => setOpenOnly(value === "open") }] : []}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} />
        : <EmptyState title={emptyTitle} description={current === "all" && !openOnly ? t("Orders start from what projects need to order.") : null} />}
      rowNumbers={false}
      selectable={rights.canBuy || rights.canApprove}
      selectionResetKey={`${current}:${openOnly}:${projectId ?? ""}`}
      bulkActions={bulk}
      wrapText
    />
    {openId ? <OrderSheet api={api} orderId={openId} intent={intent} settings={state?.settings ?? null} onChanged={() => void load()} onClose={() => onOpen(null)} onReceipt={onReceipt}
      onOpenOrder={(id) => { void load(); onOpen(id); }} /> : null}
  </div>;
}
