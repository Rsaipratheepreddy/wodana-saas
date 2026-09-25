"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeCheck,
  Bot,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  ContactRound,
  Inbox,
  Mail,
  MessageSquareText,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  DataGrid,
  InspectorSheet,
  Tabs,
  DesignSystemProvider,
  formatDate,
  formatMoney,
  type DataGridColumn,
  type SavedView,
} from "@/design-system";
import type { CrmRecord, CrmScreenId, CrmScreenPageData } from "@/lib/crm/screens";
import styles from "./crm-screen-page.module.css";
import { crmRequest, rows } from "@/lib/crm/client";
import { CrmRecordWorkbench, CrmCreateDialog, LinkedRecordWorkbench } from "./crm-record-workbench";
import { PipelineSettings } from "./pipeline-settings";
import { AutomationApprovals } from "./automation-approvals";
import { CrmOverview } from "./crm-overview";
import { CrmInbox } from "./crm-inbox";
import { CrmSmartRules } from "./crm-smart-rules";
import { CrmFollowUps } from "./crm-follow-ups";
import { CrmCalendar } from "./crm-calendar";

const DUBAI_FORMAT = { locale: "en-GB", timeZone: "Asia/Dubai" };

const screenCopy: Record<CrmScreenId, { title: string; description: string; noun: string }> = {
  "crm-overview": { title: "Today", description: "Customer work that needs attention now.", noun: "priorities" },
  "follow-ups": { title: "Follow-ups", description: "Keep every promised call, task, and client reminder visible.", noun: "follow-ups" },
  calendar: { title: "Calendar", description: "See CRM commitments and connected Google events.", noun: "events" },
  customers: { title: "Customers", description: "People and companies linked to enquiries and opportunities.", noun: "customers" },
  organizations: { title: "Companies", description: "Companies connected to enquiries, stakeholders, and commercial work.", noun: "companies" },
  opportunities: { title: "Opportunities", description: "Qualified enquiries moving to a commercial decision or pre-execution.", noun: "opportunities" },
  activities: { title: "Activities", description: "Coordinate calls, meetings, tasks, notes, and the next customer commitment.", noun: "activities" },
  conversations: { title: "Inbox", description: "Customer conversations and messages awaiting a response.", noun: "conversations" },
  sequences: { title: "Sequences", description: "Organize consistent, respectful follow-up across email, WhatsApp, and team tasks.", noun: "sequences" },
  automations: { title: "Automations", description: "Monitor CRM workflows, their publishing state, and recent execution health.", noun: "automations" },
  "crm-reports": { title: "CRM reports", description: "Review acquisition, response time, pipeline, assignment, and forecast performance.", noun: "report rows" },
};

function value(row: CrmRecord, key: string): unknown { return row[key]; }
function text(row: CrmRecord, key: string, fallback = "Not set") {
  const current = value(row, key);
  return typeof current === "string" && current.trim() ? current : fallback;
}
function numeric(row: CrmRecord, key: string) {
  const current = Number(value(row, key));
  return Number.isFinite(current) ? current : 0;
}
function bool(row: CrmRecord, key: string) { return value(row, key) === true; }
function list(row: CrmRecord, key: string) { return Array.isArray(value(row, key)) ? value(row, key) as Array<Record<string, unknown>> : []; }

function humanize(input: unknown) {
  if (typeof input !== "string" || !input) return "Not set";
  return input.split(/[_-]+/).filter(Boolean).map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}

function statusTone(status: unknown) {
  if (["active", "completed", "won", "qualified", "open", "delivered", "sent"].includes(String(status))) return "success" as const;
  if (["pending", "draft", "paused", "queued", "attempting_contact", "warning", "normal"].includes(String(status))) return "warning" as const;
  if (["failed", "lost", "cancelled", "archived", "breached", "disqualified", "urgent", "high"].includes(String(status))) return "danger" as const;
  if (["running", "new", "connected", "nurturing"].includes(String(status))) return "info" as const;
  return "neutral" as const;
}

function dateLabel(input: unknown, fallback = "Not scheduled") {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input))) return fallback;
  return formatDate(input, DUBAI_FORMAT, { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(input: unknown, fallback = "Not recorded") {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input))) return fallback;
  return formatDate(input, DUBAI_FORMAT, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function moneyLabel(row: CrmRecord, key = "amount") {
  if (value(row, key) === null || value(row, key) === undefined) return "Not available";
  const amount = Number(value(row, key));
  if (!Number.isFinite(amount)) return "Restricted";
  return formatMoney(amount, { currency: text(row, key === "amount" ? "currencyCode" : "currency", "AED"), locale: "en-AE" });
}

function primaryContact(row: CrmRecord, type: "email" | "phone") {
  const matches = list(row, "contacts").filter((contact) => contact.type === type);
  const selected = matches.find((contact) => contact.isPrimary) ?? matches[0];
  return typeof selected?.rawValue === "string" ? selected.rawValue : "Not added";
}

function pipelineTotals(items: CrmRecord[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.status !== "open" || item.amount === null || item.amount === undefined) continue;
    const currency = String(item.currencyCode ?? item.currency_code ?? "");
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Number(item.amount))) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + Number(item.amount));
  }
  return [...totals].map(([currency, amount]) => formatMoney(amount, { currency, locale: "en-AE" })).join(" · ") || "Not available";
}

function Identity({ name, detail, icon }: { name: string; detail?: string; icon?: ReactNode }) {
  return <span className={styles.identity}>
    {icon ?? <Avatar name={name} size="sm" />}
    <span><strong>{name}</strong>{detail ? <small>{detail}</small> : null}</span>
  </span>;
}

function Chip({ children }: { children: ReactNode }) { return <span className={styles.chip}>{children}</span>; }
function State({ status }: { status: unknown }) { return <Badge tone={statusTone(status)}>{humanize(status)}</Badge>; }

function columnsFor(id: CrmScreenId, referenceTime: number): DataGridColumn<CrmRecord>[] {
  if (id === "crm-overview") return [
    { accessorKey: "title", header: "Customer or task", size: 260, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title")} detail={humanize(value(row.original, "kind"))} /> },
    { accessorKey: "reason", header: "Why it matters", size: 280 },
    { accessorKey: "kind", header: "Priority type", size: 160, cell: ({ row }) => <State status={value(row.original, "kind")} /> },
    { accessorKey: "dueAt", header: "Due", size: 150, cell: ({ row }) => <DueCell value={value(row.original, "dueAt")} referenceTime={referenceTime} /> },
  ];
  if (id === "customers" || id === "organizations") return [
    { accessorKey: "displayName", header: id === "customers" ? "Customer" : "Organization", size: 250, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "displayName")} detail={primaryContact(row.original, "email")} icon={id === "organizations" || row.original.type === "organization" ? <span className={styles.recordIcon}><Building2 size={16} /></span> : undefined} /> },
    ...(id === "customers" ? [{ accessorKey: "type", header: "Type", size: 120, cell: ({ row }: { row: { original: CrmRecord } }) => <Chip>{row.original.type === "organization" ? "Company" : "Person"}</Chip> }] : []),
    { accessorKey: "lifecycle", header: "Lifecycle", size: 130, cell: ({ row }) => <Chip>{humanize(value(row.original, "lifecycle"))}</Chip> },
    { id: "email", accessorFn: (row) => primaryContact(row, "email"), header: "Email", size: 220, cell: ({ row }) => <span className={styles.contact}><Mail size={13} />{primaryContact(row.original, "email")}</span> },
    { id: "phone", accessorFn: (row) => primaryContact(row, "phone"), header: "Phone", size: 155, cell: ({ row }) => primaryContact(row.original, "phone") },
    { accessorKey: "status", header: "Status", size: 110, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "updatedAt", header: "Updated", size: 130, cell: ({ row }) => dateLabel(value(row.original, "updatedAt")) },
  ];
  if (id === "opportunities") return [
    { accessorKey: "title", header: "Opportunity", size: 270, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title")} detail={text(row.original, "partyName")} /> },
    { accessorKey: "stageName", header: "Stage", size: 135, cell: ({ row }) => <Chip>{text(row.original, "stageName")}</Chip> },
    { accessorKey: "status", header: "Status", size: 100, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "amount", header: "Value", size: 135, meta: { align: "end" }, cell: ({ row }) => <strong className={styles.money}>{moneyLabel(row.original)}</strong> },
    { accessorKey: "probability", header: "Probability", size: 110, meta: { align: "center" }, cell: ({ row }) => `${numeric(row.original, "probability")}%` },
    { accessorKey: "ownerName", header: "Sales owner", size: 150, cell: ({ row }) => text(row.original, "ownerName", "Unassigned") },
    { accessorKey: "expectedCloseAt", header: "Expected close", size: 135, cell: ({ row }) => dateLabel(value(row.original, "expectedCloseAt")) },
    { accessorKey: "nextActionAt", header: "Next action", size: 130, cell: ({ row }) => <DueCell value={value(row.original, "nextActionAt")} referenceTime={referenceTime} /> },
  ];
  if (id === "activities") return [
    { accessorKey: "title", header: "Activity", size: 315, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title")} detail={humanize(value(row.original, "type"))} icon={<span className={styles.recordIcon}><Activity size={16} /></span>} /> },
    { accessorKey: "status", header: "Status", size: 115, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "priority", header: "Priority", size: 110, cell: ({ row }) => <State status={value(row.original, "priority")} /> },
    { accessorKey: "ownerName", header: "Sales owner", size: 160, cell: ({ row }) => text(row.original, "ownerName", "Unassigned") },
    { accessorKey: "dueAt", header: "Due", size: 145, cell: ({ row }) => <DueCell value={value(row.original, "dueAt")} referenceTime={referenceTime} /> },
    { accessorKey: "isNextAction", header: "Commitment", size: 125, cell: ({ row }) => bool(row.original, "isNextAction") ? <Badge tone="info">Next action</Badge> : <span className={styles.muted}>Supporting</span> },
    { accessorKey: "customerVisible", header: "Visibility", size: 120, cell: ({ row }) => <Chip>{bool(row.original, "customerVisible") ? "Customer" : "Internal"}</Chip> },
  ];
  if (id === "conversations") return [
    { accessorKey: "partyName", header: "Conversation", size: 265, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "partyName", "Internal team")} detail={text(row.original, "subject", "No subject")} /> },
    { accessorKey: "channel", header: "Channel", size: 110, cell: ({ row }) => <Chip>{humanize(value(row.original, "channel"))}</Chip> },
    { accessorKey: "lastMessageText", header: "Latest message", size: 320, cell: ({ row }) => <span className={styles.messagePreview}>{text(row.original, "lastMessageText", "No messages yet")}</span> },
    { accessorKey: "lastMessageDirection", header: "Direction", size: 110, cell: ({ row }) => humanize(value(row.original, "lastMessageDirection")) },
    { accessorKey: "unreadCount", header: "Unread", size: 90, meta: { align: "center" }, cell: ({ row }) => numeric(row.original, "unreadCount") ? <Badge tone="info">{numeric(row.original, "unreadCount")}</Badge> : <span className={styles.muted}>0</span> },
    { accessorKey: "status", header: "Status", size: 100, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "lastMessageAt", header: "Last activity", size: 140, cell: ({ row }) => dateTimeLabel(value(row.original, "lastMessageAt"), "No activity") },
  ];
  if (id === "sequences") return [
    { accessorKey: "name", header: "Sequence", size: 280, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "name")} detail={`${list(row.original, "steps").length} steps`} icon={<span className={styles.recordIcon}><Sparkles size={16} /></span>} /> },
    { accessorKey: "status", header: "Status", size: 120, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { id: "channels", accessorFn: (row) => list(row, "steps").map((step) => step.type).join(", "), header: "Flow", size: 260, cell: ({ row }) => <span className={styles.stepFlow}>{list(row.original, "steps").map((step, index) => <Chip key={String(step.id ?? index)}>{humanize(step.type)}</Chip>)}</span> },
    { id: "duration", accessorFn: (row) => list(row, "steps").reduce((total, step) => total + Number(step.delayMinutes ?? 0), 0), header: "Duration", size: 120, cell: ({ row }) => durationLabel(list(row.original, "steps").reduce((total, step) => total + Number(step.delayMinutes ?? 0), 0)) },
    { id: "exits", accessorFn: (row) => Object.keys((value(row, "exitConditions") as Record<string, unknown>) ?? {}).join(", "), header: "Stops when", size: 220, cell: ({ row }) => Object.keys((value(row.original, "exitConditions") as Record<string, unknown>) ?? {}).map(humanize).join(" · ") || "Manually stopped" },
    { accessorKey: "version", header: "Version", size: 90, meta: { align: "center" } },
  ];
  if (id === "automations") return [
    { accessorKey: "name", header: "Automation", size: 300, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "name")} detail={text(row.original, "description", humanize(value(row.original, "code")))} icon={<span className={styles.recordIcon}><Bot size={16} /></span>} /> },
    { accessorKey: "status", header: "Status", size: 115, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "code", header: "Event flow", size: 210, cell: ({ row }) => <Chip>{humanize(value(row.original, "code"))}</Chip> },
    { accessorKey: "runOncePerAggregate", header: "Run policy", size: 160, cell: ({ row }) => bool(row.original, "runOncePerAggregate") ? "Once per record" : "When triggered" },
    { accessorKey: "activeVersionNumber", header: "Published", size: 115, meta: { align: "center" }, cell: ({ row }) => value(row.original, "activeVersionNumber") ? `v${numeric(row.original, "activeVersionNumber")}` : <span className={styles.muted}>Not yet</span> },
    { accessorKey: "version", header: "Revision", size: 100, meta: { align: "center" }, cell: ({ row }) => `v${numeric(row.original, "version")}` },
  ];
  return [
    { accessorKey: "report", header: "Report", size: 130, cell: ({ row }) => <Chip>{humanize(value(row.original, "report"))}</Chip> },
    { id: "dimension", accessorFn: reportDimension, header: "Dimension", size: 230, meta: { primary: true }, cell: ({ row }) => <Identity name={reportDimension(row.original)} detail={reportBreakdown(row.original)} icon={<span className={styles.recordIcon}><CircleDollarSign size={16} /></span>} /> },
    { id: "records", accessorFn: reportRecords, header: "Records", size: 120, meta: { align: "end" }, cell: ({ row }) => reportRecords(row.original) },
    { id: "progress", accessorFn: reportProgress, header: "Progress", size: 180, cell: ({ row }) => reportProgress(row.original) },
    { id: "reportValue", accessorFn: reportValue, header: "Value", size: 160, meta: { align: "end" }, cell: ({ row }) => reportValue(row.original) },
  ];
}

function DueCell({ value, referenceTime }: { value: unknown; referenceTime: number }) {
  const overdue = typeof value === "string" && Date.parse(value) < referenceTime;
  return <span className={styles.due} data-overdue={overdue || undefined}><CalendarClock size={13} />{dateLabel(value)}</span>;
}

function durationLabel(minutes: number) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} days`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} hours`;
  return `${minutes} min`;
}

function reportDimension(row: CrmRecord) { return text(row, "source", text(row, "pipeline", text(row, "stage", text(row, "owner", text(row, "status", text(row, "currency", "Overview")))))); }
function reportBreakdown(row: CrmRecord) { return humanize(value(row, "channel") ?? value(row, "stage") ?? value(row, "method") ?? value(row, "status") ?? value(row, "report")); }
function reportRecords(row: CrmRecord) { return numeric(row, "enquiries") || numeric(row, "count") || numeric(row, "leads") || 0; }
function reportProgress(row: CrmRecord) {
  if (value(row, "opportunities") !== undefined) return `${numeric(row, "leads")} enquiries · ${numeric(row, "opportunities")} opportunities · ${numeric(row, "won")} won`;
  if (value(row, "averageMinutes") !== undefined) return `${numeric(row, "averageMinutes")} min average`;
  if (value(row, "weightedAmount") !== undefined) return `Weighted ${moneyLabel(row, "weightedAmount")}`;
  return humanize(value(row, "status") ?? value(row, "report"));
}
function reportValue(row: CrmRecord) {
  if (value(row, "value") !== undefined) return moneyLabel(row, "value");
  if (value(row, "amount") !== undefined) return moneyLabel(row, "amount");
  return "—";
}

function viewsFor(id: CrmScreenId, items: CrmRecord[], referenceTime: number): SavedView[] {
  const count = (view: string) => filterFor(id, items, view, referenceTime).length;
  if (id === "crm-overview") return ["all", "customer_reply", "overdue_activity", "due_today"].map((view) => ({ id: view, label: `${view === "all" ? "All" : humanize(view)} (${count(view)})` }));
  if (id === "customers" || id === "organizations") return ["all", "customer", "prospect", "archived"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
  if (id === "opportunities") return ["all", "open", "won", "lost"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
  if (id === "activities") return ["all", "pending", "overdue", "completed"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
  if (id === "conversations") return ["all", "unread", "open", "closed"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
  if (id === "sequences" || id === "automations") return ["all", "active", "draft", "paused"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
  return ["sources", "pipeline", "funnel", "sla", "assignment", "forecast"].map((view) => ({ id: view, label: `${humanize(view)} (${count(view)})` }));
}

function filterFor(id: CrmScreenId, items: CrmRecord[], view: string, referenceTime: number) {
  if (view === "all") return items;
  if (id === "crm-overview") return items.filter((item) => value(item, "kind") === view);
  if (id === "customers" || id === "organizations") {
    if (view === "archived") return items.filter((item) => value(item, "status") === "archived");
    return items.filter((item) => value(item, "lifecycle") === view);
  }
  if (id === "activities" && view === "overdue") return items.filter((item) => value(item, "status") === "pending" && typeof value(item, "dueAt") === "string" && Date.parse(String(value(item, "dueAt"))) < referenceTime);
  if (id === "conversations" && view === "unread") return items.filter((item) => numeric(item, "unreadCount") > 0);
  if (id === "crm-reports") return items.filter((item) => value(item, "report") === view);
  return items.filter((item) => value(item, "status") === view);
}

type SummaryItem = { icon: ReactNode; label: string; value: number | string; attention?: boolean };

function summaryFor(data: CrmScreenPageData, referenceTime: number): SummaryItem[] {
  const { id, items } = data;
  if (id === "crm-overview") {
    const counts = (data.supporting.counts ?? {}) as Record<string, number>;
    return [
      { icon: <Inbox size={14} />, value: items.length, label: "need attention", attention: items.length > 0 },
      { icon: <ContactRound size={14} />, value: counts.customers ?? 0, label: "customers" },
      { icon: <CircleDollarSign size={14} />, value: counts.opportunities ?? 0, label: "opportunities" },
      { icon: <Activity size={14} />, value: counts.activities ?? 0, label: "activities" },
    ];
  }
  if (id === "customers" || id === "organizations") return [
    { icon: id === "customers" ? <UsersRound size={14} /> : <Building2 size={14} />, value: items.length, label: `loaded ${screenCopy[id].noun}` },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "active").length, label: "active" },
    { icon: <ContactRound size={14} />, value: items.filter((item) => primaryContact(item, "email") !== "Not added").length, label: "with email" },
    { icon: <Clock3 size={14} />, value: items.filter((item) => value(item, "lifecycle") === "customer").length, label: "customers" },
  ];
  if (id === "opportunities") return [
    { icon: <CircleDollarSign size={14} />, value: items.length, label: "opportunities" },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "open").length, label: "open" },
    { icon: <CircleDollarSign size={14} />, value: pipelineTotals(items), label: "open value" },
    { icon: <CalendarClock size={14} />, value: items.filter((item) => typeof value(item, "nextActionAt") === "string" && Date.parse(String(value(item, "nextActionAt"))) < referenceTime && value(item, "status") === "open").length, label: "overdue" },
  ];
  if (id === "activities") return [
    { icon: <Activity size={14} />, value: items.length, label: "activities" },
    { icon: <Clock3 size={14} />, value: items.filter((item) => value(item, "status") === "pending").length, label: "pending" },
    { icon: <CalendarClock size={14} />, value: items.filter((item) => value(item, "status") === "pending" && typeof value(item, "dueAt") === "string" && Date.parse(String(value(item, "dueAt"))) < referenceTime).length, label: "overdue", attention: true },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "completed").length, label: "completed" },
  ];
  if (id === "conversations") return [
    { icon: <MessageSquareText size={14} />, value: items.length, label: "conversations" },
    { icon: <Inbox size={14} />, value: items.reduce((total, item) => total + numeric(item, "unreadCount"), 0), label: "unread", attention: true },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "open").length, label: "open" },
    { icon: <Mail size={14} />, value: new Set(items.map((item) => value(item, "channel"))).size, label: "channels" },
  ];
  if (id === "sequences") return [
    { icon: <Sparkles size={14} />, value: items.length, label: "sequences" },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "active").length, label: "active" },
    { icon: <Clock3 size={14} />, value: items.filter((item) => value(item, "status") === "draft").length, label: "draft" },
    { icon: <Activity size={14} />, value: items.reduce((total, item) => total + list(item, "steps").length, 0), label: "total steps" },
  ];
  if (id === "automations") {
    const runs = Array.isArray(data.supporting.runs) ? data.supporting.runs as CrmRecord[] : [];
    return [
      { icon: <Bot size={14} />, value: items.length, label: "automations" },
      { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "status") === "active").length, label: "active" },
      { icon: <Activity size={14} />, value: runs.length, label: "recent runs" },
      { icon: <Clock3 size={14} />, value: runs.filter((run) => value(run, "status") === "failed").length, label: "failed", attention: true },
    ];
  }
  return [
    { icon: <CircleDollarSign size={14} />, value: items.length, label: "report rows" },
    { icon: <Inbox size={14} />, value: items.filter((item) => value(item, "report") === "sources").length, label: "sources" },
    { icon: <Activity size={14} />, value: items.filter((item) => value(item, "report") === "pipeline").length, label: "pipeline groups" },
    { icon: <BadgeCheck size={14} />, value: items.filter((item) => value(item, "report") === "sla").reduce((total, item) => total + numeric(item, "count"), 0), label: "SLA records" },
  ];
}

function inspectorTitle(id: CrmScreenId, row: CrmRecord) {
  if (id === "customers" || id === "organizations") return text(row, "displayName");
  if (["sequences", "automations"].includes(id)) return text(row, "name");
  if (id === "opportunities" || id === "activities") return text(row, "title");
  if (id === "conversations") return text(row, "subject", text(row, "partyName"));
  if (id === "crm-reports") return reportDimension(row);
  return text(row, "title");
}

export function CrmScreenPage({ initialData, initialRecordId, initialCalendar = false, initialFollowUpList = false }: { initialFollowUpList?: boolean; initialData: CrmScreenPageData; initialRecordId?: string; initialCalendar?: boolean }) {
  if (initialData.id === "crm-overview") return <CrmOverview key={initialData.workspaceId} initialData={initialData} />;
  if (initialData.id === "calendar" || (initialData.id === "follow-ups" && initialCalendar)) return <CrmCalendar key={initialData.workspaceId} workspaceId={initialData.workspaceId} currentUserId={String(initialData.supporting.currentUserId ?? "")} canView={initialData.canView} />;
  if (initialData.id === "follow-ups") return <CrmFollowUps initialLayout={initialFollowUpList ? "kanban" : "timeline"} tasksOnly={initialFollowUpList} key={initialData.workspaceId} initialData={initialData} initialRecordId={initialRecordId} />;
  if (initialData.id === "activities" && initialCalendar) redirect("/workspace/crm/follow-ups?view=schedule");
  if (initialData.id === "conversations") return <CrmInbox key={initialData.workspaceId} initialData={initialData} initialRecordId={initialRecordId} />;
  if (initialData.id === "automations") return <CrmSmartRules key={initialData.workspaceId} initialData={initialData} />;
  return <CrmTablePage key={`${initialData.workspaceId}/${initialData.id}`} initialData={initialData} initialRecordId={initialRecordId} initialCalendar={initialCalendar} />;
}

function CrmTablePage({ initialData, initialRecordId, initialCalendar = false }: { initialData: CrmScreenPageData; initialRecordId?: string; initialCalendar?: boolean }) {
  const [linkedRecord, setLinkedRecord] = useState(initialRecordId);
  const [section, setSection] = useState(initialCalendar ? "calendar" : "records");
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [data, setData] = useState(initialData);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [view, setView] = useState(initialData.id === "crm-reports" ? "sources" : "all");
  const [reportFrom, setReportFrom] = useState(() => new Date(Date.parse(initialData.referenceTime) - 90 * 86_400_000).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => initialData.referenceTime.slice(0, 10));
  const referenceTime = Date.parse(initialData.referenceTime);
  const copy = screenCopy[initialData.id];
  const views = useMemo(() => viewsFor(initialData.id, data.items, referenceTime), [initialData.id, data.items, referenceTime]);
  const visibleItems = useMemo(() => filterFor(initialData.id, data.items, view, referenceTime), [initialData.id, data.items, referenceTime, view]);
  const columns = useMemo(() => columnsFor(initialData.id, referenceTime), [initialData.id, referenceTime]);
  const summary = useMemo(() => summaryFor(data, referenceTime), [data, referenceTime]);

  const reload = async (more = false) => {
    if (initialData.id === "crm-reports") {
      setBusy(true); setFailure("");
      try {
        const from = new Date(`${reportFrom}T00:00:00`).toISOString();
        const to = new Date(`${reportTo}T23:59:59.999`).toISOString();
        if (Date.parse(from) >= Date.parse(to)) throw new Error("Choose an end date after the start date.");
        const reports = ["sources", "pipeline", "funnel", "sla", "assignment", "forecast"];
        const payloads = await Promise.all(reports.map((report) => crmRequest<unknown>(initialData.workspaceId, `reports/${report}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)));
        const items = payloads.flatMap((payload, reportIndex) => rows(payload).map((row, rowIndex) => ({ ...row, id: `${reports[reportIndex]}-${rowIndex}`, report: reports[reportIndex] })));
        setData((current) => ({ ...current, items, nextCursor: null, supporting: { ...current.supporting, reportRange: { from, to } } }));
      } catch (error) { setFailure(error instanceof Error ? error.message : "CRM reports could not be refreshed."); }
      finally { setBusy(false); }
      return;
    }
    const endpoints: Partial<Record<CrmScreenId, string>> = { customers: "parties?limit=100", organizations: "parties?type=organization&limit=100", opportunities: "opportunities?limit=100", activities: "activities?limit=100", conversations: "conversations?limit=100", sequences: "sequences", automations: "automations", "crm-overview": "today" };
    const endpoint = endpoints[initialData.id];
    if (!endpoint) return;
    setBusy(true); setFailure("");
    try {
      const payload = await crmRequest<unknown>(initialData.workspaceId, endpoint + (more && data.nextCursor ? `&cursor=${encodeURIComponent(data.nextCursor)}` : ""));
      const incoming = rows(payload).map((row, index) => ({ ...row, id: initialData.id === "crm-overview" ? `${row.kind ?? "item"}-${row.recordId ?? index}` : String(row.id ?? row.recordId ?? index) }));
      setData((current) => ({ ...current, items: more ? [...current.items, ...incoming.filter((row) => !current.items.some((item) => item.id === row.id))] : incoming, nextCursor: (payload as { nextCursor?: string })?.nextCursor ?? null }));
    } catch (error) { setFailure(error instanceof Error ? error.message : "CRM could not be refreshed."); }
    finally { setBusy(false); }
  };
  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label={`${copy.title} workspace`} className={styles.page}>
      <header className={styles.pageHeading}><div><h1>{copy.title}</h1><p>{copy.description}</p></div>{initialData.canView && initialData.id === "crm-reports" ? <div className={styles.reportRange}><label>From<input type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} /></label><label>To<input type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} /></label><Button size="compact" isLoading={busy} onPress={() => void reload()}>Apply</Button></div> : initialData.canView && initialData.id !== "crm-overview" ? <div className={styles.pageActions}><Button size="compact" isLoading={busy} onPress={() => void reload()}>Refresh</Button><Button size="compact" variant="primary" onPress={() => setCreating(true)}>Create {initialData.id === "customers" ? "customer" : initialData.id === "organizations" ? "organization" : initialData.id === "opportunities" ? "opportunity" : initialData.id === "activities" ? "activity" : initialData.id === "conversations" ? "conversation" : initialData.id === "sequences" ? "sequence" : "automation"}</Button></div> : null}</header>
      {!initialData.canView ? <Callout title={`${copy.title} access is restricted`} tone="warning">Ask a workspace owner or administrator for the required CRM permission.</Callout> : <>
        <section aria-label={`${copy.title} summary`} className={styles.summary}>
          {summary.map((item) => <span data-attention={item.attention && Number(item.value) > 0 || undefined} key={item.label}>{item.icon}<strong>{item.value}</strong>{item.label}</span>)}
        </section>
        {failure ? <Callout title="Could not refresh CRM" tone="danger">{failure}</Callout> : null}
        {creating ? <CrmCreateDialog workspaceId={initialData.workspaceId} id={initialData.id} onClose={() => setCreating(false)} onSaved={() => reload()} /> : null}
        {linkedRecord ? <InspectorSheet isOpen title="Record details" size="md" onOpenChange={(open) => { if (!open) setLinkedRecord(undefined); }}><LinkedRecordWorkbench workspaceId={initialData.workspaceId} id={initialData.id} recordId={linkedRecord} onChanged={() => reload()} /></InspectorSheet> : null}
        {initialData.id === "opportunities" ? <Tabs selectedKey={section} onSelectionChange={setSection} items={[{ id: "records", label: "Opportunities", panel: null }, { id: "pipeline", label: "Pipelines & rules", panel: <PipelineSettings workspaceId={initialData.workspaceId} /> }]} /> : null}
        {initialData.id === "automations" ? <Tabs selectedKey={section} onSelectionChange={setSection} items={[{ id: "records", label: "Workflows", panel: null }, { id: "approvals", label: "Approvals", panel: <AutomationApprovals workspaceId={initialData.workspaceId} /> }]} /> : null}
        {initialData.id === "activities" ? <Link href="/workspace/crm/follow-ups?view=schedule">Open schedule</Link> : null}
        {section === "records" ? <><div className={styles.gridRegion}>
          <DataGrid
            ariaLabel={`CRM ${copy.noun}`}
            columns={columns}
            data={visibleItems}
            emptyDescription={initialData.id === "crm-overview" ? "There is no urgent CRM work in this view." : "Try another view or clear the table search and filters."}
            emptyTitle={initialData.id === "crm-overview" ? "You are all caught up" : `No ${copy.noun} in this view`}
            exportFileName={`wodana-${initialData.id}.csv`}
            getInspectorTitle={(row) => inspectorTitle(initialData.id, row)}
            getRowId={(row) => row.id}
            pageSize={25}
            persistKey={`crm-${initialData.id}`}
            renderInspector={(row) => <CrmRecordWorkbench id={initialData.id} workspaceId={initialData.workspaceId} row={data.items.find((item) => item.id === row.id) ?? row} onChanged={() => reload()} />}
            savedViews={views}
            selectedView={view}
            onViewChange={setView}
          />
        </div>
        <footer className={styles.pageFooter}>{data.nextCursor ? `Showing the first ${data.items.length} ${copy.noun}. Load more to include the remaining records.` : `All ${data.items.length} loaded ${copy.noun} are shown.`}{data.nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>Load more</Button> : null}</footer></> : null}
      </>}
    </section>
  </DesignSystemProvider>;
}
