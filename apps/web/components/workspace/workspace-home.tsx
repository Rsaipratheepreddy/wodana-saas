"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { HomeMetrics, HomeOverview } from "@wodana/contracts";
import Link from "next/link";
import { AlertTriangle, BookOpen, CalendarClock, CircleCheck, ClipboardList, FileText, GripVertical, LayoutGrid, ListChecks, MessageSquare, Minus, Package, Plus, RefreshCw, Users } from "lucide-react";
import { Button, ControlledModalDialog, DesignSystemProvider, EmptyState, ErrorState, IconButton, ListTabs, MiniBars, PageHeader, SegmentedControl, SplitBar, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { defaultLayoutFor, homeActionLabel, homeActivityId, homeProfile, homeWidgetSizes, moveHomeWidget, parseHomeLayout, placeHomeWidget, type HomeWidget, type HomeWidgetId, type HomeWidgetSize } from "@/lib/workspace/home-layout";
import { crmRecordLink, crmTime } from "@/components/crm/crm-product-shell";
import { FollowUpSheet, NewFollowUpDialog } from "@/components/crm/follow-up-editor";
import { HomeAttendance } from "./home-attendance";
import { ActivityWidget, HealthWidget, ItemList, MoneyWidget, Row, StorageWidget, SummaryStrip, TrendWidget, ViewLink, type MetricsState, type Series } from "./home-widgets";
import { formatCount, greetingPart } from "./home-format";
import s from "./workspace-home.module.css";

type Props = {
  workspaceId: string;
  userId: string;
  workspaceName: string;
  modules: string[];
  initialData: CrmScreenPageData | null;
  canManage?: boolean;
  /** The person's first name for the greeting. */
  firstName?: string;
  /** Permission keys granted in this workspace; widgets and figures follow them. */
  permissions?: string[];
};
type AttentionFilter = "all" | "follow-ups" | "messages";
const isReply = (item: Record<string, unknown>) => String(item.kind).includes("reply");

export function WorkspaceHome(props: Props) {
  // Direction is left to the provider, which follows the chosen UI language (right-to-left for Arabic).
  const { direction: _direction, ...inherited } = useDesignSystem();
  // The shell's light/dark choice lives on the document; the nested provider must carry it, or its
  // actions and charts resolve light-theme colours on a dark page.
  const { theme } = useWorkspaceTheme();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider {...inherited} theme={inherited.theme === "high-contrast" ? inherited.theme : theme === "dark" ? "dark" : "light"} portalContainer={portal}><div ref={setPortal}><HomeContent key={`${props.workspaceId}:${props.userId}`} {...props} /></div></DesignSystemProvider>;
}

function HomeContent({ workspaceId, userId, modules, initialData, canManage, firstName, permissions }: Props) {
  const t = useT();
  const { locale } = useDesignSystem();
  const crmEnabled = modules.includes("crm");
  const canView = crmEnabled && initialData?.canView !== false;
  const can = (permission: string) => Boolean(canManage) || (permissions ? permissions.includes(permission) : false);
  const widgetNames: Record<HomeWidgetId, string> = {
    attention: t("Needs attention"), projects: t("My tasks"), trend: t("Sales trend"), money: t("Money in"), health: t("Projects health"), planning: t("In planning"),
    activity: t("Recent activity"), storage: t("Storage overview"), sales: t("Sales snapshot"), tools: t("Quick actions"),
  };
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewReload, setOverviewReload] = useState(0);
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null);
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [metricsReload, setMetricsReload] = useState(0);
  const canEnquiries = crmEnabled && can("crm.leads.view");
  const canQuotes = modules.includes("pre-project") && can("pre_projects.view");
  const canPayments = can("receivables.view");
  const canProjects = modules.includes("projects") && can("projects.view");
  const canStorage = can("workspace.settings.manage") || can("data.manage");
  const canActivity = can("workspace.settings.manage") || can("audit.view");
  /** What the person may see at all, from modules and permissions (stable before any data arrives). */
  const permitted = (id: HomeWidgetId): boolean => {
    switch (id) {
      case "tools": return true;
      case "planning": return modules.includes("pre-project");
      case "projects": return modules.includes("projects");
      case "trend": return canEnquiries || canQuotes;
      case "money": return canPayments;
      case "health": return canProjects;
      case "activity": return canActivity;
      case "storage": return canStorage;
      default: return canView;
    }
  };
  /** Once the server answers, its sections decide: a section it leaves out is hidden, never shown as zero. */
  const available = (id: HomeWidgetId): boolean => {
    if (!permitted(id)) return false;
    switch (id) {
      case "planning": return overview?.sections?.planning !== false;
      case "projects": return overview?.sections?.projects !== false;
      case "trend": return !metrics || Boolean(metrics.enquiries || metrics.quotes);
      case "money": return !metrics || Boolean(metrics.payments);
      case "health": return !metrics || Boolean(metrics.projects);
      case "activity": return !metrics || Boolean(metrics.activity);
      case "storage": return !metrics || Boolean(metrics.storage);
      default: return true;
    }
  };
  // `permitted` derives only from the props listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roleDefault = useMemo(() => defaultLayoutFor(homeProfile(permission => Boolean(canManage) || Boolean(permissions?.includes(permission)), canManage), permitted), [canManage, permissions, modules, canView]);
  const [layout, setLayout] = useState<HomeWidget[]>(roleDefault);
  const [layoutVersion, setLayoutVersion] = useState<number | null>(null);
  const [layoutReload, setLayoutReload] = useState(0);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const savingLayout = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HomeWidget[]>(layout);
  const [gallery, setGallery] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dragId, setDragId] = useState<HomeWidgetId | null>(null);
  const lastOver = useRef<string | null>(null);
  const [data, setData] = useState(initialData);
  const [failure, setFailure] = useState(crmEnabled && !initialData ? t("Your work could not be loaded. Try again.") : "");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [series, setSeries] = useState<"enquiries" | "quotes">(canEnquiries ? "enquiries" : "quotes");
  const refresh = async () => {
    if (loading.current || !canView) return;
    loading.current = true; setBusy(true); setFailure("");
    try {
      const result = await crmRequest<RecordData>(workspaceId, "today");
      const items = rows(result).map((item, index) => ({ ...item, id: `${item.kind}-${item.recordId ?? index}` }));
      setData({ id: "crm-overview", canView: true, workspaceId, items, supporting: { summary: result.summary ?? {}, total: result.total ?? items.length }, nextCursor: null, referenceTime: new Date().toISOString() });
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Your work could not be refreshed.")); }
    finally { loading.current = false; setBusy(false); }
  };
  const items = data?.canView ? data.items : [];
  const replies = items.filter(isReply).length;
  const visibleItems = items.filter(item => filter === "all" || (filter === "messages" ? isReply(item) : !isReply(item)));
  const summary = (data?.canView ? data.supporting.summary ?? {} : {}) as Record<string, unknown>;
  const tools: Array<{ title: string; href: string; Icon: typeof FileText; series: Series }> = [
    ...(modules.includes("pre-project") ? [
      { title: t("Quotations"), href: "/workspace/pre-projects?section=quotations", Icon: FileText, series: 2 as Series },
      { title: t("Catalog"), href: "/workspace/catalogs", Icon: BookOpen, series: 4 as Series },
      { title: t("Requirements"), href: "/workspace/pre-projects?section=requirements", Icon: ClipboardList, series: 2 as Series },
    ] : []),
    ...(crmEnabled ? [
      { title: t("Inbox"), href: "/workspace/crm/conversations", Icon: MessageSquare, series: 1 as Series },
      { title: t("Clients"), href: "/workspace/crm/customers", Icon: Users, series: 1 as Series },
    ] : []),
    ...(modules.includes("projects") ? [{ title: t("Projects"), href: "/workspace/projects", Icon: Package, series: 3 as Series }] : []),
  ];
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/home-layout?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(t("Your saved Home layout could not be loaded.")); return response.json(); })
      .then(result => { if (controller.signal.aborted) return; setLayout(parseHomeLayout(JSON.stringify(result.widgets), roleDefault)); setLayoutVersion(result.version); setPreferenceError(""); })
      .catch(error => { if (!controller.signal.aborted) { setLayoutVersion(null); setPreferenceError(error.message); } });
    return () => controller.abort();
  }, [workspaceId, userId, layoutReload, roleDefault, t]);
  useEffect(() => {
    const controller = new AbortController();
    setOverview(null); setOverviewError("");
    fetch(`/api/workspace/home-overview?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(t("Your latest workspace overview could not be loaded.")); return response.json() as Promise<HomeOverview>; })
      .then(result => { if (!controller.signal.aborted) setOverview(result); })
      .catch(error => { if (!controller.signal.aborted) setOverviewError(error instanceof Error ? error.message : t("Overview unavailable.")); });
    return () => controller.abort();
  }, [workspaceId, userId, overviewReload, t]);
  useEffect(() => {
    const controller = new AbortController();
    setMetrics(null); setMetricsFailed(false);
    fetch(`/api/workspace/home-metrics?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("metrics"); return response.json() as Promise<HomeMetrics>; })
      .then(result => { if (!controller.signal.aborted) setMetrics(result); })
      .catch(() => { if (!controller.signal.aborted) setMetricsFailed(true); });
    return () => controller.abort();
  }, [workspaceId, userId, metricsReload]);
  const metricsState: MetricsState = { data: metrics, failed: metricsFailed, retry: () => setMetricsReload(value => value + 1) };
  const saveLayout = async () => {
    if (savingLayout.current || layoutVersion === null) return;
    savingLayout.current = true; setLayoutBusy(true); setPreferenceError("");
    try {
      const widgets = draft.map(item => ({ ...item, wide: item.size === "wide" }));
      const response = await fetch("/api/workspace/home-layout", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, version: layoutVersion, widgets }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setLayoutVersion(null); throw new Error(result.message ?? t("Your Home layout could not be saved.")); }
      setLayout(parseHomeLayout(JSON.stringify(result.widgets), roleDefault)); setLayoutVersion(result.version); setEditing(false);
    } catch (error) { setPreferenceError(error instanceof Error ? error.message : t("Your Home layout could not be saved. Your choices are still here.")); }
    finally { savingLayout.current = false; setLayoutBusy(false); }
  };
  const startEditing = () => { setDraft(layout.map(item => ({ ...item }))); setPreferenceError(""); setEditing(true); };
  const shownInEdit = (item: HomeWidget) => item.visible && available(item.id);
  const move = (id: HomeWidgetId, offset: -1 | 1) => setDraft(previous => {
    const next = moveHomeWidget(previous, id, offset, shownInEdit);
    const order = next.filter(shownInEdit);
    setAnnouncement(t("{name} moved to position {position} of {total}", { name: widgetNames[id], position: order.findIndex(item => item.id === id) + 1, total: order.length }));
    return next;
  });
  const resize = (id: HomeWidgetId, size: HomeWidgetSize) => setDraft(previous => previous.map(item => item.id === id ? { ...item, size, wide: size === "wide" } : item));
  const remove = (id: HomeWidgetId) => { setDraft(previous => previous.map(item => item.id === id ? { ...item, visible: false } : item)); setAnnouncement(t("{name} removed", { name: widgetNames[id] })); };
  const add = (id: HomeWidgetId) => { setDraft(previous => [...previous.filter(item => item.id !== id), { ...(previous.find(item => item.id === id) as HomeWidget), visible: true }]); setGallery(false); setAnnouncement(t("{name} added", { name: widgetNames[id] })); };
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, id: HomeWidgetId) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const earlier = event.key === "ArrowUp" || event.key === (rtl ? "ArrowRight" : "ArrowLeft");
    const later = event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight");
    if (!earlier && !later) return;
    event.preventDefault();
    move(id, earlier ? -1 : 1);
    const target = event.currentTarget;
    requestAnimationFrame(() => target.focus());
  };
  const onDragStart = (event: PointerEvent<HTMLButtonElement>, id: HomeWidgetId) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    lastOver.current = id; setDragId(id);
  };
  const onDragMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragId) return;
    const over = document.elementsFromPoint(event.clientX, event.clientY).map(node => node.closest("[data-widget-id]")).find(Boolean)?.getAttribute("data-widget-id") as HomeWidgetId | undefined;
    if (!over || over === lastOver.current) return;
    lastOver.current = over;
    if (over !== dragId) setDraft(previous => placeHomeWidget(previous, dragId, over));
  };
  const onDragEnd = () => { if (dragId) { const order = draft.filter(shownInEdit); setAnnouncement(t("{name} moved to position {position} of {total}", { name: widgetNames[dragId], position: order.findIndex(item => item.id === dragId) + 1, total: order.length })); } setDragId(null); lastOver.current = null; };

  // The summary keeps a place for each figure the person may see (at most four) while it loads.
  const expectedFigures = Math.min(4, [crmEnabled && can("crm.activities.view"), canQuotes, canProjects, can("purchasing.view"), canPayments, canEnquiries].filter(Boolean).length);
  const shownLayout = (editing ? draft : layout).filter(widget => widget.visible && available(widget.id));
  const hiddenWidgets = draft.filter(widget => !widget.visible && available(widget.id));
  const part = greetingPart(undefined);
  const greeting = firstName
    ? (part === "morning" ? t("Good morning, {name}", { name: firstName }) : part === "afternoon" ? t("Good afternoon, {name}", { name: firstName }) : t("Good evening, {name}", { name: firstName }))
    : (part === "morning" ? t("Good morning") : part === "afternoon" ? t("Good afternoon") : t("Good evening"));
  const today = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: metrics?.timeZone }).format(new Date());

  /** The end of a widget's header: its view switch or filter, and the link to its full list. */
  const headerTools = (id: HomeWidgetId): ReactNode => {
    if (id === "attention") return <>
      <ListTabs label={t("Filter work")} value={filter} onChange={setFilter} items={[
        { id: "all", label: t("All work"), count: items.length },
        { id: "follow-ups", label: t("Follow-ups"), count: items.length - replies },
        { id: "messages", label: t("Client replies"), count: replies },
      ]} />
      <IconButton size="compact" aria-label={t("Refresh")} isLoading={busy} onPress={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /></IconButton>
    </>;
    if (id === "trend") return (metrics ? Boolean(metrics.enquiries) : canEnquiries) && (metrics ? Boolean(metrics.quotes) : canQuotes)
      ? <SegmentedControl label={t("Show")} value={series} onChange={value => setSeries(value as "enquiries" | "quotes")} options={[{ id: "enquiries", label: t("Enquiries") }, { id: "quotes", label: t("Quote value") }]} />
      : null;
    const links: Partial<Record<HomeWidgetId, [string, string]>> = { sales: ["/workspace/crm", t("View sales")], planning: ["/workspace/pre-projects", t("View all")], projects: ["/workspace/tasks", t("View all")], money: ["/workspace/finance", t("Open finance")], health: ["/workspace/projects", t("View all")], activity: ["/workspace/settings/audit-logs", t("View all")] };
    const link = links[id];
    return link ? <ViewLink href={link[0]}>{link[1]}</ViewLink> : null;
  };
  const attentionTone = (kind: string) => kind === "sla_breach" ? "danger" as const : kind.includes("overdue") ? "warning" as const : undefined;
  const body = (id: HomeWidgetId): ReactNode => {
    switch (id) {
      case "attention": return <>
        {failure && items.length ? <p className={s.inlineFailure} role="alert"><AlertTriangle size={14} aria-hidden="true" /><span>{failure}</span><Button size="compact" variant="quiet" isLoading={busy} onPress={() => void refresh()}>{t("Retry")}</Button></p> : null}
        {failure && !items.length ? <div className={s.state} role="alert"><ErrorState title={t("This could not be loaded")} description="" onRetry={() => void refresh()} /></div> : null}
        {visibleItems.length ? <ul className={s.list} aria-busy={busy}>{visibleItems.slice(0, 5).map(item => {
          const reply = isReply(item);
          const activityId = homeActivityId(item);
          return <li key={item.id}><Row icon={reply ? MessageSquare : CalendarClock} series={reply ? 2 : 1} tone={attentionTone(String(item.kind))}
            title={String(item.title ?? item.partyName ?? t("Follow-up"))}
            detail={[String(item.reason ?? t("Review the linked record")), crmTime(item.dueAt)].filter(Boolean).join(" · ")}
            end={activityId ? <Button size="compact" onPress={() => setActivity(activityId)}>{t("Update follow-up")}</Button>
              : <Link className="wd-button" data-size="compact" data-variant="secondary" href={crmRecordLink(item)}>{t(homeActionLabel(item) as Parameters<typeof t>[0])}</Link>} /></li>;
        })}</ul> : null}
        {!visibleItems.length && !failure ? <div className={s.state}><EmptyState illustration={null} icon={<CircleCheck size={16} aria-hidden="true" />} title={filter === "all" ? t("No work needs attention") : t("No matching work")} action={canView ? <Button size="compact" onPress={() => setCreating(true)}><CalendarClock size={14} aria-hidden="true" />{t("Plan follow-up")}</Button> : null} /></div> : null}
        {visibleItems.length && canView ? <div className={s.widgetFooter}>
          <Button size="compact" variant="quiet" onPress={() => setCreating(true)}><CalendarClock size={14} aria-hidden="true" />{t("Plan follow-up")}</Button>
          {visibleItems.length > 5 ? <ViewLink href={filter === "messages" ? "/workspace/crm/conversations" : "/workspace/crm/follow-ups"}>{filter === "messages" ? t("View more conversations") : t("View more follow-ups")}</ViewLink> : null}
        </div> : null}
      </>;
      case "tools": return tools.length ? <div className={s.tools}>{tools.map(({ title, href, Icon, series: tint }) => <Link key={href} className={s.tool} href={href}><span className={s.rowIcon} data-series={tint} aria-hidden="true"><Icon size={15} /></span><strong>{title}</strong></Link>)}</div> : <div className={s.state}><EmptyState illustration={null} title={t("No tools are available for your role")} /></div>;
      case "sales": return <ul className={s.list}>{[{ key: "activeLeads", label: t("Active enquiries"), href: "/workspace/crm/leads", Icon: Users }, { key: "openOpportunities", label: t("Open opportunities"), href: "/workspace/crm/opportunities", Icon: FileText }, { key: "pendingFollowUps", label: t("Follow-ups"), href: "/workspace/crm/follow-ups", Icon: CalendarClock }].map(metric => <li key={metric.key}>
        <Row href={metric.href} icon={metric.Icon} series={1} title={metric.label} end={<strong className={s.rowFigure}>{typeof summary[metric.key] === "number" ? formatCount(summary[metric.key] as number, locale ?? "en") : "—"}</strong>} /></li>)}</ul>;
      case "planning": return <ItemList icon={ClipboardList} series={2} items={overview?.planning} loading={!overview && !overviewError} failed={Boolean(overviewError)} retry={() => setOverviewReload(value => value + 1)} empty={{ title: t("No planning cases assigned to you"), action: <ViewLink href="/workspace/pre-projects">{t("Open planning")}</ViewLink> }} />;
      case "projects": return <ItemList icon={ListChecks} series={3} items={overview?.tasks} loading={!overview && !overviewError} failed={Boolean(overviewError)} retry={() => setOverviewReload(value => value + 1)} empty={{ title: t("No open tasks assigned to you"), action: <ViewLink href="/workspace/tasks">{t("Open tasks")}</ViewLink> }} />;
      case "trend": return <TrendWidget metrics={metricsState} series={metrics && !metrics.enquiries ? "quotes" : metrics && !metrics.quotes ? "enquiries" : series} />;
      case "money": return <MoneyWidget metrics={metricsState} />;
      case "health": return <HealthWidget metrics={metricsState} />;
      case "activity": return <ActivityWidget metrics={metricsState} />;
      case "storage": return <StorageWidget metrics={metricsState} />;
    }
  };

  return <section className={s.home} aria-label={t("Workspace Home")} data-editing={editing || undefined}>
    <PageHeader title={greeting}
      description={<span className={s.meta}><span>{today}</span>{modules.includes("hrms") ? <HomeAttendance workspaceId={workspaceId} /> : null}</span>}
      actions={editing
        ? <div className={s.actions}><Button onPress={() => setGallery(true)} isDisabled={layoutBusy}><Plus size={16} aria-hidden="true" />{t("Add widget")}</Button><Button variant="quiet" isDisabled={layoutBusy} onPress={() => setEditing(false)}>{t("Cancel")}</Button><Button variant="primary" isLoading={layoutBusy} isDisabled={layoutVersion === null} onPress={() => void saveLayout()}>{t("Done")}</Button></div>
        : <div className={s.actions}><Button variant="quiet" data-tour="home-edit" onPress={startEditing}><LayoutGrid size={16} aria-hidden="true" />{t("Edit Home")}</Button>{crmEnabled ? <Link className="wd-button" data-size="standard" data-variant="primary" href="/workspace/crm/leads?create=true"><Plus size={16} aria-hidden="true" />{t("New enquiry")}</Link> : null}</div>} />
    {editing && preferenceError ? <p className={s.inlineFailure} role="alert"><AlertTriangle size={14} aria-hidden="true" /><span>{preferenceError}</span><Button size="compact" isDisabled={layoutBusy} onPress={() => { setLayoutReload(value => value + 1); setEditing(false); }}>{t("Reload saved layout")}</Button></p> : null}
    {!editing ? <SummaryStrip metrics={metricsState} expected={expectedFigures} /> : null}
    <div className={s.grid}>{shownLayout.map(widget => <section key={widget.id} className={s.widget} data-widget-id={widget.id} data-size={widget.size} data-dragging={dragId === widget.id || undefined} data-tour={widget.id === "attention" ? "home-widget-attention" : undefined} aria-label={widgetNames[widget.id]}>
      {editing ? <div className={s.editChrome}>
        <IconButton className={s.removeButton} aria-label={t("Remove {name}", { name: widgetNames[widget.id] })} onPress={() => remove(widget.id)}><Minus size={14} aria-hidden="true" /></IconButton>
        <button type="button" className={s.dragHandle} aria-label={t("Move {name}", { name: widgetNames[widget.id] })} aria-describedby="home-move-hint" onKeyDown={event => onHandleKey(event, widget.id)} onPointerDown={event => onDragStart(event, widget.id)} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}><GripVertical size={16} aria-hidden="true" data-directional="true" /></button>
      </div> : null}
      <div className={s.widgetInner} inert={editing || undefined}>
        <header className={s.widgetHeader}><h2>{widgetNames[widget.id]}</h2><span className={s.widgetTools}>{headerTools(widget.id)}</span></header>
        {body(widget.id)}
      </div>
      {editing ? <div className={s.sizePicker} role="group" aria-label={t("Size of {name}", { name: widgetNames[widget.id] })}>{homeWidgetSizes.map(size => <button key={size} type="button" aria-pressed={widget.size === size} onClick={() => resize(widget.id, size)}>{size === "small" ? t("Small") : size === "medium" ? t("Medium") : t("Wide")}</button>)}</div> : null}
    </section>)}</div>
    {!shownLayout.length ? <div className={s.state}><EmptyState illustration={null} icon={<LayoutGrid size={16} aria-hidden="true" />} title={t("Your Home is clear")} action={editing ? <Button onPress={() => setGallery(true)}><Plus size={16} aria-hidden="true" />{t("Add widget")}</Button> : <Button onPress={startEditing}>{t("Edit Home")}</Button>} /></div> : null}
    <span id="home-move-hint" className="wd-visually-hidden">{t("Use the arrow keys to move this widget.")}</span>
    <span className="wd-visually-hidden" aria-live="polite">{announcement}</span>
    <ControlledModalDialog isOpen={gallery} onOpenChange={setGallery} title={t("Add widget")} size="md">
      {hiddenWidgets.length ? <ul className={s.gallery}>{hiddenWidgets.map(widget => <li key={widget.id}><button type="button" className={s.galleryTile} onClick={() => add(widget.id)} aria-label={t("Add {name}", { name: widgetNames[widget.id] })}><WidgetPreview id={widget.id} /><span><strong>{widgetNames[widget.id]}</strong><Plus size={16} aria-hidden="true" /></span></button></li>)}</ul>
        : <div className={s.state}><EmptyState illustration={null} icon={<CircleCheck size={16} aria-hidden="true" />} title={t("Every widget is on your Home")} /></div>}
      <div className={s.modalActions}><Button onPress={() => { setDraft(roleDefault.map(item => ({ ...item }))); setGallery(false); }}>{t("Reset layout")}</Button></div>
    </ControlledModalDialog>
    {activity && <FollowUpSheet workspaceId={workspaceId} recordId={activity} onClose={() => setActivity(null)} onSaved={() => { void refresh(); }} />}
    {creating && <NewFollowUpDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void refresh(); }} />}
  </section>;
}

const sample = [3, 5, 4, 6, 5, 7, 6, 8].map((value, index) => ({ label: String(index), value }));
/** A small, static picture of each widget for the gallery; decorative only. */
function WidgetPreview({ id }: { id: HomeWidgetId }) {
  const picture = id === "trend" || id === "sales" ? <MiniBars points={sample} label="" />
    : id === "storage" || id === "money" ? <SplitBar label="" segments={[{ id: "a", label: "", value: 5, display: "" }, { id: "b", label: "", value: 3, display: "" }, { id: "c", label: "", value: 2, display: "" }, { id: "d", label: "", value: 1, display: "" }]} />
      : <span className={s.previewLines}><i /><i /><i /></span>;
  return <span className={s.preview} aria-hidden="true">{picture}</span>;
}
