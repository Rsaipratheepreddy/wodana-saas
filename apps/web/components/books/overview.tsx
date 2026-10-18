"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, EmptyState, KpiFigure, SelectField, Sparkline, type ChartPoint } from "@/design-system";
import { ledgerPaths, type LedgerOverview as Overview, type LedgerScope } from "@/lib/books/reports-client";
import { journalTitle } from "./journal-sheet";
import { LedgerRegion, useLedgerFormat, useLedgerT, type LedgerFormat } from "./reports/ledger-format";
import { MissingRegionNotice } from "./reports/report-views";
import styles from "./reports/ledger.module.css";

/**
 * The Ledger home for one company: cash, what clients owe, what is owed to suppliers, VAT due this quarter and profit
 * this financial year, each with its six-month trend and opening the report behind it; then what needs someone, each
 * with the action that deals with it, and the latest journals. Without a company on the Ledger, the one next step:
 * turn it on in Settings › Ledger (for people who set it up), or read the P&L from where the books live.
 */
export function LedgerOverview({ overview, onEntity }: { overview: Overview; onEntity: (entityId: string) => void }) {
  const t = useLedgerT();
  if (!overview.entity || !overview.balances) {
    return <EmptyState title={t("The Ledger is off")} description={t("Profit and loss and cash flow still read from Wodana's records")}
      action={<span className={styles.pickerActions}>
        {overview.canManage ? <Link className="wd-button" data-size="standard" data-variant="primary" href={ledgerPaths.settings()}>{t("Turn on Ledger")}</Link> : null}
        <Link className="wd-button" data-size="standard" data-variant="secondary" href={ledgerPaths.report("profit-and-loss")}>{t("Profit and loss")}</Link>
      </span>} />;
  }
  return <LedgerRegion entity={overview.entity}>
    <div className={styles.home}>
      {overview.entities.length > 1 ? <div className={styles.picker}>
        <SelectField accent="neutral" label={t("Company")} items={overview.entities.map((item) => ({ id: item.id, label: item.name }))} selectedKey={overview.entity.id}
          onSelectionChange={(value) => value && onEntity(String(value))} />
      </div> : null}
      {overview.vatMissingRegion ? <MissingRegionNotice lines={overview.vatMissingRegion.lines} label={overview.vatMissingRegion.label} /> : null}
      <Figures overview={overview} />
      <div className={styles.columns}>
        <Attention overview={overview} />
        <Recent overview={overview} />
      </div>
    </div>
  </LedgerRegion>;
}

function trendPoints(format: LedgerFormat, days: readonly string[] | undefined, values: readonly string[] | undefined): ChartPoint[] {
  if (!days || !values) return [];
  return days.map((day, index) => ({ label: format.month(day), value: Number(values[index] ?? 0), display: format.money(values[index] ?? "0") }));
}

function Figures({ overview }: { overview: Overview }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const router = useRouter();
  const balances = overview.balances!;
  const entity = overview.entity!.id;
  const year: Partial<LedgerScope> = { entity, ...overview.fiscalYear };
  const today: Partial<LedgerScope> = { entity, to: overview.fiscalYear?.to };
  const trend = overview.trend;
  const spark = (label: string, values: readonly string[] | undefined) => {
    const points = trendPoints(format, trend?.days, values);
    return points.length > 1 ? <Sparkline label={t("{label}, last six months", { label })} points={points} /> : null;
  };
  return <div className={styles.figures}>
    <KpiFigure label={t("Cash")} value={format.money(balances.cash)} tone={format.negative(balances.cash) ? "danger" : undefined}
      onOpen={() => router.push(ledgerPaths.report("cash-flow", { entity }))}>{spark(t("Cash"), trend?.cash)}</KpiFigure>
    <KpiFigure label={t("Clients owe")} value={format.money(balances.receivables)}
      onOpen={() => router.push(ledgerPaths.report("ar-ageing", today))}>{spark(t("Clients owe"), trend?.receivables)}</KpiFigure>
    <KpiFigure label={t("Owed to suppliers")} value={format.money(balances.payables)}
      onOpen={() => router.push(ledgerPaths.report("ap-ageing", today))}>{spark(t("Owed to suppliers"), trend?.payables)}</KpiFigure>
    {balances.vatDue !== null && overview.vatPeriod ? <KpiFigure label={t("VAT due this quarter")} value={format.money(balances.vatDue)}
      detail={format.period(overview.vatPeriod.from, overview.vatPeriod.to)}
      onOpen={() => router.push(ledgerPaths.report("vat", { entity, from: overview.vatPeriod!.from, to: overview.fiscalYear?.to }))}>{spark(t("VAT due this quarter"), trend?.vat)}</KpiFigure> : null}
    <KpiFigure label={t("Profit this year")} value={format.money(balances.profitThisYear)} tone={format.negative(balances.profitThisYear) ? "danger" : undefined}
      detail={overview.fiscalYear ? format.period(overview.fiscalYear.from, overview.fiscalYear.to) : undefined}
      onOpen={() => router.push(ledgerPaths.report("profit-and-loss", year))} />
  </div>;
}

type Item = { key: string; label: string; detail?: string; href: string; action: string; tone: "danger" | "warning" | "info" };

/** What needs someone, most urgent first, each with the action that deals with it. */
function Attention({ overview }: { overview: Overview }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const entity = overview.entity!.id;
  const attention = overview.attention;
  const items: Item[] = [];
  if (attention?.unbalanced) items.push({ key: "unbalanced", label: t("The trial balance doesn't balance"), href: ledgerPaths.report("trial-balance", { entity }),
    action: t("Open"), tone: "danger" });
  if (overview.openIssues) items.push({ key: "issues", label: overview.openIssues === 1 ? t("1 record couldn't post") : t("{count} records couldn't post", { count: overview.openIssues }),
    href: ledgerPaths.attention({ entity }), action: t("Review"), tone: "warning" });
  if (attention?.manualWaiting) items.push({ key: "manual", label: attention.manualWaiting === 1 ? t("1 journal waiting for approval")
    : t("{count} journals waiting for approval", { count: attention.manualWaiting }), href: `${ledgerPaths.journals({ entity })}&view=manual`, action: t("Review"), tone: "info" });
  if (attention && !format.negative(attention.overdueReceivables) && !/^-?0+(\.0+)?$/.test(attention.overdueReceivables)) items.push({ key: "receivables",
    label: t("Clients are overdue"), detail: format.money(attention.overdueReceivables), href: ledgerPaths.report("ar-ageing", { entity, to: overview.fiscalYear?.to }), action: t("Chase"), tone: "warning" });
  if (attention && !format.negative(attention.overduePayables) && !/^-?0+(\.0+)?$/.test(attention.overduePayables)) items.push({ key: "payables",
    label: t("Supplier bills are overdue"), detail: format.money(attention.overduePayables), href: ledgerPaths.report("ap-ageing", { entity, to: overview.fiscalYear?.to }), action: t("Pay"), tone: "warning" });
  return <section className={styles.panel} aria-labelledby="ledger-attention">
    <div className={styles.panelHead}><h2 id="ledger-attention" className={styles.subhead}>{t("To do")}</h2></div>
    {items.length ? <ul className={styles.list}>
      {items.map((item) => <li key={item.key}>
        <Badge tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info"}>{item.tone === "danger" ? t("Blocked") : item.tone === "warning" ? t("Due") : t("Waiting")}</Badge>
        <span className={styles.listMain}><span>{item.label}</span>{item.detail ? <small>{item.detail}</small> : null}</span>
        <Link className="wd-button" data-size="compact" data-variant="secondary" href={item.href}>{item.action}</Link>
      </li>)}
    </ul> : <EmptyState illustration={null} title={t("Nothing needs you")} />}
  </section>;
}

function Recent({ overview }: { overview: Overview }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const entity = overview.entity!.id;
  const recent = overview.recent ?? [];
  return <section className={styles.panel} aria-labelledby="ledger-recent">
    <div className={styles.panelHead}>
      <h2 id="ledger-recent" className={styles.subhead}>{t("Latest journals")}</h2>
      {recent.length ? <Link className={styles.panelLink} href={ledgerPaths.journals({ entity })}>{t("All journals")}</Link> : null}
    </div>
    {recent.length ? <ul className={styles.list}>
      {recent.map((journal) => <li key={journal.id}>
        <span className={styles.listMain}>
          {/* One title shape for every journal: "<event>: <whom>", the references in the muted line (UX-060). */}
          <Link className={styles.link} href={ledgerPaths.journal(journal.id, { entity })}>{journalTitle(t, journal)}</Link>
          <small>{[...new Set([journal.sourceLabel, journal.number].filter(Boolean))].concat(format.day(journal.journalDate)).join(" · ")}</small>
        </span>
        <span className={styles.listEnd}>{format.money(journal.total)}</span>
      </li>)}
    </ul> : <EmptyState illustration={null} title={t("Journals appear here as invoices, payments and bills are recorded")} />}
  </section>;
}
