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
  EmptyState,
  InspectorSheet,
  ListTabs,
  NoAccessState,
  NoResultsState,
  PageShell,
  Tabs,
  DesignSystemProvider,
  formatDate,
  formatMoney,
  useDesignSystem,
  type DataGridColumn,
  TypeChip,
} from "@/design-system";
import type { CrmRecord, CrmScreenId, CrmScreenPageData } from "@/lib/crm/screens";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import styles from "./crm-screen-page.module.css";
import { crmRequest, rows } from "@/lib/crm/client";
import { CrmRecordWorkbench, CrmCreateDialog, LinkedRecordWorkbench } from "./crm-record-workbench";
import { PipelineSettings } from "./pipeline-settings";
import { CrmOverview } from "./crm-overview";
import { CrmInbox } from "./crm-inbox";
import { CrmSmartRules } from "./crm-smart-rules";
import { CrmFollowUps } from "./crm-follow-ups";
import { CrmCalendar } from "./crm-calendar";

/** The workspace region: dates, times and money follow it. */
type Region = { locale: string; timeZone: string; currency: string };

const screenCopy: Record<CrmScreenId, { title: MessageKey; description: MessageKey; noun: MessageKey }> = {
  "crm-overview": { title: tKey("Today"), description: tKey("Customer work that needs attention now."), noun: tKey("priorities") },
  "follow-ups": { title: tKey("Follow-ups"), description: tKey("Keep every promised call, task, and client reminder visible."), noun: tKey("follow-ups") },
  calendar: { title: tKey("Calendar"), description: tKey("See CRM commitments and connected Google events."), noun: tKey("events") },
  customers: { title: tKey("Customers"), description: tKey("People and companies linked to enquiries and opportunities."), noun: tKey("customers") },
  organizations: { title: tKey("Companies"), description: tKey("Companies connected to enquiries, stakeholders, and commercial work."), noun: tKey("companies") },
  opportunities: { title: tKey("Opportunities"), description: tKey("Qualified enquiries moving to a commercial decision or planning."), noun: tKey("opportunities") },
  activities: { title: tKey("Activities"), description: tKey("Coordinate calls, meetings, tasks, notes, and the next customer commitment."), noun: tKey("activities") },
  conversations: { title: tKey("Inbox"), description: tKey("Customer conversations and messages awaiting a response."), noun: tKey("conversations") },
  sequences: { title: tKey("Sequences"), description: tKey("Organize consistent, respectful follow-up across email, WhatsApp, and team tasks."), noun: tKey("sequences") },
  automations: { title: tKey("Automations"), description: tKey("Monitor CRM workflows, their publishing state, and recent execution health."), noun: tKey("automations") },
};

const viewLabels: Record<string, MessageKey> = {
  all: tKey("All"), customer_reply: tKey("Customer Reply"), overdue_activity: tKey("Overdue Activity"), due_today: tKey("Due Today"),
  customer: tKey("Customer"), prospect: tKey("Prospect"), archived: tKey("Archived"), open: tKey("Open"), won: tKey("Won"), lost: tKey("Lost"),
  pending: tKey("Pending"), overdue: tKey("Overdue"), completed: tKey("Completed"), unread: tKey("Unread"), closed: tKey("Closed"),
  active: tKey("Active"), draft: tKey("Draft"), paused: tKey("Paused"),
};

function value(row: CrmRecord, key: string): unknown { return row[key]; }
function text(row: CrmRecord, key: string, fallback: string) {
  const current = value(row, key);
  return typeof current === "string" && current.trim() ? current : fallback;
}
function numeric(row: CrmRecord, key: string) {
  const current = Number(value(row, key));
  return Number.isFinite(current) ? current : 0;
}
function bool(row: CrmRecord, key: string) { return value(row, key) === true; }
function list(row: CrmRecord, key: string) { return Array.isArray(value(row, key)) ? value(row, key) as Array<Record<string, unknown>> : []; }

function humanize(t: Translate, input: unknown) {
  if (typeof input !== "string" || !input) return t("Not set");
  return input.split(/[_-]+/).filter(Boolean).map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}

function statusTone(status: unknown) {
  if (["active", "completed", "won", "qualified", "open", "delivered", "sent"].includes(String(status))) return "success" as const;
  if (["pending", "draft", "paused", "queued", "attempting_contact", "warning", "normal"].includes(String(status))) return "warning" as const;
  if (["failed", "lost", "cancelled", "archived", "breached", "disqualified", "urgent", "high"].includes(String(status))) return "danger" as const;
  if (["running", "new", "connected", "nurturing"].includes(String(status))) return "info" as const;
  return "neutral" as const;
}

function dateLabel(input: unknown, region: Region, fallback: string) {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input))) return fallback;
  return formatDate(input, region, { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeLabel(input: unknown, region: Region, fallback: string) {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input))) return fallback;
  return formatDate(input, region, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function moneyLabel(t: Translate, region: Region, row: CrmRecord, key = "amount") {
  if (value(row, key) === null || value(row, key) === undefined) return t("Not available");
  const amount = Number(value(row, key));
  if (!Number.isFinite(amount)) return t("Restricted");
  return formatMoney(amount, { currency: text(row, key === "amount" ? "currencyCode" : "currency", region.currency), locale: region.locale });
}

/** The primary email or phone, or null when none is recorded. */
function primaryContact(row: CrmRecord, type: "email" | "phone") {
  const matches = list(row, "contacts").filter((contact) => contact.type === type);
  const selected = matches.find((contact) => contact.isPrimary) ?? matches[0];
  return typeof selected?.rawValue === "string" ? selected.rawValue : null;
}

function pipelineTotals(t: Translate, region: Region, items: CrmRecord[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.status !== "open" || item.amount === null || item.amount === undefined) continue;
    const currency = String(item.currencyCode ?? item.currency_code ?? "");
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Number(item.amount))) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + Number(item.amount));
  }
  return [...totals].map(([currency, amount]) => formatMoney(amount, { currency, locale: region.locale })).join(" · ") || t("Not available");
}

function Identity({ name, detail, icon }: { name: string; detail?: string; icon?: ReactNode }) {
  return <span className={styles.identity}>
    {icon ?? <Avatar name={name} size="sm" />}
    <span><strong>{name}</strong>{detail ? <small>{detail}</small> : null}</span>
  </span>;
}

function Chip({ children }: { children: ReactNode }) { return <span className={styles.chip}>{children}</span>; }
function State({ status }: { status: unknown }) { const t = useT(); return <Badge tone={statusTone(status)}>{humanize(t, status)}</Badge>; }

function columnsFor(id: CrmScreenId, referenceTime: number, t: Translate, region: Region): DataGridColumn<CrmRecord>[] {
  const notSet = t("Not set");
  const notAdded = t("Not added");
  if (id === "crm-overview") return [
    { accessorKey: "title", header: t("Customer or task"), size: 260, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title", notSet)} detail={humanize(t, value(row.original, "kind"))} /> },
    { accessorKey: "reason", header: t("Why it matters"), size: 280 },
    { accessorKey: "kind", header: t("Priority type"), size: 160, cell: ({ row }) => <State status={value(row.original, "kind")} /> },
    { accessorKey: "dueAt", header: t("Due"), size: 150, cell: ({ row }) => <DueCell value={value(row.original, "dueAt")} referenceTime={referenceTime} /> },
  ];
  if (id === "customers" || id === "organizations") return [
    { accessorKey: "displayName", header: id === "customers" ? t("Customer") : t("Organization"), size: 250, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "displayName", notSet)} detail={primaryContact(row.original, "email") ?? notAdded} icon={id === "organizations" || row.original.type === "organization" ? <span className={styles.recordIcon}><Building2 size={16} /></span> : undefined} /> },
    ...(id === "customers" ? [{ accessorKey: "type", header: t("Type"), size: 120, cell: ({ row }: { row: { original: CrmRecord } }) => <TypeChip hue={row.original.type === "organization" ? 1 : 2}>{row.original.type === "organization" ? t("Company") : t("Person")}</TypeChip> }] : []),
    { accessorKey: "lifecycle", header: t("Lifecycle"), size: 130, cell: ({ row }) => <Chip>{humanize(t, value(row.original, "lifecycle"))}</Chip> },
    { id: "email", accessorFn: (row) => primaryContact(row, "email") ?? notAdded, header: t("Email"), size: 220, cell: ({ row }) => <span className={styles.contact}><Mail size={13} />{primaryContact(row.original, "email") ?? notAdded}</span> },
    { id: "phone", accessorFn: (row) => primaryContact(row, "phone") ?? notAdded, header: t("Phone"), size: 155, cell: ({ row }) => primaryContact(row.original, "phone") ?? notAdded },
    { accessorKey: "status", header: t("Status"), size: 110, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "updatedAt", header: t("Updated"), size: 130, cell: ({ row }) => dateLabel(value(row.original, "updatedAt"), region, t("Not scheduled")) },
  ];
  if (id === "opportunities") return [
    { accessorKey: "title", header: t("Opportunity"), size: 270, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title", notSet)} detail={text(row.original, "partyName", notSet)} /> },
    { accessorKey: "stageName", header: t("Stage"), size: 135, cell: ({ row }) => <Chip>{text(row.original, "stageName", notSet)}</Chip> },
    { accessorKey: "status", header: t("Status"), size: 100, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "amount", header: t("Value"), size: 135, meta: { align: "end" }, cell: ({ row }) => <strong className={styles.money}>{moneyLabel(t, region, row.original)}</strong> },
    { accessorKey: "probability", header: t("Probability"), size: 110, meta: { align: "center" }, cell: ({ row }) => new Intl.NumberFormat(region.locale, { style: "percent", maximumFractionDigits: 2 }).format(numeric(row.original, "probability") / 100) },
    { accessorKey: "ownerName", header: t("Sales owner"), size: 150, cell: ({ row }) => text(row.original, "ownerName", t("Unassigned")) },
    { accessorKey: "expectedCloseAt", header: t("Expected close"), size: 135, cell: ({ row }) => dateLabel(value(row.original, "expectedCloseAt"), region, t("Not scheduled")) },
    { accessorKey: "nextActionAt", header: t("Next action"), size: 130, cell: ({ row }) => <DueCell value={value(row.original, "nextActionAt")} referenceTime={referenceTime} /> },
  ];
  if (id === "activities") return [
    { accessorKey: "title", header: t("Activity"), size: 315, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "title", notSet)} detail={humanize(t, value(row.original, "type"))} icon={<span className={styles.recordIcon}><Activity size={16} /></span>} /> },
    { accessorKey: "status", header: t("Status"), size: 115, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "priority", header: t("Priority"), size: 110, cell: ({ row }) => <State status={value(row.original, "priority")} /> },
    { accessorKey: "ownerName", header: t("Sales owner"), size: 160, cell: ({ row }) => text(row.original, "ownerName", t("Unassigned")) },
    { accessorKey: "dueAt", header: t("Due"), size: 145, cell: ({ row }) => <DueCell value={value(row.original, "dueAt")} referenceTime={referenceTime} /> },
    { accessorKey: "isNextAction", header: t("Commitment"), size: 125, cell: ({ row }) => bool(row.original, "isNextAction") ? <Badge tone="info">{t("Next action")}</Badge> : <span className={styles.muted}>{t("Supporting")}</span> },
    { accessorKey: "customerVisible", header: t("Visibility"), size: 120, cell: ({ row }) => <Chip>{bool(row.original, "customerVisible") ? t("Customer") : t("Internal")}</Chip> },
  ];
  if (id === "conversations") return [
    { accessorKey: "partyName", header: t("Conversation"), size: 265, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "partyName", t("Internal team"))} detail={text(row.original, "subject", t("No subject"))} /> },
    { accessorKey: "channel", header: t("Channel"), size: 110, cell: ({ row }) => <Chip>{humanize(t, value(row.original, "channel"))}</Chip> },
    { accessorKey: "lastMessageText", header: t("Latest message"), size: 320, cell: ({ row }) => <span className={styles.messagePreview}>{text(row.original, "lastMessageText", t("No messages yet"))}</span> },
    { accessorKey: "lastMessageDirection", header: t("Direction"), size: 110, cell: ({ row }) => humanize(t, value(row.original, "lastMessageDirection")) },
    { accessorKey: "unreadCount", header: t("Unread"), size: 90, meta: { align: "center" }, cell: ({ row }) => numeric(row.original, "unreadCount") ? <Badge tone="info">{numeric(row.original, "unreadCount")}</Badge> : <span className={styles.muted}>0</span> },
    { accessorKey: "status", header: t("Status"), size: 100, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "lastMessageAt", header: t("Last activity"), size: 140, cell: ({ row }) => dateTimeLabel(value(row.original, "lastMessageAt"), region, t("No activity")) },
  ];
  if (id === "sequences") return [
    { accessorKey: "name", header: t("Sequence"), size: 280, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "name", notSet)} detail={t("{count} steps", { count: list(row.original, "steps").length })} icon={<span className={styles.recordIcon}><Sparkles size={16} /></span>} /> },
    { accessorKey: "status", header: t("Status"), size: 120, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { id: "channels", accessorFn: (row) => list(row, "steps").map((step) => step.type).join(", "), header: t("Flow"), size: 260, cell: ({ row }) => <span className={styles.stepFlow}>{list(row.original, "steps").map((step, index) => <Chip key={String(step.id ?? index)}>{humanize(t, step.type)}</Chip>)}</span> },
    { id: "duration", accessorFn: (row) => list(row, "steps").reduce((total, step) => total + Number(step.delayMinutes ?? 0), 0), header: t("Duration"), size: 120, cell: ({ row }) => durationLabel(t, list(row.original, "steps").reduce((total, step) => total + Number(step.delayMinutes ?? 0), 0)) },
    { id: "exits", accessorFn: (row) => Object.keys((value(row, "exitConditions") as Record<string, unknown>) ?? {}).join(", "), header: t("Stops when"), size: 220, cell: ({ row }) => Object.keys((value(row.original, "exitConditions") as Record<string, unknown>) ?? {}).map((condition) => humanize(t, condition)).join(" · ") || t("Manually stopped") },
    { accessorKey: "version", header: t("Version"), size: 90, meta: { align: "center" } },
  ];
  if (id === "automations") return [
    { accessorKey: "name", header: t("Automation"), size: 300, meta: { primary: true }, cell: ({ row }) => <Identity name={text(row.original, "name", notSet)} detail={text(row.original, "description", humanize(t, value(row.original, "code")))} icon={<span className={styles.recordIcon}><Bot size={16} /></span>} /> },
    { accessorKey: "status", header: t("Status"), size: 115, cell: ({ row }) => <State status={value(row.original, "status")} /> },
    { accessorKey: "code", header: t("Event flow"), size: 210, cell: ({ row }) => <Chip>{humanize(t, value(row.original, "code"))}</Chip> },
    { accessorKey: "runOncePerAggregate", header: t("Run policy"), size: 160, cell: ({ row }) => bool(row.original, "runOncePerAggregate") ? t("Once per record") : t("When triggered") },
    { accessorKey: "activeVersionNumber", header: t("Published"), size: 115, meta: { align: "center" }, cell: ({ row }) => value(row.original, "activeVersionNumber") ? `v${numeric(row.original, "activeVersionNumber")}` : <span className={styles.muted}>{t("Not yet")}</span> },
    { accessorKey: "version", header: t("Revision"), size: 100, meta: { align: "center" }, cell: ({ row }) => `v${numeric(row.original, "version")}` },
  ];
  return [
    { accessorKey: "report", header: t("Report"), size: 130, cell: ({ row }) => <Chip>{humanize(t, value(row.original, "report"))}</Chip> },
    { id: "dimension", accessorFn: (row) => reportDimension(t, row), header: t("Dimension"), size: 230, meta: { primary: true }, cell: ({ row }) => <Identity name={reportDimension(t, row.original)} detail={reportBreakdown(t, row.original)} icon={<span className={styles.recordIcon}><CircleDollarSign size={16} /></span>} /> },
    { id: "records", accessorFn: reportRecords, header: t("Records"), size: 120, meta: { align: "end" }, cell: ({ row }) => reportRecords(row.original) },
    { id: "progress", accessorFn: (row) => reportProgress(t, region, row), header: t("Progress"), size: 180, cell: ({ row }) => reportProgress(t, region, row.original) },
    { id: "reportValue", accessorFn: (row) => reportValue(t, region, row), header: t("Value"), size: 160, meta: { align: "end" }, cell: ({ row }) => reportValue(t, region, row.original) },
  ];
}

function DueCell({ value, referenceTime }: { value: unknown; referenceTime: number }) {
  const t = useT();
  const { locale, timeZone, currency } = useDesignSystem();
  const overdue = typeof value === "string" && Date.parse(value) < referenceTime;
  return <span className={styles.due} data-overdue={overdue || undefined}><CalendarClock size={13} />{dateLabel(value, { locale, timeZone, currency }, t("Not scheduled"))}</span>;
}

function durationLabel(t: Translate, minutes: number) {
  if (minutes >= 1440) return t("{count} days", { count: Math.round(minutes / 1440) });
  if (minutes >= 60) return t("{count} hours", { count: Math.round(minutes / 60) });
  return t("{count} min", { count: minutes });
}

function reportDimension(t: Translate, row: CrmRecord) { return text(row, "source", text(row, "pipeline", text(row, "stage", text(row, "owner", text(row, "status", text(row, "currency", t("Overview"))))))); }
function reportBreakdown(t: Translate, row: CrmRecord) { return humanize(t, value(row, "channel") ?? value(row, "stage") ?? value(row, "method") ?? value(row, "status") ?? value(row, "report")); }
function reportRecords(row: CrmRecord) { return numeric(row, "enquiries") || numeric(row, "count") || numeric(row, "leads") || 0; }
function reportProgress(t: Translate, region: Region, row: CrmRecord) {
  if (value(row, "opportunities") !== undefined) return t("{leads} enquiries · {opportunities} opportunities · {won} won", { leads: numeric(row, "leads"), opportunities: numeric(row, "opportunities"), won: numeric(row, "won") });
  if (value(row, "averageMinutes") !== undefined) return t("{minutes} min average", { minutes: numeric(row, "averageMinutes") });
  if (value(row, "weightedAmount") !== undefined) return t("Weighted {amount}", { amount: moneyLabel(t, region, row, "weightedAmount") });
  return humanize(t, value(row, "status") ?? value(row, "report"));
}
function reportValue(t: Translate, region: Region, row: CrmRecord) {
  if (value(row, "value") !== undefined) return moneyLabel(t, region, row, "value");
  if (value(row, "amount") !== undefined) return moneyLabel(t, region, row, "amount");
  return "—";
}

/** The lists under the title; a count shows only on a list that asks for action (overdue, unread). */
function tabsFor(id: CrmScreenId, items: CrmRecord[], referenceTime: number, t: Translate): Array<{ id: string; label: string; count?: number }> {
  const views = id === "crm-overview" ? ["all", "customer_reply", "overdue_activity", "due_today"]
    : id === "customers" || id === "organizations" ? ["all", "customer", "prospect", "archived"]
    : id === "opportunities" ? ["all", "open", "won", "lost"]
    : id === "activities" ? ["all", "pending", "overdue", "completed"]
    : id === "conversations" ? ["all", "unread", "open", "closed"]
    : id === "sequences" || id === "automations" ? ["all", "active", "draft", "paused"] : [];
  const asksForAction = new Set(["overdue", "unread", "overdue_activity", "customer_reply"]);
  return views.map((view) => ({ id: view, label: viewLabels[view] ? t(viewLabels[view]) : humanize(t, view), ...(asksForAction.has(view) ? { count: filterFor(id, items, view, referenceTime).length } : {}) }));
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
  return items.filter((item) => value(item, "status") === view);
}

function inspectorTitle(id: CrmScreenId, row: CrmRecord, t: Translate) {
  const notSet = t("Not set");
  if (id === "customers" || id === "organizations") return text(row, "displayName", notSet);
  if (["sequences", "automations"].includes(id)) return text(row, "name", notSet);
  if (id === "opportunities" || id === "activities") return text(row, "title", notSet);
  if (id === "conversations") return text(row, "subject", text(row, "partyName", notSet));
  return text(row, "title", notSet);
}

export function CrmScreenPage({ initialData, initialRecordId, initialCalendar = false, initialFollowUpList = false, initialCreate = false }: { initialFollowUpList?: boolean; initialData: CrmScreenPageData; initialRecordId?: string; initialCalendar?: boolean; initialCreate?: boolean }) {
  if (initialData.id === "crm-overview") return <CrmOverview key={initialData.workspaceId} initialData={initialData} />;
  if (initialData.id === "calendar" || (initialData.id === "follow-ups" && initialCalendar)) return <CrmCalendar key={initialData.workspaceId} workspaceId={initialData.workspaceId} currentUserId={String(initialData.supporting.currentUserId ?? "")} canView={initialData.canView} canManageBooking={initialData.supporting.canManageBooking === true} />;
  if (initialData.id === "follow-ups") return <CrmFollowUps initialLayout={initialFollowUpList ? "kanban" : "timeline"} tasksOnly={initialFollowUpList} key={initialData.workspaceId} initialData={initialData} initialRecordId={initialRecordId} initialCreate={initialCreate} />;
  if (initialData.id === "activities" && initialCalendar) redirect("/workspace/crm/follow-ups?view=schedule");
  if (initialData.id === "conversations") return <CrmInbox key={initialData.workspaceId} initialData={initialData} initialRecordId={initialRecordId} />;
  if (initialData.id === "automations") return <CrmSmartRules key={initialData.workspaceId} initialData={initialData} />;
  return <CrmTablePage key={`${initialData.workspaceId}/${initialData.id}`} initialData={initialData} initialRecordId={initialRecordId} initialCalendar={initialCalendar} />;
}

function CrmTablePage({ initialData, initialRecordId, initialCalendar = false }: { initialData: CrmScreenPageData; initialRecordId?: string; initialCalendar?: boolean }) {
  const t = useT();
  const { locale, timeZone, currency } = useDesignSystem();
  const region = useMemo(() => ({ locale, timeZone, currency }), [locale, timeZone, currency]);
  const [linkedRecord, setLinkedRecord] = useState(initialRecordId);
  const [section, setSection] = useState(initialCalendar ? "calendar" : "records");
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [data, setData] = useState(initialData);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [view, setView] = useState("all");
  const referenceTime = Date.parse(initialData.referenceTime);
  const copy = screenCopy[initialData.id];
  const title = t(copy.title);
  const noun = t(copy.noun);
  const tabs = useMemo(() => tabsFor(initialData.id, data.items, referenceTime, t), [initialData.id, data.items, referenceTime, t]);
  const visibleItems = useMemo(() => filterFor(initialData.id, data.items, view, referenceTime), [initialData.id, data.items, referenceTime, view]);
  const columns = useMemo(() => columnsFor(initialData.id, referenceTime, t, region), [initialData.id, referenceTime, t, region]);

  const reload = async (more = false) => {
    const endpoints: Partial<Record<CrmScreenId, string>> = { customers: "parties?limit=100", organizations: "parties?type=organization&limit=100", opportunities: "opportunities?limit=100", activities: "activities?limit=100", conversations: "conversations?limit=100", sequences: "sequences", automations: "automations", "crm-overview": "today" };
    const endpoint = endpoints[initialData.id];
    if (!endpoint) return;
    setBusy(true); setFailure("");
    try {
      const payload = await crmRequest<unknown>(initialData.workspaceId, endpoint + (more && data.nextCursor ? `&cursor=${encodeURIComponent(data.nextCursor)}` : ""));
      const incoming = rows(payload).map((row, index) => ({ ...row, id: initialData.id === "crm-overview" ? `${row.kind ?? "item"}-${row.recordId ?? index}` : String(row.id ?? row.recordId ?? index) }));
      setData((current) => ({ ...current, items: more ? [...current.items, ...incoming.filter((row) => !current.items.some((item) => item.id === row.id))] : incoming, nextCursor: (payload as { nextCursor?: string })?.nextCursor ?? null }));
    } catch (error) { setFailure(error instanceof Error ? error.message : t("CRM could not be refreshed.")); }
    finally { setBusy(false); }
  };
  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <PageShell aria-label={t("{title} workspace", { title })} title={title}
      tabs={initialData.canView && tabs.length && section === "records" ? <ListTabs label={t("{title} lists", { title })} items={tabs} value={view} onChange={setView} /> : undefined}>
      {!initialData.canView ? <NoAccessState area={title} /> : <>
        {failure ? <Callout title={t("Could not refresh CRM")} tone="danger">{failure}</Callout> : null}
        {creating ? <CrmCreateDialog workspaceId={initialData.workspaceId} id={initialData.id} onClose={() => setCreating(false)} onSaved={() => reload()} /> : null}
        {linkedRecord ? <InspectorSheet isOpen title={t("Record details")} size="md" onOpenChange={(open) => { if (!open) setLinkedRecord(undefined); }}><LinkedRecordWorkbench workspaceId={initialData.workspaceId} id={initialData.id} recordId={linkedRecord} onChanged={() => reload()} /></InspectorSheet> : null}
        {initialData.id === "opportunities" ? <Tabs selectedKey={section} onSelectionChange={setSection} items={[{ id: "records", label: t("Opportunities"), panel: null }, { id: "pipeline", label: t("Pipelines & rules"), panel: <PipelineSettings workspaceId={initialData.workspaceId} /> }]} /> : null}
        {section === "records" ? <DataGrid
            ariaLabel={t("CRM {items}", { items: noun })}
            columns={columns}
            data={visibleItems}
            emptyContent={view !== "all" ? <NoResultsState onClear={() => setView("all")} />
              : <EmptyState title={initialData.id === "crm-overview" ? t("You are all caught up") : t("No {items} yet", { items: noun })} />}
            exportFileName={`wodana-${initialData.id}.csv`}
            footerActions={<>{initialData.id === "activities" ? <Link href="/workspace/crm/follow-ups?view=schedule">{t("Open calendar")}</Link> : null}{data.nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more")}</Button> : null}</>}
            getInspectorTitle={(row) => inspectorTitle(initialData.id, row, t)}
            getRowId={(row) => row.id}
            hasMoreRows={Boolean(data.nextCursor)}
            pageSize={25}
            persistKey={`crm-${initialData.id}`}
            renderInspector={(row) => <CrmRecordWorkbench id={initialData.id} workspaceId={initialData.workspaceId} row={data.items.find((item) => item.id === row.id) ?? row} onChanged={() => reload()} />}
            rowNumbers={false}
            selectable={false}
          /> : null}
      </>}
    </PageShell>
  </DesignSystemProvider>;
}
