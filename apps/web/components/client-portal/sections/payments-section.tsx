"use client";

import { ExternalLink } from "lucide-react";
import { EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** Tax invoices (with what was received on them) and the payment schedule; a pay link only where one exists. */
export function PaymentsSection({ project, format }: SectionProps) {
  const t = useT();
  const payments = project.payments;
  if (!payments) return null;
  if (!payments.invoices.length && !payments.schedule.length)
    return <EmptyState illustration="empty" title={t("No payments yet")} description={t("Invoices and your payment schedule will appear here.")} />;
  return <div className={styles.section}>
    {payments.invoices.length ? <section className={styles.group} aria-labelledby="portal-invoices">
      <h2 className={styles.groupTitle} id="portal-invoices">{t("Invoices")}</h2>
      <ul className={styles.list}>{payments.invoices.map((invoice) => <li className={styles.item} key={invoice.id}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle}>{invoice.number} · {invoice.milestone}</span>
          <span className={styles.itemMeta}>{t("Issued {date}", { date: format.date(invoice.issueDate) })}
            {invoice.status === "due" || invoice.status === "overdue" ? ` · ${t("due {date}", { date: format.date(invoice.dueDate) })}` : ""}</span>
          {invoice.receipts.map((receipt, index) => <span className={styles.itemMeta} key={index}>
            {receipt.amount ? t("Received {amount} on {date}", { amount: format.money(receipt.amount, invoice.currency), date: format.date(receipt.receivedOn) })
              : t("Received on {date}", { date: format.date(receipt.receivedOn) })}</span>)}
        </span>
        <span className={styles.itemEnd}>
          {invoice.total ? <span className={styles.amount}>{invoice.status === "due" || invoice.status === "overdue"
            ? t("{amount} left", { amount: format.money(invoice.balance, invoice.currency) }) : format.money(invoice.total, invoice.currency)}</span> : null}
          <StateLabel state={invoice.status} />
        </span>
      </li>)}</ul>
    </section> : null}

    {payments.schedule.length ? <section className={styles.group} aria-labelledby="portal-schedule">
      <h2 className={styles.groupTitle} id="portal-schedule">{t("Payment schedule")}</h2>
      <ul className={styles.list}>{payments.schedule.map((milestone) => <li className={styles.item} key={milestone.id}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle}>{milestone.title}</span>
          <span className={styles.itemMeta}>{[milestone.invoiceNumber, milestone.dueDate ? t("due {date}", { date: format.date(milestone.dueDate) }) : ""].filter(Boolean).join(" · ")}</span>
        </span>
        <span className={styles.itemEnd}>
          {milestone.amount ? <span className={styles.amount}>{format.money(milestone.amount, payments.currency)}</span> : null}
          <StateLabel state={milestone.status} />
          {milestone.payUrl ? <a className="wd-button" data-size="compact" data-variant="primary" href={milestone.payUrl} rel="noreferrer" target="_blank">
            {t("Pay")}<ExternalLink aria-hidden="true" size={14} /></a> : null}
        </span>
      </li>)}</ul>
    </section> : null}
  </div>;
}
