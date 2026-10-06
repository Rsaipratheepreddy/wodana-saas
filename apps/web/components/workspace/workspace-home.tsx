"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeFocusItem, HomeMetrics, HomeSummary } from "@wodana/contracts";
import { CalendarPlus, ClipboardPlus, Factory, FileText, HardHat, PackageCheck, Plus, Receipt, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { Button, Callout, DesignSystemProvider, MenuButton, PageHeader, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { shortcutBlocked } from "@/lib/keyboard/typing-target";
import { projectApi } from "@/lib/project-core/client";
import type { WorkBoard } from "@/lib/project-core/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { FollowUpSheet, NewFollowUpDialog } from "@/components/crm/follow-up-editor";
import { WorkSheet } from "@/components/project-core/work-sheet";
import { HomeAttendance } from "./home-attendance";
import { DeliveryAttention } from "./delivery-attention";
import { JumpBackIn, KeyNumbers, Pipeline, RecentActivity, TodayList, UpcomingList, type Load, type NumbersLens } from "./home-sections";
import { SiteProgressAttention } from "./site-progress-attention";
import { greetingPart } from "./home-format";
import { WorkspaceUniversalSearch } from "./workspace-universal-search";
import s from "./workspace-home.module.css";

const HOME_SCOPES = ["workspace"] as const;

type Props = {
  workspaceId: string;
  userId: string;
  workspaceName: string;
  modules: string[];
  canManage?: boolean;
  /** The person's first name for the greeting. */
  firstName?: string;
  /** Permission keys granted in this workspace; sections and actions follow them. */
  permissions?: string[];
  /** The owner hasn't finished the first-time setup yet (shown to everyone else, who can't finish it). */
  setupPending?: boolean;
  /** The workspace's time zone, so the greeting and date read the same on the server and in the browser. */
  timeZone?: string;
};

export function WorkspaceHome(props: Props) {
  // Direction is left to the provider, which follows the chosen UI language (right-to-left for Arabic).
  const { direction: _direction, ...inherited } = useDesignSystem();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider {...inherited} portalContainer={portal}><div ref={setPortal}><HomeContent key={`${props.workspaceId}:${props.userId}`} {...props} /></div></DesignSystemProvider>;
}

/** One JSON source of Home: a failure never blanks the rest; `refresh` re-reads it quietly after an action. */
function useSource<V>(url: string): Load<V> & { refresh: () => void } {
  const [data, setData] = useState<V | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<V>; })
      .then((value) => { if (!controller.signal.aborted) { setData(value); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, version]);
  const retry = useCallback(() => { setFailed(false); setVersion((value) => value + 1); }, []);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { data, failed, retry, refresh };
}

type QuickAction = { id: string; label: string; icon: LucideIcon; href?: string; onPress?: () => void; onProject?: (projectId: string) => string };

function HomeContent({ workspaceId, modules, canManage, firstName, permissions, setupPending, timeZone: workspaceTimeZone }: Props) {
  const t = useT();
  const router = useRouter();
  const { locale } = useDesignSystem();
  const can = (permission: string) => Boolean(canManage) || Boolean(permissions?.includes(permission));
  const has = (module: string) => modules.includes(module);
  const query = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const summary = useSource<HomeSummary>(`/api/workspace/home-summary?${query}`);
  const metrics = useSource<HomeMetrics>(`/api/workspace/home-metrics?${query}`);
  const [creating, setCreating] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [work, setWork] = useState<{ projectId: string; itemId: string; board: WorkBoard } | null>(null);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);

  // "/" puts the cursor in search from anywhere on Home (unless the person is typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || shortcutBlocked(event)) return;
      event.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canFollowUp = has("crm") && can("crm.activities.manage");
  const projectsOn = has("projects") && (can("projects.view") || can("projects.manage"));
  const projects = summary.data?.projects ?? [];

  /** Follow-ups and work items open in place; everything else follows its link. */
  const open = async (item: HomeFocusItem) => {
    if (item.source === "follow_up") { setFollowUp(item.recordId); return; }
    if (item.source === "work" && item.projectId) {
      try { setWork({ projectId: item.projectId, itemId: item.recordId, board: await api.work(item.projectId) }); }
      catch { router.push(item.href); }
      return;
    }
    router.push(item.href);
  };

  // The role's quick actions, in order of how often each is needed; only what the person can do, at most five.
  const actions: QuickAction[] = [
    ...(canFollowUp ? [{ id: "follow-up", label: t("Plan follow-up"), icon: CalendarPlus, onPress: () => setCreating(true) }] : []),
    ...(has("pre-project") && (can("commercial.estimate") || can("pre_projects.create")) ? [{ id: "quotes", label: t("Open quotes"), icon: FileText, href: "/workspace/pre-projects?section=quotations" }] : []),
    ...(projectsOn && (can("projects.manage") || can("projects.report")) ? [{ id: "task", label: t("New task"), icon: ClipboardPlus, onProject: (id: string) => `/workspace/projects/${encodeURIComponent(id)}/plan?new=task` }] : []),
    ...(can("receivables.view") ? [{ id: "invoices", label: t("Client invoices"), icon: Receipt, href: "/workspace/finance/client-invoices" }] : []),
    ...(can("purchasing.manage") ? [{ id: "order", label: t("Order materials"), icon: ShoppingCart, href: "/workspace/purchasing" }] : []),
    ...(can("stock.receive") || can("purchasing.manage") ? [{ id: "receive", label: t("Receive delivery"), icon: PackageCheck, href: "/workspace/purchasing/deliveries" }] : []),
    ...(projectsOn && can("projects.report") ? [{ id: "site", label: t("Site report"), icon: HardHat, onProject: (id: string) => `/workspace/projects/${encodeURIComponent(id)}/site?new=report` }] : []),
    ...(can("factory.report") ? [{ id: "output", label: t("Report output"), icon: Factory, href: "/workspace/factory" }] : []),
    ...(can("payables.manage") ? [{ id: "bills", label: t("Pay bills"), icon: Wallet, href: "/workspace/finance/payments" }] : []),
  ].filter((action) => !action.onProject || projects.length > 0).slice(0, 5);

  const actionControl = (action: QuickAction): ReactNode => {
    const Icon = action.icon;
    const label = <><Icon size={15} aria-hidden="true" />{action.label}</>;
    if (action.onPress) return <Button key={action.id} size="compact" onPress={action.onPress}>{label}</Button>;
    if (action.onProject && projects.length > 1) return <MenuButton key={action.id} size="compact" label={label}
      items={projects.map((project) => ({ id: project.id, label: project.name }))} onAction={(id) => router.push(action.onProject!(id))} />;
    const href = action.onProject ? action.onProject(projects[0].id) : action.href!;
    return <Link key={action.id} className="wd-button" data-size="compact" data-variant="secondary" href={href}>{label}</Link>;
  };

  // The next step when a list is empty: plan a follow-up, else open the person's work.
  const nextStep = canFollowUp ? <Button size="compact" onPress={() => setCreating(true)}><CalendarPlus size={14} aria-hidden="true" />{t("Plan follow-up")}</Button>
    : projectsOn ? <Link className="wd-button" data-size="compact" data-variant="secondary" href="/workspace/tasks">{t("Open tasks")}</Link> : null;
  const firstList = projectsOn ? { href: "/workspace/projects", label: t("Open projects") }
    : has("crm") && can("crm.leads.view") ? { href: "/workspace/crm/leads", label: t("Open enquiries") }
      : has("pre-project") && can("pre_projects.view") ? { href: "/workspace/pre-projects", label: t("Open planning") } : null;

  const lens: NumbersLens = canManage || can("workspace.settings.manage") ? "business"
    : can("receivables.view") ? "finance"
      : can("crm.leads.view") ? "sales"
        : can("commercial.estimate") ? "estimating"
          : can("purchasing.view") ? "purchasing" : "projects";
  const expectNumbers = ["receivables.view", "projects.view", "crm.leads.view", "pre_projects.view", "purchasing.view"].some(can);
  const canActivity = can("workspace.settings.manage") || can("audit.view");

  // The workspace's clock from the first render (the server's HTML and the browser agree), then the summary's.
  const zone = summary.data?.timeZone ?? workspaceTimeZone;
  const part = greetingPart(zone);
  const greeting = firstName
    ? (part === "morning" ? t("Good morning, {name}", { name: firstName }) : part === "afternoon" ? t("Good afternoon, {name}", { name: firstName }) : t("Good evening, {name}", { name: firstName }))
    : (part === "morning" ? t("Good morning") : part === "afternoon" ? t("Good afternoon") : t("Good evening"));
  const today = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(new Date());
  const afterAction = () => { summary.refresh(); metrics.refresh(); };
  // Someone else's change re-reads Home in place (no loading state), so it needs no polling.
  useLiveInvalidate(workspaceId, HOME_SCOPES, afterAction, 5_000);

  return <section className={s.home} aria-label={t("Workspace Home")}>
    <PageHeader title={greeting}
      description={<span className={s.meta}><span>{today}</span>{has("hrms") ? <HomeAttendance workspaceId={workspaceId} /> : null}</span>}
      actions={has("crm") && can("crm.leads.manage") ? <Link className="wd-button" data-size="standard" data-variant="primary" href="/workspace/crm/leads?create=true"><Plus size={16} aria-hidden="true" />{t("New enquiry")}</Link> : null} />
    {setupPending ? <Callout title={t("Your workspace is being set up")}>{t("Your owner is finishing the setup. Some settings may still change.")}</Callout> : null}
    {canManage ? <DeliveryAttention workspaceId={workspaceId} /> : null}
    <div className={s.bar}>
      <div className={s.search} data-tour="home-edit">
        <WorkspaceUniversalSearch workspaceId={workspaceId} query={search} onQueryChange={setSearch} inputRef={searchInput} />
      </div>
      {actions.length ? <div className={s.actions} role="group" aria-label={t("Quick actions")}>{actions.map(actionControl)}</div> : null}
    </div>
    <Pipeline summary={summary} />
    <div className={s.layout}>
      <div className={s.main}>
        {projectsOn ? <SiteProgressAttention workspaceId={workspaceId} /> : null}
        <TodayList summary={summary} open={(item) => void open(item)} allClear={nextStep} />
        <UpcomingList summary={summary} empty={nextStep} />
      </div>
      <div className={s.aside}>
        <KeyNumbers metrics={metrics} lens={lens} expected={expectNumbers} />
        <JumpBackIn summary={summary} empty={firstList ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={firstList.href}>{firstList.label}</Link> : null} />
        {canActivity ? <RecentActivity metrics={metrics} /> : null}
      </div>
    </div>
    {followUp ? <FollowUpSheet workspaceId={workspaceId} recordId={followUp} onClose={() => setFollowUp(null)} onSaved={afterAction} /> : null}
    {creating ? <NewFollowUpDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); afterAction(); }} /> : null}
    {work ? <WorkSheet api={api} projectId={work.projectId} itemId={work.itemId} board={work.board}
      onBoard={(board) => setWork((current) => (current ? { ...current, board } : current))}
      onOpenItem={(itemId) => setWork((current) => (current ? { ...current, itemId } : current))}
      onClose={() => { setWork(null); afterAction(); }} /> : null}
  </section>;
}
