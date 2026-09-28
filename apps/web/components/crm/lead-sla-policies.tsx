"use client";

import { useState } from "react";
import { Badge, Button, DataGrid, useDesignSystem, type DataGridColumn } from "@/design-system";
import type { CrmSlaPolicy, LeadsPageData } from "@/lib/crm/leads";
import type { RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec } from "./crm-workbench";
import styles from "./lead-assignment.module.css";

const RESPONSE_EVENT = "first_response";
/** New business-hours policies start on the workspace's time zone. */
const businessHours = (timezone: string) => ({
  version: 1,
  mode: "business",
  timezone,
  weeklyHours: {
    monday: [{ start: "08:00", end: "18:00" }],
    tuesday: [{ start: "08:00", end: "18:00" }],
    wednesday: [{ start: "08:00", end: "18:00" }],
    thursday: [{ start: "08:00", end: "18:00" }],
    friday: [{ start: "08:00", end: "18:00" }],
  },
  holidays: [],
  dateOverrides: {},
} as const);

type SlaSummary = RecordData & {
  summary?: Record<string, unknown>;
};

function duration(value: number, t: Translate) {
  if (value % 1_440 === 0) return t("{count}d", { count: value / 1_440 });
  if (value % 60 === 0) return t("{count}h", { count: value / 60 });
  return t("{count} min", { count: value });
}

function policyClock(policy: CrmSlaPolicy, t: Translate) {
  const mode = policy.calculationMode ?? String(policy.schedule?.mode ?? "elapsed");
  if (mode !== "business") return t("24 / 7");
  const schedule = policy.schedule;
  const weeklyHours = schedule?.weeklyHours as Record<string, Array<{ start?: string; end?: string }>> | undefined;
  const weekdayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const weekdayWindows = weekdayKeys.map((day) => weeklyHours?.[day] ?? []);
  const firstWindow = weekdayWindows[0]?.[0];
  const isWeekdayOfficeSchedule = firstWindow?.start && firstWindow?.end
    && weekdayWindows.every((windows) => windows.length === 1
      && windows[0]?.start === firstWindow.start && windows[0]?.end === firstWindow.end)
    && !(weeklyHours?.saturday?.length) && !(weeklyHours?.sunday?.length);
  if (isWeekdayOfficeSchedule) {
    return t("Mon–Fri · {start}–{end} · {timeZone}", { start: firstWindow.start ?? "", end: firstWindow.end ?? "", timeZone: String(schedule?.timezone ?? t("Local time")) });
  }
  return schedule?.timezone ? t("Business hours · {timeZone}", { timeZone: String(schedule.timezone) }) : t("Business hours");
}

function reportCount(value: unknown, locale: string) {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? "—" : parsed.toLocaleString(locale);
}

function eventPolicy(t: Translate, timeZone: string, policy?: CrmSlaPolicy): ActionSpec {
  const calculationMode = policy?.calculationMode ?? (policy?.schedule?.mode === "business" ? "business" : "elapsed");
  return {
    title: policy ? t("Edit response SLA") : t("Add response SLA"),
    path: policy ? `sla-policies/${policy.id}` : "sla-policies",
    method: policy ? "PATCH" : "POST",
    initial: policy
      ? {
          version: policy.version,
          name: policy.name,
          warningAfterMinutes: policy.warningAfterMinutes,
          breachAfterMinutes: policy.breachAfterMinutes,
          calculationMode,
          status: policy.status,
        }
      : {
          eventType: RESPONSE_EVENT,
          name: t("First response"),
          warningAfterMinutes: 60,
          breachAfterMinutes: 120,
          calculationMode: "elapsed",
        },
    fields: [
      { key: "name", label: t("Policy name"), required: true },
      { key: "warningAfterMinutes", label: t("Warn after (minutes)"), type: "number", min: 0, max: 525_599, required: true },
      { key: "breachAfterMinutes", label: t("Breach after (minutes)"), type: "number", min: 1, max: 525_600, required: true },
      { key: "calculationMode", label: t("Count time"), options: [{ id: "elapsed", label: t("24 / 7 elapsed time") }, { id: "business", label: t("Business hours") }], required: true },
      ...(policy ? [{ key: "status", label: t("Status"), options: choice(["active", "archived"]), required: true }] : []),
    ],
    transform: ({ calculationMode: selectedMode, ...values }) => {
      const calculationMode = selectedMode === "business" ? "business" : "elapsed";
      const existingMode = policy?.calculationMode ?? policy?.schedule?.mode;
      const schedule = existingMode === calculationMode && policy?.schedule
        ? policy.schedule
        : calculationMode === "business"
          ? businessHours(timeZone)
          : { version: 1, mode: "elapsed" as const };
      return { ...values, ...(policy ? {} : { eventType: RESPONSE_EVENT }), calculationMode, schedule };
    },
    submit: policy ? t("Save") : t("Add response target"),
  };
}

export function LeadResponseSla({ initialData }: { initialData: LeadsPageData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [action, setAction] = useState<ActionSpec | null>(null);
  const policiesResource = useCrmResource<CrmSlaPolicy[]>(initialData.workspaceId, "sla-policies");
  const summaryResource = useCrmResource<SlaSummary>(initialData.workspaceId, "reports/sla");
  const policies = policiesResource.data ?? initialData.slaPolicies;
  const summary = summaryResource.data;
  const loading = policiesResource.loading || summaryResource.loading;
  const failure = policiesResource.failure || summaryResource.failure;
  const refresh = () => { policiesResource.refresh(); summaryResource.refresh(); };

  const health = summary?.summary ?? {};
  const averageMinutes = Number(health.averageResponseMinutes);
  const average = health.averageResponseMinutes == null || !Number.isFinite(averageMinutes) ? "—" : t("{count} min", { count: Math.round(averageMinutes) });
  const columns: DataGridColumn<CrmSlaPolicy>[] = [
    { accessorKey: "name", header: t("Policy"), size: 220, meta: { primary: true }, cell: ({ row }) => <>{t("First response")}<small>{row.original.name}</small></> },
    { accessorKey: "warningAfterMinutes", header: t("Warning"), size: 110, cell: ({ row }) => duration(Number(row.original.warningAfterMinutes), t) },
    { accessorKey: "breachAfterMinutes", header: t("Breach"), size: 110, cell: ({ row }) => duration(Number(row.original.breachAfterMinutes), t) },
    { id: "clock", accessorFn: (policy) => policyClock(policy, t), header: t("Clock"), size: 145 },
    { accessorKey: "status", header: t("Status"), size: 100, cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? t("Active") : t("Archived")}</Badge> },
    { id: "action", header: t("Action"), size: 95, enableSorting: false, cell: ({ row }) => <Button size="compact" variant="quiet" onPress={() => setAction(eventPolicy(t, timeZone, row.original))}>{t("Edit")}</Button> },
  ];

  return <section aria-label={t("Response SLA")} className={styles.page}>
    <header className={styles.toolbar} data-actions-only>
      <div className={styles.actions}>
        <Button size="compact" onPress={refresh}>{t("Refresh")}</Button>
        <Button size="compact" variant="primary" onPress={() => setAction(eventPolicy(t, timeZone))}>{t("Add response target")}</Button>
      </div>
    </header>
    <DataGrid ariaLabel={t("Response SLA policies")} columns={columns} data={policies} getRowId={(policy) => policy.id} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle={t("No response targets yet")} emptyDescription={t("Set how fast a new enquiry must get its first contact.")} />
    <ResourceState loading={loading} failure={failure} retry={refresh} />
    {!loading && !failure && policies.length ? <dl className={styles.health} aria-label={t("Response SLA health")}><div><dt>{t("Within target")}</dt><dd>{reportCount(health.withinTarget, locale)}</dd></div><div><dt>{t("Breached")}</dt><dd>{reportCount(health.breached, locale)}</dd></div><div><dt>{t("Average first response")}</dt><dd>{average}</dd></div></dl> : null}
    {action ? <ActionDialog workspaceId={initialData.workspaceId} action={action} onClose={() => setAction(null)} onSaved={refresh} /> : null}
  </section>;
}
