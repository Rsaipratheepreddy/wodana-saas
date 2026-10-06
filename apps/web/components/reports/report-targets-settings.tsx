"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataGrid, ErrorState, SaveBar, SelectField, SettingsPage, Skeleton, useDesignSystem, useToast, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { reportsApi, type TargetsPayload } from "@/lib/reports/management";
import styles from "./report-targets-settings.module.css";

/** The KPIs that take a target, as the dashboards name them (PLM-134 targets table). */
const TARGET_LABELS: Record<string, MessageKey> = {
  sales_won_value: tKey("Sales Won – value"), sales_won_count: tKey("Sales Won – count"), revenue_collected: tKey("Revenue collected"),
  net_revenue: tKey("Net revenue"), deals_closed: tKey("Deals Closed / Completed"), profit_margin: tKey("Profit margin (%)"), new_leads: tKey("New leads"),
  lead_to_won_rate: tKey("Conversion lead → Won (%)"), response_rate: tKey("Response rate (%)"), first_response_hours: tKey("Average first response (hours) – lower is better"),
  design_to_proposal2_rate: tKey("Design approval → Proposal 2 Won (%)"), design_to_proposal2_days: tKey("Design approval → Proposal 2 (days) – lower is better"),
};

const COMPANY = "company";
const AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
type Row = { kpi: string; label: string; unit: string };

/**
 * Settings → Report targets: one value per KPI per month, for the whole company or one Account Manager (where the
 * KPI is per person). A blank month has no target ("No target set" on the dashboard). Saved in one command.
 */
export function ReportTargetsSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const toast = useToast();
  const api = useMemo(() => reportsApi(workspaceId), [workspaceId]);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [who, setWho] = useState(COMPANY);
  const [data, setData] = useState<TargetsPayload | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.targets(year, controller.signal).then((value) => { setData(value); setFailure(null); setDrafts({}); }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [api, year, reload]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`), [year]);
  const member = who === COMPANY ? null : who;
  const key = useCallback((kpi: string, month: string) => `${kpi}|${member ?? ""}|${month}`, [member]);
  const stored = useCallback((kpi: string, month: string) => data?.targets.find((row) => row.kpi === kpi && row.month === month && row.membershipId === member), [data, member]);
  const shown = (kpi: string, month: string) => drafts[key(kpi, month)] ?? stored(kpi, month)?.target ?? "";
  const rows: Row[] = (data?.kpis ?? []).filter((kpi) => !member || kpi.perMember).map((kpi) => ({ kpi: kpi.code, label: t(TARGET_LABELS[kpi.code] ?? (kpi.code as MessageKey)), unit: kpi.unit }));
  const monthLabel = (month: string) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));

  const changes = Object.entries(drafts).flatMap(([draftKey, value]) => {
    const [kpi, membership, month] = draftKey.split("|");
    const current = data?.targets.find((row) => row.kpi === kpi && row.month === month && row.membershipId === (membership || null));
    const target = value.trim() === "" ? null : value.trim();
    if ((current?.target ?? null) === target) return [];
    return [{ kpi, month, membershipId: membership || null, target, version: current?.version ?? null }];
  });

  const save = async () => {
    if (!changes.length) return;
    setSaving(true);
    try {
      await api.saveTargets({ commandId: crypto.randomUUID(), changes });
      setSaved(true);
      setReload((value) => value + 1);
      toast.push({ tone: "success", title: t("Targets saved"), message: "" });
    } catch (cause) {
      toast.push({ tone: "danger", title: t("Not saved"), message: cause instanceof Error ? translateKnown(t, cause.message) : t("Please try again.") });
    } finally { setSaving(false); }
  };

  const columns: DataGridColumn<Row>[] = [
    { id: "kpi", header: t("KPI"), size: 300, accessorFn: (row) => row.label, meta: { primary: true } },
    ...months.map((month): DataGridColumn<Row> => ({
      id: month, header: monthLabel(month), size: 96, accessorFn: (row) => shown(row.kpi, month),
      meta: {
        editable: true, align: "end",
        validate: (value, row) => {
          const text = value.trim();
          if (!text) return undefined;
          if (!AMOUNT.test(text) || Number(text) <= 0) return t("Enter a target above zero");
          if (row.unit === "percent" && Number(text) > 100) return t("A percentage target is at most 100");
          return undefined;
        },
      },
    })),
  ];

  const people = [{ id: COMPANY, label: t("Whole company") }, ...(data?.accountManagers ?? [])];
  return <SettingsPage title={t("Report targets")} width="wide">
    <div className={styles.controls}>
      <SelectField accent="neutral" label={t("Year")} items={[thisYear - 1, thisYear, thisYear + 1].map((value) => ({ id: String(value), label: String(value) }))}
        selectedKey={String(year)} onSelectionChange={(value) => { setYear(Number(value)); setSaved(false); }} isDisabled={changes.length > 0} />
      <SelectField accent="neutral" label={t("Targets for")} items={people} selectedKey={who} onSelectionChange={(value) => { setWho(String(value ?? COMPANY)); setSaved(false); }} isDisabled={changes.length > 0} />
    </div>
    {failure ? <ErrorState title={t("Targets didn't load")} description={translateKnown(t, failure)} onRetry={() => setReload((value) => value + 1)} />
      : !data ? <Skeleton shape="rows" lines={8} />
      : <DataGrid ariaLabel={t("Report targets")} columns={columns} data={rows} getRowId={(row) => row.kpi} gridLines selectable={false} rowNumbers={false} showToolbar={false} pageSize={20}
          onCellUpdate={(row, columnId, value) => { setDrafts((current) => ({ ...current, [key(row.kpi, columnId)]: value.trim() })); setSaved(false); }} />}
    <SaveBar isDirty={changes.length > 0} isSaving={saving} saved={saved && !changes.length} message={changes.length ? t("{count} changes", { count: changes.length }) : undefined}
      onDiscard={() => setDrafts({})} onSave={() => void save()} />
  </SettingsPage>;
}
