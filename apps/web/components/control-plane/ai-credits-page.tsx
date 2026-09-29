"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Callout, Checkbox, DataGrid, EmptyState, ErrorState, NoResultsState, PageHeader, Tabs, TextInput, useDesignSystem, type DataGridColumn, type TabItem, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type AiCreditsList, type AiCreditsOrganization, type AiModelRate, type AiModelRates } from "@/lib/internal/console";
import { formatCredits } from "@/lib/workspace/ai-credits";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

const PRICE = /^\d{1,10}(\.\d{1,4})?$/;
const MARGIN = /^\d{1,3}(\.\d{1,3})?$/;

/** AI credits across organizations (balance, this month, today, last top-up), today's platform cap and the model rates. */
export function AiCreditsPage({ canManage }: { canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "rates" ? "rates" : "organizations";
  const { locale } = useDesignSystem();
  const [data, setData] = useState<AiCreditsList | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setData(await consoleApi.aiCredits()); setError(""); }
    catch (cause) { setError((cause as Error).message || t("AI credits didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.organizations ?? []).filter((row) => !query || [row.name, row.slug].some((value) => value.toLowerCase().includes(query)));
  }, [data, search]);
  const format = useConsoleFormat();
  const columns = useMemo<DataGridColumn<AiCreditsOrganization>[]>(() => [
    { id: "organization", header: t("Organization"), size: 260, accessorFn: (row) => row.name, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      {row.accountId ? <Link href={`/internal/accounts/${row.accountId}?tab=ai-credits&org=${encodeURIComponent(row.key)}`}>{row.name}</Link> : <strong>{row.name}</strong>}
      <small>{row.aiEnabled ? t("AI on") : t("AI off")}</small></span> } },
    { id: "balance", header: t("Balance"), size: 150, accessorFn: (row) => row.balance, meta: { align: "end", renderCell: (row) => <span className={styles.inline}>
      {row.state === "exhausted" ? <Badge tone="danger">{t("Used up")}</Badge> : row.state === "low" ? <Badge tone="warning">{t("Running low")}</Badge> : null}
      <span className={styles.number}>{row.hasAccount ? formatCredits(row.balance, locale) : t("{credits} on first use", { credits: formatCredits(row.balance, locale) })}</span></span> } },
    { id: "month", header: t("This month"), size: 120, accessorFn: (row) => row.usedThisMonth, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{formatCredits(row.usedThisMonth, locale)}</span> } },
    { id: "today", header: t("Today"), size: 110, accessorFn: (row) => row.usedToday, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{formatCredits(row.usedToday, locale)}</span> } },
    { id: "topUp", header: t("Last top-up"), size: 170, accessorFn: (row) => row.lastTopUp?.at ?? "", meta: { renderCell: (row) => row.lastTopUp
      ? <span className={styles.nameCell}><strong className={styles.number}>{formatCredits(row.lastTopUp.credits, locale)}</strong><small>{format.date(row.lastTopUp.at)}</small></span>
      : <span className={styles.muted}>{t("None yet")}</span> } },
  ], [format, locale, t]);

  if (error && !data) return <div className={styles.page}><PageHeader title={t("AI credits")} /><ErrorState description={error} onRetry={() => void load()} /></div>;
  const platform = data?.platform;
  const items: TabItem[] = [
    { id: "organizations", label: t("Organizations"), panel: <div className={styles.panel}>
      <DataGrid<AiCreditsOrganization> ariaLabel={t("AI credits by organization")} columns={columns} data={visible} getRowId={(row) => row.workspaceId}
        isLoading={!data} searchLabel={t("Search organizations")} searchValue={search} onSearchChange={setSearch}
        onRowAction={(row) => { if (row.accountId) router.push(`/internal/accounts/${row.accountId}?tab=ai-credits&org=${encodeURIComponent(row.key)}`); }}
        emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No organizations yet")} />}
        rowNumbers={false} selectable={false} wrapText />
    </div> },
    { id: "rates", label: t("Model rates"), panel: <RatesTab canManage={canManage} /> },
  ];
  return <div className={styles.page}>
    <PageHeader title={t("AI credits")} />
    {platform?.reached ? <Callout tone="warning" title={t("AI is paused for today")}>
      {t("{used} of {limit} credits used across organizations today.", { used: formatCredits(platform.usedToday, locale), limit: formatCredits(platform.dailyLimit, locale) })}
    </Callout> : null}
    {platform ? <dl className={styles.properties}>
      <div><dt>{t("Today, all organizations")}</dt><dd className={styles.number}>{t("{used} of {limit}", { used: formatCredits(platform.usedToday, locale), limit: formatCredits(platform.dailyLimit, locale) })}</dd></div>
      <div><dt>{t("Daily limit per organization")}</dt><dd className={styles.number}>{formatCredits(platform.workspaceDailyLimit, locale)}</dd></div>
      <div><dt>{t("Welcome credits")}</dt><dd className={styles.number}>{formatCredits(platform.welcomeCredits, locale)}</dd></div>
      <div><dt>{t("Model")}</dt><dd><span dir="ltr">{platform.model ?? t("Not set up")}</span></dd></div>
    </dl> : null}
    <Tabs selectedKey={tab} onSelectionChange={(key) => router.replace(key === "rates" ? "/internal/ai-credits?tab=rates" : "/internal/ai-credits", { scroll: false })} items={items} />
  </div>;
}

/** Credits per million tokens follow from the list price (US$ per million tokens) × the margin: 1 credit = US$0.001. */
function RatesTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [data, setData] = useState<AiModelRates | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AiModelRate | null>(null);
  const load = useCallback(async () => {
    try { setData(await consoleApi.aiRates()); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Model rates didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<AiModelRate>[]>(() => [
    { id: "model", header: t("Model"), size: 260, accessorFn: (row) => row.label, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <strong>{row.label}</strong><small dir="ltr">{row.model}</small></span> } },
    { id: "state", header: t("State"), size: 170, accessorFn: (row) => row.active, meta: { renderCell: (row) => <span className={styles.inline}>
      {data?.inUse?.model === row.model ? <Badge tone="success">{t("In use")}</Badge> : null}
      {!row.active ? <Badge tone="neutral">{t("Off")}</Badge> : null}
      {!row.priceConfirmed ? <Badge tone="warning">{t("Price to confirm")}</Badge> : null}</span> } },
    { id: "list", header: t("List price in / out (US$ per 1M)"), size: 200, accessorFn: (row) => row.listInput, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number} dir="ltr">{formatCredits(row.listInput, locale, 4)} / {formatCredits(row.listOutput, locale, 4)}</span> } },
    { id: "margin", header: t("Margin"), size: 90, accessorFn: (row) => row.margin, meta: { align: "end", renderCell: (row) => <span className={styles.number} dir="ltr">×{formatCredits(row.margin, locale, 3)}</span> } },
    { id: "credits", header: t("Credits in / out (per 1M)"), size: 200, accessorFn: (row) => row.inputPerMillion, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number} dir="ltr">{formatCredits(row.inputPerMillion, locale)} / {formatCredits(row.outputPerMillion, locale)}</span> } },
  ], [data, locale, t]);
  if (error && !data) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={styles.panel}>
    <DataGrid<AiModelRate> ariaLabel={t("Model rates")} columns={columns} data={data?.rates ?? []} getRowId={(row) => row.model} isLoading={!data}
      onRowAction={canManage ? (row) => setEditing(row) : undefined} emptyContent={<EmptyState title={t("No model rates")} />}
      rowNumbers={false} selectable={false} showToolbar={false} wrapText />
    {editing ? <RateDialog rate={editing} onClose={() => setEditing(null)} onSave={async (input) => {
      await consoleApi.setAiRate(editing.model, { expectedVersion: editing.version, ...input });
      setEditing(null); await load();
    }} /> : null}
  </div>;
}

function RateDialog({ rate, onClose, onSave }: { rate: AiModelRate; onClose: () => void;
  onSave: (input: { listInput: string; listOutput: string; margin: string; priceConfirmed: boolean; active: boolean }) => Promise<void> }) {
  const t = useT();
  const [listInput, setListInput] = useState(rate.listInput);
  const [listOutput, setListOutput] = useState(rate.listOutput);
  const [margin, setMargin] = useState(rate.margin);
  const [priceConfirmed, setConfirmed] = useState(rate.priceConfirmed);
  const [active, setActive] = useState(rate.active);
  const [error, setError] = useState("");
  const valid = PRICE.test(listInput.trim()) && PRICE.test(listOutput.trim()) && MARGIN.test(margin.trim()) && !/^0+(\.0+)?$/.test(margin.trim());
  return <FormDialog size="md" title={rate.label} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { setError("");
        try { await onSave({ listInput: listInput.trim(), listOutput: listOutput.trim(), margin: margin.trim(), priceConfirmed, active }); }
        catch (cause) { setError((cause as Error).message || t("The rate could not be saved.")); }
        finally { }
      }}>
      <TextInput label={t("Input price (US$ per 1M tokens)")} isRequired value={listInput} onChange={setListInput} />
      <TextInput label={t("Output price (US$ per 1M tokens)")} isRequired value={listOutput} onChange={setListOutput} />
      <TextInput label={t("Margin")} isRequired value={margin} onChange={setMargin} description={t("1.5 charges 50% over the list price.")} />
      <Checkbox isSelected={priceConfirmed} onChange={setConfirmed}>{t("Price confirmed")}</Checkbox>
      <Checkbox isSelected={active} onChange={setActive}>{t("Active")}</Checkbox>
  </FormDialog>;
}
