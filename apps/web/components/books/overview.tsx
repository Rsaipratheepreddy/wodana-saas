"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CardGrid, EmptyState, KpiFigure, SelectField } from "@/design-system";
import { ledgerPaths, type LedgerOverview as Overview, type LedgerScope } from "@/lib/books/reports-client";
import { LedgerRegion, useLedgerFormat, useLedgerT } from "./reports/ledger-format";
import styles from "./reports/ledger.module.css";

/**
 * The Ledger at a glance for one company: cash, what clients owe, what is owed to suppliers, the VAT due this
 * quarter and profit for this financial year, each opening the report behind it. Without a company on the Ledger,
 * the one next step: turn it on in Settings › Ledger (for people who set it up).
 */
export function LedgerOverview({ overview, onEntity }: { overview: Overview; onEntity: (entityId: string) => void }) {
  const t = useLedgerT();
  if (!overview.entity || !overview.balances) {
    return <EmptyState title={t("The Ledger is off")}
      action={overview.canManage ? <Link className="wd-button" data-size="standard" data-variant="primary" href={ledgerPaths.settings()}>{t("Turn on Ledger")}</Link> : undefined} />;
  }
  return <LedgerRegion entity={overview.entity}>
    {overview.entities.length > 1 ? <div className={styles.picker}>
      <SelectField accent="neutral" label={t("Company")} items={overview.entities.map((item) => ({ id: item.id, label: item.name }))} selectedKey={overview.entity.id}
        onSelectionChange={(value) => value && onEntity(String(value))} />
    </div> : null}
    <Figures overview={overview} />
  </LedgerRegion>;
}

function Figures({ overview }: { overview: Overview }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const router = useRouter();
  const balances = overview.balances!;
  const entity = overview.entity!.id;
  const year: Partial<LedgerScope> = { entity, ...overview.fiscalYear };
  const today: Partial<LedgerScope> = { entity, to: overview.fiscalYear?.to };
  return <CardGrid min="14rem">
    <KpiFigure label={t("Cash")} value={format.money(balances.cash)} onOpen={() => router.push(ledgerPaths.accounts({ entity, ...overview.fiscalYear }))} />
    <KpiFigure label={t("Clients owe")} value={format.money(balances.receivables)} onOpen={() => router.push(ledgerPaths.report("ar-ageing", today))} />
    <KpiFigure label={t("Owed to suppliers")} value={format.money(balances.payables)} onOpen={() => router.push(ledgerPaths.report("ap-ageing", today))} />
    {balances.vatDue !== null && overview.vatPeriod ? <KpiFigure label={t("VAT due this quarter")} value={format.money(balances.vatDue)}
      detail={`${format.day(overview.vatPeriod.from)} – ${format.day(overview.vatPeriod.to)}`}
      onOpen={() => router.push(ledgerPaths.report("vat", { entity, from: overview.vatPeriod!.from, to: overview.fiscalYear?.to }))} /> : null}
    <KpiFigure label={t("Profit this year")} value={format.money(balances.profitThisYear)} tone={balances.profitThisYear.startsWith("-") ? "danger" : undefined}
      onOpen={() => router.push(ledgerPaths.report("profit-and-loss", year))} />
  </CardGrid>;
}
