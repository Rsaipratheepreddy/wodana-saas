"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, CalendarDays, CheckCheck, Clock3, EllipsisVertical, MessageSquareText, UserRound } from "lucide-react";
import { Avatar, Button, DataGrid, IconMenuButton, Tabs, type DataGridColumn } from "@/design-system";
import { label, type RecordData } from "@/lib/crm/client";
import { crmRecordLink, crmTime } from "./crm-product-shell";
import styles from "./crm-priority-queue.module.css";

const PREVIEW_LIMIT = 5;
const groups = [
  { id: "all", label: "All" },
  { id: "replies", label: "Replies" },
  { id: "attention", label: "Needs attention" },
  { id: "today", label: "Today & meetings" },
];

function matches(item: RecordData, group: string) {
  if (group === "all") return true;
  if (group === "replies") return item.kind === "customer_reply";
  if (group === "attention") return ["overdue_activity", "sla_breach", "stale_lead", "stale_opportunity"].includes(String(item.kind));
  return ["due_today", "meeting_preparation"].includes(String(item.kind));
}

function priorityState(kind: unknown) {
  if (kind === "sla_breach") return { title: "SLA breached", tone: "danger", icon: AlarmClock };
  if (kind === "overdue_activity") return { title: "Overdue", tone: "danger", icon: AlarmClock };
  if (kind === "customer_reply") return { title: "Reply needed", tone: "reply", icon: MessageSquareText };
  if (kind === "stale_lead" || kind === "stale_opportunity") return { title: "Follow up", tone: "attention", icon: Clock3 };
  if (kind === "meeting_preparation") return { title: "Upcoming", tone: "scheduled", icon: CalendarDays };
  if (kind === "due_today") return { title: "Due today", tone: "scheduled", icon: Clock3 };
  return { title: "To do", tone: "scheduled", icon: Clock3 };
}

function clientName(item: RecordData) {
  const name = typeof item.partyName === "string" && item.partyName.trim() ? item.partyName : null;
  return name ?? (["customer_reply", "sla_breach", "stale_lead"].includes(String(item.kind)) ? String(item.title ?? "Client not linked") : "Client not linked");
}

function taskTitle(item: RecordData) {
  const state = priorityState(item.kind);
  return ["customer_reply", "sla_breach", "stale_lead"].includes(String(item.kind)) ? String(item.reason ?? state.title) : String(item.title ?? "CRM follow-up");
}

export function CrmPriorityQueue({ items, total }: { items: RecordData[]; total: number }) {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const filtered = items.filter((item) => matches(item, tab));
  const visible = expanded ? filtered : filtered.slice(0, PREVIEW_LIMIT);
  const columns: DataGridColumn<RecordData>[] = [
    { id: "client", accessorFn: clientName, header: "Client", size: 215, meta: { primary: true }, cell: ({ row }) => { const item = row.original; const name = clientName(item); return <Link href={crmRecordLink(item)} className={styles.client}>{name !== "Client not linked" ? <Avatar name={name} size="md" /> : <span className={styles.unknownAvatar}><UserRound aria-hidden="true" size={18} /></span>}<span><strong>{name}</strong><small>{label(item.partyLifecycle, name !== "Client not linked" ? "Client" : "CRM follow-up")}</small></span></Link>; } },
    { id: "task", accessorFn: taskTitle, header: "Next action", size: 235, cell: ({ row }) => { const item = row.original; const title = taskTitle(item); return <><Link href={crmRecordLink(item)} className={styles.task}>{title}</Link>{item.reason && item.reason !== title ? <small className={styles.reason}>{String(item.reason)}</small> : null}</>; } },
    { id: "due", accessorFn: (item) => String(item.dueAt ?? ""), header: "When", size: 140, cell: ({ row }) => { const item = row.original; const due = typeof item.dueAt === "string" && Number.isFinite(Date.parse(item.dueAt)) ? item.dueAt : undefined; return <><small className={styles.reason}>{item.kind === "customer_reply" ? "Received" : "Due"}</small><time className={styles.due} dateTime={due}>{crmTime(due)}</time></>; } },
    { id: "status", accessorFn: (item) => priorityState(item.kind).title, header: "Status", size: 145, cell: ({ row }) => { const state = priorityState(row.original.kind); const StateIcon = state.icon; return <span className={styles.status} data-tone={state.tone}><StateIcon aria-hidden="true" size={13} />{state.title}</span>; } },
    { id: "action", header: "Action", size: 90, enableSorting: false, cell: ({ row }) => { const item = row.original; const name = clientName(item); const recordHref = crmRecordLink(item); const partyId = String(item.resolvedPartyId ?? item.partyId ?? ""); const partyHref = item.canViewParty === true && /^[\da-f-]{36}$/i.test(partyId) ? `/workspace/crm/customers?record=${partyId}` : null; return <IconMenuButton ariaLabel={`Actions for ${name}: ${taskTitle(item)}`} icon={<EllipsisVertical aria-hidden="true" size={16} />} items={[{ id: "record", label: "Open follow-up" }, ...(partyHref ? [{ id: "client", label: "View client profile" }] : [])]} onAction={(action) => router.push(action === "client" && partyHref ? partyHref : recordHref)} />; } },
  ];

  return <section aria-label="Your priorities" className={styles.queue}>
    <header className={styles.heading}>
      <div><h2>Your priorities <span className={styles.count}>{total}</span></h2><p>Assigned to you, plus unassigned customer replies.</p></div>
      {filtered.length > PREVIEW_LIMIT ? <Button size="compact" variant="quiet" aria-expanded={expanded} onPress={() => setExpanded(!expanded)}>{expanded ? "Show less" : `View all (${filtered.length})`}</Button> : null}
    </header>
    <div className={styles.body}>
      <div className={styles.tabs}><Tabs selectedKey={tab} onSelectionChange={(key) => { setTab(key); setExpanded(false); }} items={groups.map((group) => ({ id: group.id, label: `${group.label} (${items.filter((item) => matches(item, group.id)).length})`, panel: null }))} /></div>
      {total > items.length ? <p className={styles.limitNotice}>Showing the {items.length} highest-priority items of {total}. Open the related CRM section for the full queue.</p> : null}
      {visible.length ? <DataGrid ariaLabel="Client priorities" columns={columns} data={visible} getRowId={(item) => String(item.id)} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} /> : <div className={styles.empty}><CheckCheck aria-hidden="true" size={28} /><h3>You’re caught up in this view</h3><p>New replies and scheduled work appear here when you refresh.</p></div>}
      {filtered.length ? <footer className={styles.footer} aria-live="polite">{visible.length} of {filtered.length} {tab === "all" ? "priorities" : "in this view"}</footer> : null}
    </div>
  </section>;
}
