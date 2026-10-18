"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Callout, DataGrid, ErrorState, NoAccessState, SettingsPage, SettingsRow, SettingsSection, Skeleton, formatDate, isNoAccessError, useDesignSystem,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { ENTRY_LABELS, featureLabel, formatCredits, readAiCredits, type CreditLedgerEntry, type CreditOverview } from "@/lib/workspace/ai-credits";
import styles from "./ai-credits-page.module.css";

type FeatureRow = CreditOverview["byFeature"][number];

/** Settings → Company → AI credits: what is left, where this month's credits went, and every entry. */
export function AiCreditsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [credits, setCredits] = useState<CreditOverview | null>(null);
  const [error, setError] = useState("");
  const [noAccess, setNoAccess] = useState(false);
  const load = useCallback(async () => {
    try { setCredits(await readAiCredits(workspaceId)); setError(""); }
    catch (cause) {
      setNoAccess(isNoAccessError(cause));
      setError(cause instanceof Error ? translateKnown(t, cause.message) : t("AI credits didn't load."));
    }
  }, [workspaceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const at = useCallback((value: string) => formatDate(value, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" }), [locale, timeZone]);
  const featureColumns = useMemo<DataGridColumn<FeatureRow>[]>(() => [
    { id: "feature", header: t("Feature"), size: 240, accessorFn: (row) => t(featureLabel(row.feature)), meta: { primary: true } },
    { id: "calls", header: t("Answers"), size: 110, accessorFn: (row) => row.calls, meta: { align: "end", renderCell: (row) => formatCredits(String(row.calls), locale, 0) } },
    { id: "credits", header: t("Credits"), size: 130, accessorFn: (row) => row.credits, meta: { align: "end", renderCell: (row) => formatCredits(row.credits, locale) } },
  ], [locale, t]);
  const ledgerColumns = useMemo<DataGridColumn<CreditLedgerEntry>[]>(() => [
    { id: "when", header: t("When"), size: 170, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => at(row.createdAt) } },
    { id: "entry", header: t("Entry"), size: 150, accessorFn: (row) => t(ENTRY_LABELS[row.entryType]), meta: { primary: true } },
    { id: "detail", header: t("Detail"), size: 260, accessorFn: (row) => row.entryType === "usage" && row.feature ? t(featureLabel(row.feature)) : [row.reference, row.note].filter(Boolean).join(" · ") },
    { id: "credits", header: t("Credits"), size: 120, accessorFn: (row) => row.credits,
      meta: { align: "end", renderCell: (row) => <span className={styles.number} dir="ltr">{row.credits.startsWith("-") ? "" : "+"}{formatCredits(row.credits, locale, 4)}</span> } },
    { id: "balance", header: t("Balance"), size: 120, accessorFn: (row) => row.balanceAfter, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{formatCredits(row.balanceAfter, locale)}</span> } },
    { id: "by", header: t("By"), size: 160, accessorFn: (row) => row.createdByName ?? "" },
  ], [at, locale, t]);

  if (error && !credits) return noAccess ? <NoAccessState area={t("AI credits")} /> : <ErrorState description={error} onRetry={() => void load()} />;
  if (!credits) return <Skeleton lines={6} shape="form" />;
  return <SettingsPage title={t("AI credits")} width="wide">
    {credits.state === "exhausted" ? <Callout tone="warning" title={t("AI credits are used up")}>{t("Woddy and AI suggestions are paused. Contact support to top up.")}</Callout>
      : credits.state === "low" ? <Callout tone="info" title={t("AI credits are running low")}>{t("Contact support to top up.")}</Callout> : null}
    <SettingsSection id="balance" title={t("Balance")}>
      <SettingsRow label={t("Credits left")}><strong className={styles.value}>{formatCredits(credits.balance, locale)}</strong></SettingsRow>
      <SettingsRow label={t("Used this month")}><span className={styles.number}>{formatCredits(credits.usedThisMonth, locale)}</span></SettingsRow>
      <SettingsRow label={t("Used today")}><span className={styles.number}>{t("{used} of {limit}", { used: formatCredits(credits.usedToday, locale), limit: formatCredits(credits.dailyLimit, locale) })}</span></SettingsRow>
      <SettingsRow label={t("Last top-up")}>{credits.lastTopUp
        ? t("{credits} on {date}", { credits: formatCredits(credits.lastTopUp.credits, locale), date: at(credits.lastTopUp.at) })
        : <span className={styles.muted}>{t("None yet")}</span>}</SettingsRow>
    </SettingsSection>
    <SettingsSection id="this-month" title={t("This month")}>
      <DataGrid ariaLabel={t("AI use this month")} columns={featureColumns} data={credits.byFeature} getRowId={(row) => row.feature}
        emptyTitle={t("No AI use this month")} pageSize={10} pinFirstColumn={false} rowNumbers={false} selectable={false} showToolbar={false} />
    </SettingsSection>
    <SettingsSection id="ledger" title={t("Ledger")}>
      <DataGrid ariaLabel={t("AI credit ledger")} columns={ledgerColumns} data={credits.ledger} getRowId={(row) => row.id}
        emptyTitle={t("No entries yet")} pageSize={25} pinFirstColumn={false} rowNumbers={false} selectable={false} showToolbar={false} wrapText />
    </SettingsSection>
  </SettingsPage>;
}
