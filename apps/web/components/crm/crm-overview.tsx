"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, CalendarClock, CheckCircle2, FileText, Inbox, Plus, RefreshCw, TrendingUp, Users } from "lucide-react";
import { Button, Callout, SelectField } from "@/design-system";
import { crmRequest, label, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell, crmRecordLink, crmTime } from "./crm-product-shell";
import styles from "./crm-overview.module.css";

type SourceRow = { monthKey: string; monthLabel: string; source: string; count: number };
type OverviewResponse = RecordData & { summary?: Record<string, unknown>; total?: number; monthlyLeadSources?: SourceRow[] };
const palette = ["#5789d6", "#9770d4", "#e6a146", "#4ea88c", "#d77294", "#659eae"];
const value = (v: unknown) => v == null ? "—" : Number(v).toLocaleString();

export function CrmOverview({ initialData }: { initialData: CrmScreenPageData }) {
  const [items, setItems] = useState(initialData.items);
  const [summary, setSummary] = useState((initialData.supporting.summary ?? {}) as Record<string, unknown>);
  const [sources, setSources] = useState((initialData.supporting.monthlyLeadSources ?? []) as SourceRow[]);
  const [total, setTotal] = useState(Number(initialData.supporting.total ?? items.length));
  const [attentionFilter, setAttentionFilter] = useState("all");
  const [month, setMonth] = useState("all");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const refresh = async () => {
    if (busy) return;
    setBusy(true); setFailure("");
    try {
      const result = await crmRequest<OverviewResponse>(initialData.workspaceId, "today");
      const incoming = rows(result).map(item => ({ ...item, id: `${item.kind}-${item.recordId}` }));
      setItems(incoming); setSummary(result.summary ?? {}); setSources(result.monthlyLeadSources ?? []); setTotal(Number(result.total ?? incoming.length));
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not refresh overview."); }
    finally { setBusy(false); }
  };
  const attentionItems = items.filter(item => attentionFilter === "all" || item.kind === "overdue_activity" || item.kind === "sla_breach");
  const months = [...new Map(sources.map(row => [row.monthKey, row.monthLabel])).entries()];
  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of sources.filter(row => month === "all" || row.monthKey === month)) counts.set(row.source, (counts.get(row.source) ?? 0) + Number(row.count));
    return [...counts].filter(([,count]) => count > 0).sort((a,b) => b[1] - a[1]);
  }, [sources, month]);
  const sourceTotal = distribution.reduce((sum, [,count]) => sum + count, 0);
  let offset = 0;
  const gradient = distribution.map(([,count], i) => { const start = offset; offset += count / sourceTotal * 100; return `${palette[i % palette.length]} ${start}% ${offset}%`; }).join(", ");
  const metrics = [
    { key: "activeLeads", title: "Active enquiries", caption: "Requests being worked on", href: "/workspace/crm/leads", Icon: Inbox },
    { key: "openOpportunities", title: "Open opportunities", caption: "Opportunities in your pipeline", href: "/workspace/crm/opportunities", Icon: TrendingUp },
    { key: "pendingFollowUps", title: "Pending follow-ups", caption: "Scheduled calls and tasks", href: "/workspace/crm/follow-ups", Icon: CalendarClock },
    { key: "wonThisMonth", title: "Won this month", caption: "Closed sales this month", href: "/workspace/crm/opportunities", Icon: CheckCircle2 },
  ];
  const trend = months.map(([key, title]) => ({ key, title, count: sources.filter(row => row.monthKey === key).reduce((sum,row) => sum + Number(row.count),0) }));
  const max = Math.max(1,...trend.map(row => row.count));
  return <CrmProductShell title="Sales" description="" canView={initialData.canView} useWorkspaceColors compact pageClassName={styles.page}>
    <div className={styles.toolbar}><div><h1>Sales</h1><p>Keep every enquiry moving toward a decision.</p></div><Button size="compact" aria-label="Refresh Sales" isLoading={busy} onPress={() => void refresh()}><RefreshCw size={14}/>Refresh</Button></div>
    {failure && <Callout title="Could not refresh overview" tone="warning">{failure}</Callout>}
    <section className={styles.metrics} aria-label="Sales summary">{metrics.map(({key,title,href,Icon},i) => <Link key={key} href={href}><span className={styles.metricIcon} data-tone={i}><Icon size={20}/></span><div><strong>{value(summary[key])}</strong><span>{title}</span></div></Link>)}</section>
    <section className={styles.quickActions} aria-label="Quick actions"><h2>Quick actions</h2><div>
      <Link href="/workspace/crm/leads?create=true"><Plus size={15}/>Add enquiry</Link><Link href="/workspace/crm/opportunities"><TrendingUp size={15}/>Review pipeline</Link><Link href="/workspace/crm/follow-ups"><BellRing size={15}/>Manage follow-ups</Link><Link href="/workspace/crm/leads?section=forms"><FileText size={15}/>Manage forms</Link><Link href="/workspace/crm/customers"><Users size={15}/>Clients</Link>
    </div></section>
    <div className={styles.widgets}>
      {sourceTotal > 0 && <section className={styles.widget} aria-label="Enquiry sources"><header><div><h2>Enquiry sources</h2><p>Where your customer requests come from</p></div><SelectField label={null} aria-label="Source chart period" selectedKey={month} onSelectionChange={key => setMonth(String(key))} items={[{id:"all",label:"Last six months"},...months.map(([id,text]) => ({id,label:`${text} ${id.slice(0,4)}`}))]}/></header>
        {sourceTotal ? <div className={styles.sourceBody}><div className={styles.donut} style={{background:`conic-gradient(${gradient})`}} role="img" aria-label={`${sourceTotal} enquiries: ${distribution.map(([source,count]) => `${label(source)} ${count}`).join(", ")}`}><div><strong>{sourceTotal}</strong><span>Enquiries</span></div></div><ul className={styles.legend}>{distribution.map(([source,count],i) => <li key={source}><i style={{background:palette[i % palette.length]}}/><span>{label(source)}</span><strong>{count}</strong><small>{Math.round(count/sourceTotal*100)}%</small></li>)}</ul></div> : <p className={styles.empty}>No enquiries in this period. New enquiries will appear here automatically.</p>}
      </section>}
      <section className={`${styles.widget} ${styles.priority}`} aria-label="Needs attention"><header><div><h2>Needs attention <span className={styles.count}>{total}</span></h2><p>Your reminders and customer requests</p></div><Link href="/workspace/crm/follow-ups">View all <ArrowRight size={13}/></Link></header><div className={styles.attentionFilters}>{["all", "urgent"].map(filter => <button key={filter} aria-pressed={attentionFilter === filter} onClick={() => setAttentionFilter(filter)}>{filter === "all" ? "All work" : "Overdue & urgent"}</button>)}</div><div className={styles.attention}>{attentionItems.slice(0,5).map(item => <Link key={item.id} href={crmRecordLink(item)} data-urgent={item.kind === "overdue_activity" || item.kind === "sla_breach"}><span className={styles.attentionIcon} data-urgent={item.kind === "overdue_activity" || item.kind === "sla_breach"}><CalendarClock size={17}/></span><div><strong>{String(item.title ?? item.partyName ?? "Follow-up")}</strong><small>{String(item.reason ?? label(item.kind))}</small></div><time>{crmTime(item.dueAt)}</time></Link>)}{!attentionItems.length && <div className={styles.empty}><CheckCircle2 size={28}/><p>{attentionFilter === "urgent" ? "No overdue or urgent work in this list." : "No follow-ups need attention."}</p><Link href="/workspace/crm/leads?create=true">Create an enquiry <ArrowRight size={14}/></Link></div>}</div></section>
      {trend.length > 0 && <section className={styles.widget} aria-label="Enquiry trend"><header><div><h2>Enquiry trend</h2><p>New requests each month · last six months</p></div><Link href="/workspace/crm/leads">Enquiries <ArrowRight size={13}/></Link></header><div className={styles.trend}>{trend.map(row => <div key={row.key}><span>{row.count}</span><div style={{height:`${Math.max(2,row.count/max*130)}px`}}/><small>{row.title}</small></div>)}</div>{!trend.length && <p className={styles.empty}>Monthly activity will appear as enquiries arrive.</p>}</section>}
      <section className={styles.widget} aria-label="Customer and assignment summary"><header><div><h2>Keep work moving</h2><p>Ownership and customer relationships</p></div></header><Link className={styles.healthRow} href="/workspace/crm/leads"><span><Users size={17}/>Unassigned enquiries</span><strong>{value(summary.unassignedLeads)}</strong><ArrowRight size={15}/></Link><Link className={styles.healthRow} href="/workspace/crm/customers"><span><CheckCircle2 size={17}/>Active customers</span><strong>{value(summary.customers)}</strong><ArrowRight size={15}/></Link><div className={styles.flow}><strong>From first request to delivery</strong><p>Enquiry → Opportunity → Design &amp; Planning → Project</p><small>The same client stays linked throughout. Projects begin after quotation acceptance and release.</small></div></section>
    </div>
  </CrmProductShell>;
}
