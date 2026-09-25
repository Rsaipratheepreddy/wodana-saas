"use client";

import { useEffect, useRef, useState } from "react";
import type { HomeOverview, HomeOverviewItem } from "@wodana/contracts";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, CalendarClock, Check, CircleCheck, ClipboardList, FileText, MessageSquare, Package, Plus, RefreshCw, Settings2, Users } from "lucide-react";
import { Button, ControlledModalDialog, DesignSystemProvider, useDesignSystem } from "@/design-system";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { defaultHomeLayout, homeActionLabel, homeActivityId, parseHomeLayout, type HomeWidget, type HomeWidgetId } from "@/lib/workspace/home-layout";
import { crmRecordLink, crmTime } from "@/components/crm/crm-product-shell";
import { FollowUpSheet, NewFollowUpDialog } from "@/components/crm/follow-up-editor";
import { WorkspaceReadiness, type ReadinessData } from "./workspace-readiness";
import { HomeAttendance } from "./home-attendance";
import s from "./workspace-home.module.css";

type Props = {
  workspaceId: string;
  userId: string;
  workspaceName: string;
  modules: string[];
  initialData: CrmScreenPageData | null;
  readiness?: ReadinessData;
  canManage?: boolean;
};
const widgetNames: Record<HomeWidgetId, string> = { attention: "Needs attention", planning: "In planning", projects: "Project work", tools: "Quick actions", sales: "Sales snapshot", attendance: "Attendance" };
type HomeTab = "overview" | "sales" | "planning" | "projects" | "people";
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";

export function WorkspaceHome(props: Props) {
  const inherited = useDesignSystem();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider {...inherited} portalContainer={portal}><div ref={setPortal}><HomeContent key={`${props.workspaceId}:${props.userId}`} {...props} /></div></DesignSystemProvider>;
}

function HomeContent({ workspaceId, userId, workspaceName, modules, initialData, readiness, canManage }: Props) {
  const crmEnabled = modules.includes("crm");
  const canView = crmEnabled && initialData?.canView !== false;
  const [layout, setLayout] = useState<HomeWidget[]>(defaultHomeLayout);
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [layoutReload, setLayoutReload] = useState(0);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const savingLayout = useRef(false);
  const [tab, setTab] = useState<HomeTab>("overview");
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewReload, setOverviewReload] = useState(0);
  const available = (id: HomeWidgetId) => id === "attendance" ? modules.includes("hrms") : id === "tools" ? true : id === "planning" ? modules.includes("pre-project") && overview?.sections?.planning !== false : id === "projects" ? modules.includes("projects") && overview?.sections?.projects !== false : canView;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HomeWidget[]>(layout);
  const [preferenceError, setPreferenceError] = useState("");
  const [data, setData] = useState(initialData);
  const [failure, setFailure] = useState(crmEnabled && !initialData ? "Your work could not be loaded. Try again." : "");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("all");
  const refresh = async () => {
    if (loading.current || !canView) return;
    loading.current = true; setBusy(true); setFailure("");
    try {
      const result = await crmRequest<RecordData>(workspaceId, "today");
      const items = rows(result).map((item, index) => ({ ...item, id: `${item.kind}-${item.recordId ?? index}` }));
      setData({ id: "crm-overview", canView: true, workspaceId, items, supporting: { summary: result.summary ?? {}, total: result.total ?? items.length }, nextCursor: null, referenceTime: new Date().toISOString() });
    } catch (error) { setFailure(error instanceof Error ? error.message : "Your work could not be refreshed."); }
    finally { loading.current = false; setBusy(false); }
  };
  const items = data?.canView ? data.items : [];
  const visibleItems = items.filter(item => filter === "all" || (filter === "messages" ? String(item.kind).includes("reply") : !String(item.kind).includes("reply")));
  const summary = (data?.canView ? data.supporting.summary ?? {} : {}) as Record<string, unknown>;
  const tools = [
    ...(modules.includes("pre-project") ? [
      { title: "Quotations", description: "Price scope and prepare client proposals", href: "/workspace/pre-projects?section=quotations", Icon: FileText },
      { title: "Catalog", description: "Items, materials, specifications and prices", href: "/workspace/catalogs", Icon: BookOpen },
      { title: "Requirements", description: "Capture the brief before pricing work", href: "/workspace/pre-projects?section=requirements", Icon: ClipboardList },
    ] : []),
    ...(crmEnabled ? [
      { title: "Inbox", description: "Read and reply to client conversations", href: "/workspace/crm/conversations", Icon: MessageSquare },
      { title: "Clients", description: "People, companies and their linked work", href: "/workspace/crm/customers", Icon: Users },
    ] : []),
    ...(modules.includes("projects") ? [{ title: "Projects", description: "Plan delivery and update progress", href: "/workspace/projects", Icon: Package }] : []),
  ];
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/home-layout?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Your saved Home layout could not be loaded."); return response.json(); })
      .then(result => { if (controller.signal.aborted) return; setLayout(parseHomeLayout(JSON.stringify(result.widgets))); setLayoutVersion(result.version); setPreferenceError(""); })
      .catch(error => { if (!controller.signal.aborted) { setLayoutVersion(null); setPreferenceError(error.message); } });
    return () => controller.abort();
  }, [workspaceId, userId, layoutReload]);
  useEffect(() => {
    const controller = new AbortController();
    setOverview(null); setOverviewError("");
    fetch(`/api/workspace/home-overview?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Your latest workspace overview could not be loaded."); return response.json() as Promise<HomeOverview>; })
      .then(result => { if (!controller.signal.aborted) { setOverview(result); setTab(previous => previous === "planning" && !result.sections.planning || previous === "projects" && !result.sections.projects ? "overview" : previous); } })
      .catch(error => { if (!controller.signal.aborted) setOverviewError(error instanceof Error ? error.message : "Overview unavailable."); });
    return () => controller.abort();
  }, [workspaceId, userId, overviewReload]);
  const saveLayout = async () => {
    if (savingLayout.current || layoutVersion === null) return;
    savingLayout.current = true; setLayoutBusy(true); setPreferenceError("");
    try {
      const response = await fetch("/api/workspace/home-layout", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, version: layoutVersion, widgets: draft }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setLayoutVersion(null); throw new Error(result.message ?? "Your Home layout could not be saved."); }
      setLayout(parseHomeLayout(JSON.stringify(result.widgets))); setLayoutVersion(result.version); setEditing(false);
    } catch (error) { setPreferenceError(error instanceof Error ? error.message : "Your Home layout could not be saved. Your choices are still here."); }
    finally { savingLayout.current = false; setLayoutBusy(false); }
  };
  const move = (id: HomeWidgetId, offset: number) => setDraft(previous => {
    const next = [...previous]; const index = next.findIndex(item => item.id === id);
    let target = index + offset;
    while (target >= 0 && target < next.length && !available(next[target].id)) target += offset;
    if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const tabs: { id: HomeTab; label: string; show: boolean }[] = [
    { id: "overview", label: "Overview", show: true },
    { id: "sales", label: "Sales", show: canView },
    { id: "planning", label: "Planning", show: available("planning") },
    { id: "projects", label: "Projects", show: available("projects") },
    { id: "people", label: "My time", show: available("attendance") },
  ];
  const widgetInTab = (id: HomeWidgetId) => tab === "overview" || tab === "sales" && (id === "attention" || id === "sales") || tab === "planning" && id === "planning" || tab === "projects" && id === "projects" || tab === "people" && id === "attendance";
  const metrics = [
    { label: "My follow-ups", value: overview?.metrics?.myFollowUps, href: "/workspace/crm/follow-ups", show: overview?.sections?.sales ?? canView },
    { label: "Planning cases", value: overview?.metrics?.planningCases, href: "/workspace/pre-projects", show: overview?.sections?.planning ?? modules.includes("pre-project") },
    { label: "Active projects", value: overview?.metrics?.activeProjects, href: "/workspace/projects", show: overview?.sections?.projects ?? modules.includes("projects") },
    { label: "My project tasks", value: overview?.metrics?.myProjectTasks, href: "/workspace/tasks", show: overview?.sections?.projects ?? modules.includes("projects") },
  ].filter(metric => metric.show);
  return <section className={s.home} aria-label="Workspace Home">
    <header className={s.heading}><div><span className={s.eyebrow}>{workspaceName}</span><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}</h1><p className={s.subtitle}>Here is what needs your attention today.</p></div><Button onPress={() => { setDraft(layout.map(item => ({ ...item }))); setEditing(true); }}><Settings2 size={16} />Customize Home</Button></header>
    <nav className={s.tabs} aria-label="Home sections">{tabs.filter(item => item.show).map(item => <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {overviewError && <div className={s.failure} role="alert">{overviewError}<Button size="compact" onPress={() => setOverviewReload(value => value + 1)}>Retry</Button></div>}
    {(tab === "overview" || tab === "sales" || tab === "planning" || tab === "projects") && metrics.length > 0 && <div className={s.metrics}>{metrics.map(metric => <Link key={metric.label} href={metric.href} className={s.metric}><span>{metric.label}</span><strong>{count(metric.value)}</strong><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>}
    {(tab === "overview" || tab === "people") && layout.some(widget => widget.id === "attendance" && widget.visible) && available("attendance") && <div className={s.topAttendance}><HomeAttendance workspaceId={workspaceId} /></div>}
    {(tab === "overview" || tab === "sales") && <>
    <div className={s.homeActions}>
      <div className={s.startBar}><div><strong>Keep work moving</strong><p>Start an enquiry or schedule your next follow-up.</p></div><div className={s.actions}>{crmEnabled && <><Link className={s.primaryAction} href="/workspace/crm/leads?create=true"><Plus size={16} />New enquiry</Link>{canView && <Button className={s.tonedAction} onPress={() => setCreating(true)}><CalendarClock size={16} />Plan follow-up</Button>}</>}{!crmEnabled && tools[0] && <Link className={s.primaryAction} href={tools[0].href}>Open {tools[0].title.toLowerCase()}<ArrowRight size={16} /></Link>}</div></div>
      {canManage && <div className={s.setupArea}><WorkspaceReadiness compact workspaceId={workspaceId} userId={userId} readiness={readiness} modules={modules} /></div>}
    </div>
    {failure && <div className={s.failure} role="alert"><span>{failure}{data && " Previously loaded records remain below."}</span><Button size="compact" isLoading={busy} onPress={() => void refresh()}>Retry</Button></div>}
    {crmEnabled && !canView && <p className={s.notice}>Your role does not include the sales summary. Your available tools are below.</p>}
    </>}
    <div className={s.widgets}>{layout.filter(widget => widget.id !== "attendance" && widget.visible && available(widget.id) && widgetInTab(widget.id)).map(widget => <section key={widget.id} className={s.widget} data-wide={widget.wide} aria-label={widgetNames[widget.id]}>
      {widget.id === "attendance" ? <HomeAttendance workspaceId={workspaceId} /> : <>
        <header className={s.widgetHeader}><h2>{widgetNames[widget.id]}</h2>{widget.id === "attention" && <Button size="compact" variant="quiet" isLoading={busy} onPress={() => void refresh()}><RefreshCw size={14} />Refresh</Button>}{widget.id === "sales" && <Link className={s.textAction} href="/workspace/crm">View sales<ArrowRight size={14} /></Link>}</header>
        {widget.id === "attention" && <><div className={s.filters} aria-label="Filter work">{[{id:"all",label:"All work"},{id:"follow-ups",label:"Follow-ups"},{id:"messages",label:"Client replies"}].map(option => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}</div>
          <div aria-busy={busy}>{visibleItems.slice(0,8).map(item => <div className={s.workRow} key={item.id}><span className={s.workIcon} aria-hidden="true">{String(item.kind).includes("reply") ? <MessageSquare size={18} /> : <CalendarClock size={18} />}</span><div className={s.workCopy}><strong>{String(item.title ?? item.partyName ?? "Follow-up")}</strong><span>{String(item.reason ?? "Review the linked record")}</span><small>{crmTime(item.dueAt)}</small></div>{homeActivityId(item) ? <Button className={s.tonedAction} size="compact" onPress={() => setActivity(homeActivityId(item))}>Update follow-up<ArrowRight size={14} /></Button> : <Link className={s.tonedLink} href={crmRecordLink(item)}>{homeActionLabel(item)}<ArrowRight size={14} /></Link>}</div>)}</div>
          {!visibleItems.length && <div className={s.empty}><span className={s.successIcon}><CircleCheck aria-hidden="true" /></span><div><strong>{failure ? "Work is temporarily unavailable" : filter === "all" ? "No work needs attention" : "No matching work"}</strong><p>{failure ? "Use Retry to load your current records." : "New reminders and client replies appear here."}</p></div></div>}
          {visibleItems.length > 8 && <Link className={s.textAction} href={filter === "messages" ? "/workspace/crm/conversations" : "/workspace/crm/follow-ups"}>View more {filter === "messages" ? "conversations" : "follow-ups"}<ArrowRight size={14}/></Link>}
        </>}
        {widget.id === "tools" && <div className={s.tools}>{tools.map(({title,href,Icon}) => <Link key={title} className={s.tool} href={href}><span className={s.toolIcon}><Icon size={19}/></span><strong>{title}</strong></Link>)}{!tools.length && <p className={s.notice}>No business modules are available for your role. Contact your workspace administrator.</p>}</div>}
        {widget.id === "sales" && <div className={s.sales}>{[{key:"activeLeads",label:"Active enquiries",href:"/workspace/crm/leads"},{key:"openOpportunities",label:"Open opportunities",href:"/workspace/crm/opportunities"},{key:"pendingFollowUps",label:"Follow-ups",href:"/workspace/crm/follow-ups"}].map(metric => <Link key={metric.key} href={metric.href}><strong>{count(summary[metric.key])}</strong><span>{metric.label}</span><ArrowRight size={14}/></Link>)}</div>}
        {widget.id === "planning" && <HomeItemList items={overview?.planning} loading={!overview && !overviewError} failed={Boolean(overviewError)} empty="No planning cases assigned to you." />}
        {widget.id === "projects" && <><h3 className={s.listTitle}>My tasks</h3><HomeItemList items={overview?.tasks} loading={!overview && !overviewError} failed={Boolean(overviewError)} empty="No active project tasks assigned to you." /><h3 className={s.listTitle}>Active projects</h3><HomeItemList items={overview?.projects} loading={!overview && !overviewError} failed={Boolean(overviewError)} empty="No active projects to show." /></>}
      </>}
    </section>)}</div>
    {!layout.some(widget => widget.visible && available(widget.id)) && <p className={s.notice}>Your Home is clear. Choose Customize Home to add work and tools.</p>}
    <ControlledModalDialog isOpen={editing} onOpenChange={open => { if (!layoutBusy) setEditing(open); }} title="Customize Home" size="md"><p className={s.notice}>Choose your sections and order. Saved for your account across devices in this workspace. Attendance stays at the top.</p><div className={s.layoutOptions}>{draft.filter(widget => available(widget.id)).map((widget,index,widgets) => <div className={s.layoutRow} key={widget.id}><label><input type="checkbox" checked={widget.visible} onChange={event => setDraft(previous => previous.map(item => item.id === widget.id ? {...item,visible:event.target.checked}:item))}/>{widgetNames[widget.id]}</label><div className={s.actions}><label className={s.sizeLabel}>Width<select value={widget.wide ? "wide":"standard"} onChange={event => setDraft(previous => previous.map(item => item.id === widget.id ? {...item,wide:event.target.value === "wide"}:item))}><option value="standard">Standard</option><option value="wide">Full</option></select></label><Button size="compact" aria-label={`Move ${widgetNames[widget.id]} up`} isDisabled={index === 0} onPress={() => move(widget.id,-1)}><ArrowUp size={14}/></Button><Button size="compact" aria-label={`Move ${widgetNames[widget.id]} down`} isDisabled={index === widgets.length-1} onPress={() => move(widget.id,1)}><ArrowDown size={14}/></Button></div></div>)}</div>{preferenceError && <p role="alert">{preferenceError} <Button size="compact" isDisabled={layoutBusy} onPress={() => setLayoutReload(value => value + 1)}>Reload saved layout</Button></p>}<div className={s.modalActions}><Button isDisabled={layoutBusy} onPress={() => setDraft(defaultHomeLayout.map(item => ({...item})))}>Reset layout</Button><Button isDisabled={layoutBusy} onPress={() => setEditing(false)}>Cancel</Button><Button variant="primary" isLoading={layoutBusy} isDisabled={layoutVersion === null} onPress={() => void saveLayout()}>Save layout</Button></div></ControlledModalDialog>
    {activity && <FollowUpSheet workspaceId={workspaceId} recordId={activity} onClose={() => setActivity(null)} onSaved={() => { void refresh(); }} />}
    {creating && <NewFollowUpDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void refresh(); }} />}
  </section>;
}

function HomeItemList({ items, loading, failed, empty }: { items?: HomeOverviewItem[]; loading: boolean; failed: boolean; empty: string }) {
  if (loading) return <p className={s.notice} role="status">Loading current work…</p>;
  if (failed) return <p className={s.notice}>Current work is unavailable. Retry above.</p>;
  if (!items?.length) return <p className={s.notice}>{empty}</p>;
  return <div className={s.itemList}>{items.map(item => <Link key={item.id} href={item.href} className={s.itemRow}><span><strong>{item.title}</strong><small>{item.detail}{item.date ? ` · ${new Date(item.date).toLocaleDateString()}` : ""}</small></span><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>;
}
