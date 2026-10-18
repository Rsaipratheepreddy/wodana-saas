"use client";

import { FileText, Hourglass, PackageCheck, ReceiptText, Wallet } from "lucide-react";
import { Badge, DataGrid, FactTiles, InlineNotice, formatDate, formatMoney, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { JobCosts } from "@/lib/jobs/journey";
import type { OrderStatus } from "@/lib/purchasing/types";
import { OrderStatusLabel } from "../purchasing/order-labels";

type Order = JobCosts["orders"][number];
type Bill = JobCosts["bills"][number];

/**
 * §0.3 P8/P9: the job's supplier side, from the one calculation the server makes: committed with suppliers, billed,
 * paid and still to pay, then the orders and the bills. A bill shared with other jobs is shown whole and marked; it's
 * never split. Internal only. A check that doesn't reconcile is said.
 */
export function JobCostsBlock({ costs }: { costs: JobCosts }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const amount = (value: string) => { try { return formatMoney(value, { locale, currency: costs.currency }); } catch { return `${costs.currency} ${value}`; } };
  const orderColumns: DataGridColumn<Order>[] = [
    { accessorKey: "number", header: t("Order"), size: 150, cell: ({ row: { original: order } }) => <span className="wd-job-doc"><strong>{order.number}</strong><small>{order.supplier}</small></span> },
    { accessorKey: "status", header: t("Status"), size: 130, cell: ({ row: { original: order } }) => <OrderStatusLabel status={order.status as OrderStatus} /> },
    { accessorKey: "committed", header: t("Committed"), size: 130, meta: { align: "end" }, cell: ({ row: { original: order } }) => <span className="wd-job-money-figure">{amount(order.committed)}</span> },
    { accessorKey: "billed", header: t("Billed"), size: 130, meta: { align: "end" }, cell: ({ row: { original: order } }) => <span className="wd-job-money-figure">{amount(order.billed)}</span> },
  ];
  const billColumns: DataGridColumn<Bill>[] = [
    { accessorKey: "number", header: t("Bill"), size: 170, cell: ({ row: { original: bill } }) => <span className="wd-job-doc"><strong>{bill.number}</strong>
      <small>{[bill.supplier, formatDate(bill.date, { locale, timeZone })].filter(Boolean).join(" · ")}</small></span> },
    { accessorKey: "total", header: t("Total"), size: 130, meta: { align: "end" }, cell: ({ row: { original: bill } }) => <span className="wd-job-doc-chips" data-inline="">
      <span className="wd-job-money-figure">{amount(bill.total)}</span>{bill.shared ? <Badge hue={2}>{t("Shared")}</Badge> : null}</span> },
    { accessorKey: "paid", header: t("Paid"), size: 120, meta: { align: "end" }, cell: ({ row: { original: bill } }) => <span className="wd-job-money-figure">{amount(bill.paid)}</span> },
    { accessorKey: "remaining", header: t("To pay"), size: 120, meta: { align: "end" }, cell: ({ row: { original: bill } }) => Number(bill.remaining) === 0
      ? <Badge tone="success">{t("Paid")}</Badge> : <span className="wd-job-money-figure">{amount(bill.remaining)}</span> },
  ];
  const checks = costs.checks.map((check) => check.kind === "billed_over_order"
    ? t("{order}: {item} is billed {billed}, above the {ordered} ordered", { order: check.orderNumber, item: check.description, billed: amount(check.billed), ordered: amount(check.ordered) })
    : check.kind === "payment_not_posted" ? t("A supplier payment of {amount} isn't in the ledger yet", { amount: amount(check.amount) })
      : check.kind === "bill_not_posted" ? t("Bill {number} isn't in the ledger yet", { number: check.number })
        : t("Bill {number} is in the ledger as {posted}", { number: check.number, posted: amount(check.posted ?? "0") }));
  return <section className="wd-job-documents" aria-label={t("Costs")}>
    <FactTiles label={t("Costs")} items={[
      { id: "committed", label: t("Committed"), value: amount(costs.committed), icon: <PackageCheck /> },
      { id: "billed", label: t("Billed"), value: amount(costs.billed), icon: <ReceiptText /> },
      { id: "paid", label: t("Paid"), value: amount(costs.paid), icon: <Wallet />, tone: "success" },
      { id: "to-pay", label: t("To pay"), value: amount(costs.toPay), icon: <Hourglass />, tone: "info" },
    ]} />
    {checks.length ? <InlineNotice tone="error" message={checks.join(" · ")} /> : null}
    {costs.orders.length ? <div data-sales-grid><DataGrid ariaLabel={t("Orders")} columns={orderColumns} data={costs.orders} getRowId={(order) => order.id} rowNumbers={false}
      selectable={false} showToolbar={false} emptyTitle="" emptyDescription="" /></div> : null}
    {costs.bills.length ? <>
      <h3 className="wd-job-subtitle"><FileText aria-hidden="true" size={14} />{t("Supplier bills")}</h3>
      <div data-sales-grid><DataGrid ariaLabel={t("Supplier bills")} columns={billColumns} data={costs.bills} getRowId={(bill) => bill.id} rowNumbers={false}
        selectable={false} showToolbar={false} emptyTitle="" emptyDescription="" /></div>
    </> : null}
  </section>;
}
