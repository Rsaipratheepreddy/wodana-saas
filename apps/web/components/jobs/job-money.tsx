"use client";

import { CalendarClock, CircleCheck, Hourglass, TriangleAlert } from "lucide-react";
import { Badge, DataGrid, FactTiles, InlineNotice, PriceTag, formatDate, formatMoney, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { JobMoney } from "@/lib/jobs/journey";

type Milestone = JobMoney["milestones"][number];

/**
 * §0.3 P8: the job's money, from the one statement the server works out (the portal and handover read the same):
 * what was agreed, what arrived, what's still to pay, what's late and the next payment, then the schedule. Amounts are
 * formatted from their exact decimal strings with the currency's own decimals. A check that doesn't reconcile is said.
 */
export function JobMoneyBlock({ money }: { money: JobMoney }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  if (!money.lines.length && !money.milestones.length) return null;
  const amount = (value: string) => { try { return formatMoney(value, { locale, currency: money.currency }); } catch { return `${money.currency} ${value}`; } };
  const day = (value: string | null) => value ? formatDate(value, { locale, timeZone }) : null;
  const zero = (value: string) => Number(value) === 0;
  const columns: DataGridColumn<Milestone>[] = [
    { accessorKey: "title", header: t("Milestone"), size: 180 },
    { accessorKey: "amount", header: t("Amount"), size: 120, meta: { align: "end" }, cell: ({ row: { original: item } }) => <span className="wd-job-money-figure">{amount(item.amount)}</span> },
    { accessorKey: "received", header: t("Received"), size: 120, meta: { align: "end" }, cell: ({ row: { original: item } }) => <span className="wd-job-money-figure">{amount(item.received)}</span> },
    { accessorKey: "remaining", header: t("Remaining"), size: 110, meta: { align: "end" }, cell: ({ row: { original: item } }) => zero(item.remaining)
      ? <Badge tone="success">{t("Paid")}</Badge> : <span className="wd-job-money-figure">{amount(item.remaining)}</span> },
    { accessorKey: "dueDate", header: t("Due date"), size: 120, cell: ({ row: { original: item } }) => item.overdue ? <Badge tone="danger">{t("Overdue")} · {day(item.dueDate)}</Badge>
      : <span className="wd-job-doc-muted">{day(item.dueDate) ?? "—"}</span> },
  ];
  const checks = money.checks.map((check) => check.kind === "schedule_gap"
    ? t("{title}: the payment schedule differs from the agreed total by {amount}", { title: check.title, amount: amount(check.difference) })
    : check.kind === "not_posted" ? t("A receipt of {amount} isn't in the ledger yet", { amount: amount(check.amount) })
      : t("A receipt of {amount} is in the ledger as {posted}", { amount: amount(check.amount), posted: amount(check.posted ?? "0") }));
  // Named by its tab ("Money"), so no title of its own.
  return <section className="wd-job-documents" aria-label={t("Money")}>
    <div className="wd-job-money-head">
      <PriceTag label={t("Agreed")} amount={amount(money.agreed)} detail={money.lines.map((line) => line.kind === "design" ? t("Design fee") : line.title).join(" · ")} />
      <FactTiles label={t("Payments")} items={[
        { id: "received", label: t("Received"), value: amount(money.received), icon: <CircleCheck />, tone: "success" },
        { id: "due", label: zero(money.credit) ? t("Still to pay") : t("Credit"), value: amount(zero(money.credit) ? money.due : money.credit), icon: <Hourglass />, tone: "info" },
        ...(zero(money.overdue) ? [] : [{ id: "overdue", label: t("Overdue"), value: amount(money.overdue), icon: <TriangleAlert />, tone: "danger" as const }]),
        ...(money.next ? [{ id: "next", label: t("Next payment"), value: amount(money.next.amount), detail: [money.next.title, day(money.next.dueDate)].filter(Boolean).join(" · "),
          icon: <CalendarClock /> }] : []),
      ]} />
    </div>
    {checks.length ? <InlineNotice tone="error" message={checks.join(" · ")} /> : null}
    {money.milestones.length ? <div data-sales-grid><DataGrid ariaLabel={t("Schedule")} columns={columns} data={money.milestones} getRowId={(item) => item.id} rowNumbers={false}
      selectable={false} showToolbar={false} emptyTitle="" emptyDescription="" /></div> : null}
  </section>;
}
