"use client";

import Link from "next/link";
import { caseRoute, caseHref } from "@/lib/pre-project/types";
import { planningAreas, planningArea } from "@/lib/pre-project/sections";
import { useState } from "react";
import { Button as AriaButton, Tooltip, TooltipTrigger } from "react-aria-components";
import { useSearchParams } from "next/navigation";
import { Info, ChevronDown, Paperclip, Columns3, Home, FolderKanban, Inbox, Users, BellRing, CalendarDays, MessagesSquare, Workflow, ChartNoAxesCombined, FileText } from "lucide-react";
import type { WorkspaceModuleDefinition } from "./workspace-navigation";
import styles from "./workspace.module.css";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";

const tabIcons = { home: Home, projects: FolderKanban, leads: Inbox, opportunities: Columns3, customers: Users, followUps: BellRing, calendar: CalendarDays, conversations: MessagesSquare, automations: Workflow, reports: ChartNoAxesCombined };

const crmTabHelp: Record<string, string> = {
  "crm-overview": tKey("A summary of enquiries, follow-ups and sales results. Use quick actions to open the next piece of work."),
  leads: tKey("An enquiry is a request from a potential customer. Capture their needs, assign an owner, then convert it to an opportunity when it is ready for a sales decision. The original enquiry stays linked."),
  opportunities: tKey("Track each opportunity's value, owner and sales stage. Won is a sales outcome, not an automatically created delivery project."),
  customers: tKey("The shared directory of people and businesses, including prospects and customers. Their records stay linked to enquiries and opportunities; they do not move through the sales stages. One customer can have several enquiries or opportunities."),
  "follow-ups": tKey("Calls, meetings and tasks linked to an enquiry or opportunity. When an enquiry is converted, its pending follow-ups transfer to the opportunity."),
  forms: tKey("Create capture and qualification forms. Capture forms bring requests into Enquiries; qualification forms collect the information needed before conversion."),
  "crm-attachments": tKey("Files attached to enquiry requirement notes. Choose an enquiry to see its files. Attachments support the work; they are not a sales stage."),
};

/** The existing scoped routes remain the source of truth for access and destinations. */
export function WorkspaceFlowNavigation({ module, pathname }: { module: WorkspaceModuleDefinition; pathname: string }) {
  const searchParams = useSearchParams();
  const t = useT();
  const section = searchParams.get("section");
  if (pathname === "/workspace/tasks" || pathname === "/workspace/approvals") return null;
  if (pathname.startsWith("/workspace/integrations/") || pathname === "/workspace/integrations") return null;
  // Projects have no section bar: the list is one page and a project page has its own tabs.
  // Projects, Purchasing and Inventory are separate sidebar entries with their own tabs; no module bar above them.
  // People has its own title and tabs too.
  if (["/workspace/projects", "/workspace/purchasing", "/workspace/inventory", "/workspace/factory", "/workspace/finance", "/workspace/hrms"].some((root) => pathname === root || pathname.startsWith(`${root}/`))) return null;

  const recordRoute = caseRoute(pathname);
  if (recordRoute?.section === "quotations" && searchParams.has("quote")) return null;
  if (recordRoute) {
    const activeSection = recordRoute.section === "requirements" ? (["measurements", "site-plan"].includes(searchParams.get("tab") ?? "") ? "site" : "requirements") : ["measurements", "site-layouts"].includes(recordRoute.section) ? "site" : recordRoute.section;
    const area = planningArea(activeSection);
    const href = (section: string) => {
      const query = new URLSearchParams(searchParams);
      query.delete("tab");
      query.delete("review");
      return caseHref(recordRoute.id, query, section);
    };
    const areaLabels: Record<string, string> = { overview: t("Overview"), requirements: t("Requirements"), site: t("Site"), moodboard: t("Moodboard"), design: t("Design"), quotes: t("Quotes"), agreement: t("Agreement") };
    const viewLabels: Record<string, string> = {
      "client-portal": t("Client access"), "execution-release": t("Release readiness"), requirements: t("Requirements"), measurements: t("Measurements"),
      "site-layouts": t("Photos & plans"), site: t("Visits"), inspiration: t("Moodboard"), definition: t("Scope sign-off"), quotations: t("Quotes"),
      contracts: t("Agreement"), "payment-plan": t("Payments"), approvals: t("Approvals"), variations: t("Change requests"),
    };
    const views = area.id === "overview" ? [] : area.sections;
    return <div className={styles.flowHeader} data-module="crm" data-navigation="chips">
      <nav aria-label={t("Planning sections")} className={styles.flowTabs}>
        <div className={styles.flowTabScroll}>{planningAreas.map(item => <Link key={item.id} href={href(item.section)} className={styles.salesTab} aria-current={item === area ? "page" : undefined}><span>{areaLabels[item.id]}</span></Link>)}</div>
      </nav>
      {views.length > 1 && <nav aria-label={t("{area} views", { area: areaLabels[area.id] })} className={styles.commercialTabs}>
        {views.map(tab => <Link key={tab.id} href={href(tab.id)} className={styles.commercialSegment} aria-current={tab.id === activeSection ? "page" : undefined}>{viewLabels[tab.id] ?? t(tab.label as never)}</Link>)}
      </nav>}
    </div>;
  }

  const activityActive = pathname === "/workspace/crm/calendar" || (pathname === "/workspace/crm/follow-ups" && ["activity", "schedule"].includes(searchParams.get("view") ?? ""));
  if (activityActive || pathname === "/workspace/crm/conversations" || pathname.startsWith("/workspace/crm/customers") || pathname.startsWith("/workspace/crm/organizations")) return null;
  if (String(module.id) === "crm") {
    const allowed = new Set(module.navigation.flatMap(group => group.items).map(item => item.id));
    const settings = ["assignment", "sla", "options", "automations"].includes(section ?? "");
    const tabs = [
      { id: "leads", icon: "enquiries", label: tKey("Enquiries"), href: "/workspace/crm/leads", active: !section && (pathname === "/workspace/crm" || pathname.endsWith("/leads")) },
      { id: "opportunities", icon: "deals", label: tKey("Pipeline"), href: "/workspace/crm/opportunities", active: pathname.includes("/opportunities") },
      { id: "crm-campaigns", icon: "campaigns", label: tKey("Campaigns"), href: "/workspace/crm/leads?section=forms", active: section === "forms" || section === "sources" },
      { id: "crm-reports", icon: "reports", label: tKey("Reports"), href: "/workspace/crm/leads?section=reports", active: section === "reports" || pathname.endsWith("/reports") },
      // Settings holds the routing, response and field rules; for someone who can use only Automations, it opens there.
      { id: allowed.has("crm-settings") ? "crm-settings" : "automations", icon: "settings", label: tKey("Settings"), href: allowed.has("crm-settings") ? "/workspace/crm/leads?section=assignment" : "/workspace/crm/leads?section=automations", active: settings },
    ].filter(tab => allowed.has(tab.id));
    const settingsTabs = [
      ...(allowed.has("crm-settings") ? [{ key: "assignment", label: t("Assignment") }, { key: "sla", label: t("Response targets") }, { key: "options", label: t("Fields") }] : []),
      ...(allowed.has("automations") ? [{ key: "automations", label: t("Automations") }] : []),
    ];
    // A single tab says nothing the page doesn't: each bar shows only when there is a choice.
    const showSettingsTabs = settings && settingsTabs.length > 1;
    if (tabs.length < 2 && !showSettingsTabs) return null;
    return <div className={styles.flowHeader} data-module="crm" data-navigation="chips">{tabs.length > 1 ? <nav aria-label={t("Sales sections")} className={styles.flowTabs}><div className={styles.flowTabScroll}>{tabs.map(tab => <Link key={tab.label} href={tab.href} className={styles.salesTab} data-section={tab.label} aria-current={tab.active ? "page" : undefined}><span>{t(tab.label as never)}</span></Link>)}</div></nav> : null}{showSettingsTabs && <nav aria-label={t("Sales settings")} className={styles.commercialTabs}>{settingsTabs.map(tab => <Link key={tab.key} href={`/workspace/crm/leads?section=${tab.key}`} className={styles.commercialSegment} aria-current={section === tab.key ? "page" : undefined}>{tab.label}</Link>)}</nav>}</div>;
  }
  const items = module.navigation.flatMap((section) => section.items).filter((item) => item.showInSidebar !== false && item.id !== "integrations" && item.id !== "crm-attachments" && (String(module.id) !== "crm" || ["crm-overview", "leads", "opportunities", "follow-ups", "automations", "crm-attachments"].includes(item.id)));
  if (String(module.id) === "crm") items.push(
    { id: "forms", label: tKey("Forms"), href: "/workspace/crm/leads?section=forms", icon: "documents" },
    { id: "assignment-settings", label: tKey("Assignments"), href: "/workspace/crm/leads?section=assignment", icon: "settings" },
    { id: "response-settings", label: tKey("Response times"), href: "/workspace/crm/leads?section=sla", icon: "settings" },
    { id: "field-settings", label: tKey("Fields"), href: "/workspace/crm/leads?section=options", icon: "settings" },
  );
  if (pathname === "/workspace/catalogs" || pathname === "/workspace/pre-projects") return null;
  const resources = items.filter((item) => item.id === "automations" || item.id.endsWith("-settings") || /catalog|master-data|template|settings|workflow|supplier-offers/.test(item.href));
  const order = ["crm-overview", "leads", "opportunities", "follow-ups", "customers", "forms", "sales-settings", "crm-attachments"];
  const flow = items.filter((item) => !resources.includes(item));
  if (String(module.id) === "crm" && resources.length) flow.push({ id: "sales-settings", label: tKey("Settings"), href: "/workspace/crm/leads?section=assignment", icon: "settings" });
  // One tab says nothing the page title doesn't: show the bar only when there's a choice.
  if (flow.length <= 1 && !resources.length) return null;
  const settingsActive = String(module.id) === "crm" && ["assignment", "sla", "options", "automations"].includes(section ?? "");
  if (String(module.id) === "crm") flow.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const activeHref = (section ? items.find((item) => item.href === `${pathname}?section=${section}`)?.href : undefined) ?? [...items].sort((a, b) => b.href.length - a.href.length).find((item) => !item.href.includes("?") && (pathname === item.href.split("?")[0] || pathname.startsWith(`${item.href.split("?")[0]}/`)))?.href;
  return <div className={styles.flowHeader} data-module={module.id}>
    {String(module.id) !== "crm" && module.id !== "projects" && <div className={styles.flowTitle}>{module.id === "pre-project" ? t("Planning") : t(module.label as never)}</div>}
    <nav aria-label={t("Workspace sections")} className={styles.flowTabs}>
      <div className={styles.flowTabScroll}>
        {flow.map((item) => {
          const Icon = item.id === "crm-attachments" ? Paperclip : tabIcons[item.icon as keyof typeof tabIcons] ?? FileText;
          return <div className={styles.flowTabItem} key={item.id}><Link href={item.href} className={styles.flowTab} aria-current={(item.id === "sales-settings" ? settingsActive : !settingsActive && activeHref === item.href) ? "page" : undefined}><Icon size={15} strokeWidth={1.7} aria-hidden="true" /><span>{t(item.label as never)}</span></Link>{String(module.id) === "crm" && crmTabHelp[item.id] && <TabHelp label={t(item.label as never)} description={t(crmTabHelp[item.id] as never)} />}</div>;
        })}
      </div>
      {module.id !== "projects" && String(module.id) !== "crm" && resources.length > 0 && <details className={styles.flowResources} key={`${pathname}?${searchParams}`} onKeyDown={(event) => {
        if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }}>
        <summary data-active={resources.some((item) => item.href === activeHref) || undefined}>{t("Resources & setup")} <ChevronDown size={14} /></summary>
        <div className={styles.flowResourceMenu}>
          {resources.map((item) => <Link key={item.id} href={item.href} aria-current={activeHref === item.href ? "page" : undefined}>{t(item.label as never)}</Link>)}
        </div>
      </details>}
    </nav>
    {settingsActive && <nav aria-label={t("Sales settings")} className={styles.commercialTabs}>{resources.map(item => <Link key={item.id} href={item.href} className={styles.commercialSegment} aria-current={activeHref === item.href ? "page" : undefined}>{t(item.label as never)}</Link>)}</nav>}
  </div>;
}

function TabHelp({ label, description }: { label: string; description: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <TooltipTrigger delay={0} closeDelay={100} isOpen={open} onOpenChange={setOpen}>
    <AriaButton className={styles.tabInfo} aria-label={t("About {label}", { label })} onHoverStart={() => setOpen(true)} onHoverEnd={() => setOpen(false)} onPress={() => setOpen(true)}><Info size={14} aria-hidden="true" /></AriaButton>
    <Tooltip className={styles.tabTooltip} style={{ zIndex: 1000 }} placement="bottom" offset={8}>{description}</Tooltip>
  </TooltipTrigger>;
}
