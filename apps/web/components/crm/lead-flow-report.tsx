"use client";

import { useEffect, useState } from "react";
import { Callout, DataGrid, SelectField } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { leadOptionLabel } from "@/lib/crm/lead-options";
import type { LeadsPageData } from "@/lib/crm/leads";
import styles from "./lead-forms.module.css";

type ReportRow = { id: string; label: string; leads: number; unassigned: number; qualified: number; disqualified: number; won: number; lost: number; stale: number; averageDaysSinceUpdate: string; qualificationRate: string };
type Report = { rows: ReportRow[]; processing: { status: string; count: number }[]; walkIns: { intakeMethod: string; count: number; leads: number; qualified: number; disqualified: number; duplicates: number }[] };
export function LeadFlowReport({ initialData }: { initialData: LeadsPageData }) {
  const [groupBy, setGroup] = useState("source");
  const [period, setPeriod] = useState("30");
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  const requestKey = `${initialData.workspaceId}:${groupBy}:${period}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const controller = new AbortController();
    const to = new Date(), from = new Date(to.getTime() - Number(period) * 86400000);
    const query = new URLSearchParams({ groupBy, from: from.toISOString(), to: to.toISOString() });
    crmRequest<Report>(initialData.workspaceId, `reports/lead-flow?${query}`, "GET", undefined, controller.signal)
      .then(value => { setReport(value); setError(""); }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Report unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoadedKey(requestKey); });
    return () => controller.abort();
  }, [initialData.workspaceId, groupBy, period, requestKey]);
  const groups = [{ id: "source", label: "Source & channel" }, { id: "mainSource", label: "Main source" }, { id: "channel", label: "Channel" }, { id: "enquiryType", label: "Enquiry type" }, { id: "customerType", label: "Customer type" }, { id: "budget", label: "Budget range" }, { id: "emirate", label: "Emirate" }, { id: "owner", label: "Salesperson" }, { id: "team", label: "Sales team" }, { id: "intake", label: "Intake method" }, { id: "day", label: "Daily volume" }, { id: "week", label: "Weekly volume" }, { id: "month", label: "Monthly volume" }];
  const label = (value: string) => {
    if (groupBy === "mainSource") return leadOptionLabel(initialData.leadOptions?.sources, value);
    if (groupBy === "channel") return leadOptionLabel(Object.values(initialData.leadOptions?.channels ?? {}).flat(), value);
    if (groupBy === "enquiryType") return leadOptionLabel(initialData.leadOptions?.enquiryTypes, value);
    if (groupBy === "budget") return leadOptionLabel(initialData.leadOptions?.budgetRanges, value);
    if (groupBy === "customerType") return leadOptionLabel(initialData.leadOptions?.customerTypes, value);
    if (groupBy === "emirate") return leadOptionLabel(initialData.leadOptions?.emirates, value);
    if (groupBy === "source") { const [source, channel] = value.split(" / "); return `${leadOptionLabel(initialData.leadOptions?.sources, source)} / ${leadOptionLabel(initialData.leadOptions?.channels[source], channel)}`; }
    return value.replaceAll("_", " ");
  };
  return <section className={styles.forms} aria-label="Enquiry reports">
    <header className={styles.toolbar}><div><h2>Enquiry performance</h2><p>Outcomes for enquiries created in the selected period. Stale means no update for 7 days.</p></div><div className={styles.actions}><SelectField label="Group by" items={groups} selectedKey={groupBy} onSelectionChange={key => key && setGroup(String(key))} /><SelectField label="Period" items={[{ id: "7", label: "Last 7 days" }, { id: "30", label: "Last 30 days" }, { id: "90", label: "Last 90 days" }, { id: "365", label: "Last year" }]} selectedKey={period} onSelectionChange={key => key && setPeriod(String(key))} /></div></header>
    {loading ? <p role="status">Loading report…</p> : error ? <Callout title="Report unavailable" tone="warning">{error}</Callout> : <>
      <DataGrid ariaLabel="Enquiry health report" data={report?.rows ?? []} getRowId={row => row.id} pageSize={50} exportFileName="enquiry-health.csv" columns={[
        { id: "label", header: groups.find(group => group.id === groupBy)?.label ?? "Group", accessorFn: row => label(row.label), size: 260 },
        { accessorKey: "leads", header: "Enquiries", size: 110 }, { accessorKey: "unassigned", header: "Unassigned", size: 120 },
        { accessorKey: "qualified", header: "Qualified", size: 110 }, { accessorKey: "disqualified", header: "Disqualified", size: 120 },
        { accessorKey: "qualificationRate", header: "Qualified %", size: 125 }, { accessorKey: "won", header: "Won", size: 90 },
        { accessorKey: "lost", header: "Lost", size: 90 }, { accessorKey: "stale", header: "Stale", size: 90 },
        { accessorKey: "averageDaysSinceUpdate", header: "Avg days since update", size: 190 },
      ]} emptyTitle="No enquiries in this period" emptyDescription="Choose a longer period or start collecting enquiries." />
      <div className={styles.settings}><h3>Incoming enquiries</h3><p>{report?.processing.map(item => `${item.status === "ready" ? "Processed" : item.status === "duplicate_candidate" ? "Duplicate review" : item.status.replaceAll("_", " ")}: ${item.count}`).join(" · ") || "No submissions"}</p></div><DataGrid ariaLabel="Walk-in performance" data={report?.walkIns ?? []} getRowId={row => row.intakeMethod} showToolbar={false} columns={[
        { id: "intake", header: "Walk-in capture", accessorFn: row => row.intakeMethod === "form" ? "Customer form / QR" : row.intakeMethod === "manual" ? "Staff entry" : row.intakeMethod, size: 230 },
        { accessorKey: "count", header: "Submissions", size: 140 }, { accessorKey: "leads", header: "Enquiries", size: 110 },
        { accessorKey: "qualified", header: "Qualified", size: 120 }, { accessorKey: "disqualified", header: "Disqualified", size: 120 },
        { accessorKey: "duplicates", header: "Duplicate review", size: 150 },
      ]} emptyTitle="No walk-in enquiries in this period" />
    </>}
  </section>;
}
