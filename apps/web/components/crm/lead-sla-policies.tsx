"use client";

import { useState } from "react";
import { Badge, Button, Callout, DataGrid, type DataGridColumn } from "@/design-system";
import type { CrmSlaPolicy, LeadsPageData } from "@/lib/crm/leads";
import { rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec } from "./crm-workbench";
import styles from "./lead-assignment.module.css";

const RESPONSE_EVENT = "first_response";
const BUSINESS_HOURS = {
  version: 1,
  mode: "business",
  timezone: "Asia/Dubai",
  weeklyHours: {
    monday: [{ start: "08:00", end: "18:00" }],
    tuesday: [{ start: "08:00", end: "18:00" }],
    wednesday: [{ start: "08:00", end: "18:00" }],
    thursday: [{ start: "08:00", end: "18:00" }],
    friday: [{ start: "08:00", end: "18:00" }],
  },
  holidays: [],
  dateOverrides: {},
} as const;

type SlaSummary = RecordData & {
  summary?: Record<string, unknown>;
};

function duration(value: number) {
  if (value % 1_440 === 0) return `${value / 1_440}d`;
  if (value % 60 === 0) return `${value / 60}h`;
  return `${value} min`;
}

function policyClock(policy: CrmSlaPolicy) {
  const mode = policy.calculationMode ?? String(policy.schedule?.mode ?? "elapsed");
  if (mode !== "business") return "24 / 7";
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
    return `Mon–Fri · ${firstWindow.start}–${firstWindow.end} · ${String(schedule?.timezone ?? "Local time")}`;
  }
  return schedule?.timezone ? `Business hours · ${String(schedule.timezone)}` : "Business hours";
}

function reportCount(value: unknown) {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? "—" : parsed.toLocaleString("en-GB");
}

function eventPolicy(policy?: CrmSlaPolicy): ActionSpec {
  const calculationMode = policy?.calculationMode ?? (policy?.schedule?.mode === "business" ? "business" : "elapsed");
  return {
    title: policy ? "Edit response SLA" : "Add response SLA",
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
          name: "First response",
          warningAfterMinutes: 60,
          breachAfterMinutes: 120,
          calculationMode: "elapsed",
        },
    fields: [
      { key: "name", label: "Policy name", required: true },
      { key: "warningAfterMinutes", label: "Warn after (minutes)", type: "number", min: 0, max: 525_599, required: true },
      { key: "breachAfterMinutes", label: "Breach after (minutes)", type: "number", min: 1, max: 525_600, required: true },
      { key: "calculationMode", label: "Count time", options: [{ id: "elapsed", label: "24 / 7 elapsed time" }, { id: "business", label: "Business hours" }], required: true },
      ...(policy ? [{ key: "status", label: "Status", options: choice(["active", "archived"]), required: true }] : []),
    ],
    transform: ({ calculationMode: selectedMode, ...values }) => {
      const calculationMode = selectedMode === "business" ? "business" : "elapsed";
      const existingMode = policy?.calculationMode ?? policy?.schedule?.mode;
      const schedule = existingMode === calculationMode && policy?.schedule
        ? policy.schedule
        : calculationMode === "business"
          ? BUSINESS_HOURS
          : { version: 1, mode: "elapsed" as const };
      return { ...values, ...(policy ? {} : { eventType: RESPONSE_EVENT }), calculationMode, schedule };
    },
    submit: policy ? "Save" : "Add SLA",
  };
}

export function LeadResponseSla({ initialData }: { initialData: LeadsPageData }) {
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
  const average = health.averageResponseMinutes == null || !Number.isFinite(averageMinutes) ? "—" : `${Math.round(averageMinutes)} min`;
  const columns: DataGridColumn<CrmSlaPolicy>[] = [
    { accessorKey: "name", header: "Policy", size: 220, meta: { primary: true }, cell: ({ row }) => <>First response<small>{row.original.name}</small></> },
    { accessorKey: "warningAfterMinutes", header: "Warning", size: 110, cell: ({ row }) => duration(Number(row.original.warningAfterMinutes)) },
    { accessorKey: "breachAfterMinutes", header: "Breach", size: 110, cell: ({ row }) => duration(Number(row.original.breachAfterMinutes)) },
    { id: "clock", accessorFn: policyClock, header: "Clock", size: 145 },
    { accessorKey: "status", header: "Status", size: 100, cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Archived"}</Badge> },
    { id: "action", header: "Action", size: 95, enableSorting: false, cell: ({ row }) => <Button size="compact" variant="quiet" onPress={() => setAction(eventPolicy(row.original))}>Edit</Button> },
  ];

  return <section aria-label="Response SLA" className={styles.page}>
    <header className={styles.toolbar}>
      <h2>Response targets</h2>
      <div className={styles.actions}>
        <Button size="compact" onPress={refresh}>Refresh</Button>
        <Button size="compact" variant="primary" onPress={() => setAction(eventPolicy())}>Add SLA</Button>
      </div>
    </header>
    <DataGrid ariaLabel="Response SLA policies" appearance="flush" columns={columns} data={policies} getRowId={(policy) => policy.id} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle="No response SLA configured" emptyDescription="Add one to track first responses to new enquiries." />
    <ResourceState loading={loading} failure={failure} retry={refresh} />
    {!loading && !failure ? <dl className={styles.health} aria-label="Response SLA health"><div><dt>Within target</dt><dd>{reportCount(health.withinTarget)}</dd></div><div><dt>Breached</dt><dd>{reportCount(health.breached)}</dd></div><div><dt>Average first response</dt><dd>{average}</dd></div></dl> : null}
    {action ? <ActionDialog workspaceId={initialData.workspaceId} action={action} onClose={() => setAction(null)} onSaved={refresh} /> : null}
    {!failure && summary && !rows(summary).length && !policies.length ? <Callout title="No response activity yet" tone="neutral">Add a response SLA before new enquiries arrive.</Callout> : null}
  </section>;
}
