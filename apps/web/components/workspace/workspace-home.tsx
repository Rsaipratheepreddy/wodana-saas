"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeMetrics, HomeSummary, MyDayItem, MyDayResponse } from "@wodana/contracts";
import { CalendarPlus, ClipboardPlus, Factory, FileText, HardHat, PackageCheck, Plus, Receipt, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { Button, Callout, DesignSystemProvider, FormDialog, IconMenuButton, PageHeader, SelectField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { WorkBoard } from "@/lib/project-core/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { FollowUpSheet, NewFollowUpDialog } from "@/components/crm/follow-up-editor";
import { WorkSheet } from "@/components/project-core/work-sheet";
import { DeliveryAttention } from "./delivery-attention";
import { KeyNumbers, TodayList, type Load, type NumbersLens } from "./home-sections";
import { SiteProgressAttention } from "./site-progress-attention";
import { SiteTodayCards } from "../site/site-today-cards";
import { greetingPart } from "./home-format";
import s from "./workspace-home.module.css";

// "reminders" moves Today's list (My day) when something falls due, closes, is snoozed or reassigned.
const HOME_SCOPES = ["workspace", "reminders"] as const;
/** Enough of My day to pick Today's six most urgent items; the counts cover everything. */
const TODAY_LIMIT = 50;
/** Rows of the one attention block (daily reports to review, or sites without today's report). */
const ATTENTION_ROWS = 3;

/** What the site block already shows, so Today doesn't list it a second time. */
export const siteItem = (item: Pick<MyDayItem, "kind" | "variant">) => item.kind === "site.daily_report" || (item.kind === "approval.waiting" && item.variant === "site_report");

/** A follow-up or a work item Today can open in place, read from its link (anything else follows the link). */
export function inPlaceTarget(item: Pick<MyDayItem, "kind" | "href">): { followUp: string } | { projectId: string; itemId: string } | null {
  const [path = "", search = ""] = item.href.split("?");
  const params = new URLSearchParams(search);
  if (item.kind === "crm.follow_up" && path === "/workspace/crm/follow-ups" && params.get("record")) return { followUp: params.get("record")! };
  const project = /^\/workspace\/projects\/([^/]+)\/plan$/.exec(path);
  if (item.kind === "work.due" && project && params.get("item")) return { projectId: decodeURIComponent(project[1]), itemId: params.get("item")! };
  return null;
}

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

/**
 * Home (UX-012/013): calm and short. One greeting with the role's one primary action (the others under "+"), at
 * most one block that needs attention, at most four figures for the role, and Today (the person's My day). Search
 * is the global ⌘K; attendance is in the person menu.
 */
function HomeContent({ workspaceId, modules, canManage, firstName, permissions, setupPending, timeZone: workspaceTimeZone }: Props) {
  const t = useT();
  const router = useRouter();
  const can = (permission: string) => Boolean(canManage) || Boolean(permissions?.includes(permission));
  const has = (module: string) => modules.includes(module);
  const query = `workspaceId=${encodeURIComponent(workspaceId)}`;
  const summary = useSource<HomeSummary>(`/api/workspace/home-summary?${query}`);
  const myDay = useSource<MyDayResponse>(`/api/workspace/my-day?${query}&scope=me&limit=${TODAY_LIMIT}`);
  const metrics = useSource<HomeMetrics>(`/api/workspace/home-metrics?${query}`);
  const [creating, setCreating] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [work, setWork] = useState<{ projectId: string; itemId: string; board: WorkBoard } | null>(null);
  const [picking, setPicking] = useState<QuickAction | null>(null);
  const [deliveryShown, setDeliveryShown] = useState(false);
  const [siteShown, setSiteShown] = useState(false);
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);

  const canFollowUp = has("crm") && can("crm.activities.manage");
  const projectsOn = has("projects") && (can("projects.view") || can("projects.manage"));
  const projects = summary.data?.projects ?? [];

  /** Follow-ups and work items open in place; everything else follows its link. */
  const inPlace = (item: MyDayItem): (() => void) | null => {
    const target = inPlaceTarget(item);
    if (!target) return null;
    if ("followUp" in target) return () => setFollowUp(target.followUp);
    return () => {
      void api.work(target.projectId)
        .then((board) => setWork({ projectId: target.projectId, itemId: target.itemId, board }))
        .catch(() => router.push(item.href));
    };
  };

  // The role's actions, in order of how often each is needed; only what the person can do. The first is the page's
  // primary action (a new enquiry for the people who take them), the rest wait under "+".
  const actions: QuickAction[] = [
    ...(has("crm") && can("crm.leads.manage") ? [{ id: "enquiry", label: t("New enquiry"), icon: Plus, href: "/workspace/crm/leads?create=true" }] : []),
    ...(canFollowUp ? [{ id: "follow-up", label: t("Plan follow-up"), icon: CalendarPlus, onPress: () => setCreating(true) }] : []),
    ...(has("pre-project") && (can("commercial.estimate") || can("pre_projects.create")) ? [{ id: "quotes", label: t("Open quotes"), icon: FileText, href: "/workspace/pre-projects?section=quotations" }] : []),
    ...(projectsOn && (can("projects.manage") || can("projects.report")) ? [{ id: "task", label: t("New task"), icon: ClipboardPlus, onProject: (id: string) => `/workspace/projects/${encodeURIComponent(id)}/plan?new=task` }] : []),
    ...(can("receivables.view") ? [{ id: "invoices", label: t("Client invoices"), icon: Receipt, href: "/workspace/finance/client-invoices" }] : []),
    ...(can("purchasing.manage") ? [{ id: "order", label: t("Order materials"), icon: ShoppingCart, href: "/workspace/purchasing" }] : []),
    ...(can("stock.receive") || can("purchasing.manage") ? [{ id: "receive", label: t("Receive delivery"), icon: PackageCheck, href: "/workspace/purchasing/deliveries" }] : []),
    ...(projectsOn && can("projects.report") ? [{ id: "site", label: t("Site report"), icon: HardHat, onProject: (id: string) => `/workspace/projects/${encodeURIComponent(id)}/site?new=report` }] : []),
    ...(can("factory.report") ? [{ id: "output", label: t("Report output"), icon: Factory, href: "/workspace/factory" }] : []),
    ...(can("payables.manage") ? [{ id: "bills", label: t("Pay bills"), icon: Wallet, href: "/workspace/finance/payments" }] : []),
  ].filter((action) => !action.onProject || projects.length > 0);
  const [primary, ...more] = actions;

  const run = (action: QuickAction) => {
    if (action.onPress) action.onPress();
    else if (action.onProject) { if (projects.length === 1) router.push(action.onProject(projects[0].id)); else setPicking(action); }
    else if (action.href) router.push(action.href);
  };
  const primaryControl = (action: QuickAction): ReactNode => {
    const Icon = action.icon;
    const label = <><Icon size={16} aria-hidden="true" />{action.label}</>;
    const href = action.href ?? (action.onProject && projects.length === 1 ? action.onProject(projects[0].id) : null);
    return href ? <Link className="wd-button" data-size="standard" data-variant="primary" href={href}>{label}</Link>
      : <Button variant="primary" onPress={() => run(action)}>{label}</Button>;
  };
  const headerActions = primary ? <>
    {primaryControl(primary)}
    {more.length ? <IconMenuButton ariaLabel={t("More actions")} icon={<Plus aria-hidden="true" size={16} />} size="standard" variant="secondary"
      items={more.map((action) => ({ id: action.id, label: action.label }))} onAction={(id) => { const action = more.find((item) => item.id === id); if (action) run(action); }} /> : null}
  </> : null;

  // The next step when Today is empty: plan a follow-up, else open the person's work.
  const nextStep = canFollowUp ? <Button size="compact" onPress={() => setCreating(true)}><CalendarPlus size={14} aria-hidden="true" />{t("Plan follow-up")}</Button>
    : projectsOn ? <Link className="wd-button" data-size="compact" data-variant="secondary" href="/workspace/tasks">{t("Open tasks")}</Link> : null;

  const lens: NumbersLens = canManage || can("workspace.settings.manage") ? "business"
    : can("receivables.view") ? "finance"
      : can("crm.leads.view") ? "sales"
        : can("commercial.estimate") ? "estimating"
          : can("purchasing.view") ? "purchasing" : "projects";
  const expectNumbers = ["receivables.view", "projects.view", "crm.leads.view", "pre_projects.view", "purchasing.view"].some(can);

  // The workspace's clock from the first render (the server's HTML and the browser agree), then the summary's.
  const zone = summary.data?.timeZone ?? workspaceTimeZone;
  const part = greetingPart(zone);
  const greeting = firstName
    ? (part === "morning" ? t("Good morning, {name}", { name: firstName }) : part === "afternoon" ? t("Good afternoon, {name}", { name: firstName }) : t("Good evening, {name}", { name: firstName }))
    : (part === "morning" ? t("Good morning") : part === "afternoon" ? t("Good afternoon") : t("Good evening"));
  const afterAction = () => { summary.refresh(); metrics.refresh(); myDay.refresh(); };
  // Someone else's change re-reads Home in place (no loading state), so it needs no polling.
  useLiveInvalidate(workspaceId, HOME_SCOPES, afterAction, 5_000);

  // One attention block at most: the setup notice, else messages not going out (owners), else the site's reports.
  const deliveryOn = !setupPending && Boolean(canManage);
  const siteOn = !setupPending && !deliveryShown && projectsOn;
  return <section className={s.home} aria-label={t("Workspace Home")}>
    <PageHeader title={greeting} actions={headerActions} />
    {setupPending ? <Callout title={t("Your workspace is being set up")}>{t("Your owner is finishing the setup. Some settings may still change.")}</Callout> : null}
    {deliveryOn ? <DeliveryAttention workspaceId={workspaceId} onShown={setDeliveryShown} /> : null}
    {siteOn ? <SiteProgressAttention workspaceId={workspaceId} limit={ATTENTION_ROWS} onShown={setSiteShown} /> : null}
    <KeyNumbers metrics={metrics} lens={lens} expected={expectNumbers} />
    <TodayList myDay={myDay} next={summary.data?.upcoming[0]} nextZone={zone ?? "UTC"} inPlace={inPlace} allClear={nextStep}
      hide={siteOn && siteShown ? siteItem : undefined} />
    {siteOn ? <SiteTodayCards workspaceId={workspaceId} /> : null}
    {followUp ? <FollowUpSheet workspaceId={workspaceId} recordId={followUp} onClose={() => setFollowUp(null)} onSaved={afterAction} /> : null}
    {creating ? <NewFollowUpDialog workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); afterAction(); }} /> : null}
    {picking ? <ProjectPicker action={picking} projects={projects} onClose={() => setPicking(null)} onPick={(id) => { const action = picking; setPicking(null); router.push(action.onProject!(id)); }} /> : null}
    {work ? <WorkSheet api={api} projectId={work.projectId} itemId={work.itemId} board={work.board}
      onBoard={(board) => setWork((current) => (current ? { ...current, board } : current))}
      onOpenItem={(itemId) => setWork((current) => (current ? { ...current, itemId } : current))}
      onClose={() => { setWork(null); afterAction(); }} /> : null}
  </section>;
}

/** A project action (a new task, a site report) asks which project first when the person has several. */
function ProjectPicker({ action, projects, onClose, onPick }: { action: QuickAction; projects: Array<{ id: string; name: string }>; onClose: () => void; onPick: (projectId: string) => void }) {
  const t = useT();
  const [chosen, setChosen] = useState<string | null>(null);
  return <FormDialog size="md" title={action.label} submitLabel={t("Continue")} onClose={onClose} isSubmitDisabled={!chosen} onSubmit={() => { if (chosen) onPick(chosen); }}>
    <SelectField label={t("Project")} isRequired placeholder={t("Choose a project")} selectedKey={chosen}
      items={projects.map((project) => ({ id: project.id, label: project.name }))} onSelectionChange={(key) => setChosen(key ? String(key) : null)} />
  </FormDialog>;
}
