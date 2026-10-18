"use client";

import { ExternalLink } from "lucide-react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalMilestone } from "@/lib/client-portal/types";
import { FileStrip } from "../forms/attach-files";
import { isolate } from "../portal-format";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import { BudgetTracker } from "./portal-home";
import type { SectionProps } from "./section-types";

/**
 * One row per payment (overdue first): what it's for, when it's due, the amount or what's left, its invoice to
 * print, what was received (with receipts), and "I've paid" with proof while the team checks it.
 */
export function PaymentsSection({ project, site, format, open, api }: SectionProps) {
  const t = useT();
  const payments = project.payments;
  if (!payments) return null;
  if (!payments.milestones.length) return <EmptyState illustration="empty" title={t("No payments yet")} description={t("Your payment schedule will appear here.")} />;
  const printable = (kind: "invoice" | "receipt", id: string) =>
    `/portal/${encodeURIComponent(site.slug)}/print?${new URLSearchParams({ case: project.id, [kind]: id })}`;
  const money = (value: string | null) => format.money(value, payments.currency);
  const reportLine = (milestone: PortalMilestone) => {
    const report = milestone.report;
    if (!report || report.status === "recorded") return null;
    return report.status === "submitted"
      ? t("You told us you paid on {date}. We're checking it.", { date: format.date(report.paidOn) })
      : t("We couldn't find your payment of {date}: {reason}", { date: format.date(report.paidOn), reason: report.reason });
  };
  return <div className={styles.section}>
    {project.budget ? <BudgetTracker budget={project.budget} format={format} onOpen={open} /> : null}
    <ul className={styles.list}>{payments.milestones.map((milestone) => <li className={styles.item} key={milestone.id}>
      <span className={styles.itemText}>
        <span className={styles.itemTitle} dir="auto">{milestone.title}</span>
        <span className={styles.itemMeta}>
          {milestone.dueDate && milestone.status !== "paid" ? t("due {date}", { date: format.date(milestone.dueDate) }) : null}
          {milestone.invoice ? <>{milestone.dueDate && milestone.status !== "paid" ? " · " : null}
            <a href={printable("invoice", milestone.invoice.id)} rel="noreferrer" target="_blank">{t("Invoice {number}", { number: isolate(milestone.invoice.number) })}</a></> : null}
        </span>
        {milestone.receipts.map((receipt) => <span className={styles.itemMeta} key={receipt.id}>
          <a href={printable("receipt", receipt.id)} rel="noreferrer" target="_blank">
            {receipt.amount ? t("Received {amount} on {date}", { amount: money(receipt.amount), date: format.date(receipt.receivedOn) })
              : t("Received on {date}", { date: format.date(receipt.receivedOn) })}</a></span>)}
        {reportLine(milestone) ? <span className={styles.itemMeta} dir="auto" data-tone={milestone.report?.status === "not_received" ? "danger" : undefined}>{reportLine(milestone)}</span> : null}
        {milestone.report && milestone.report.status !== "recorded" ? <FileStrip files={milestone.report.files} api={api} /> : null}
      </span>
      <span className={styles.itemEnd}>
        {milestone.amount ? <span className={styles.amount}>{["paid", "upcoming"].includes(milestone.status) || milestone.left === milestone.amount
          ? money(milestone.amount) : t("{amount} left", { amount: money(milestone.left) })}</span> : null}
        <StateLabel state={milestone.status} />
        {milestone.payUrl ? <a className="wd-button" data-size="compact" data-variant="primary" href={milestone.payUrl} rel="noreferrer" target="_blank">
          {t("Pay")}<ExternalLink aria-hidden="true" size={14} /></a> : null}
        {milestone.canReport ? <Button size="compact" variant={milestone.payUrl ? "quiet" : "secondary"} onPress={() => open({ kind: "paid", id: milestone.id })}>{t("I've paid")}</Button> : null}
      </span>
    </li>)}</ul>
  </div>;
}
