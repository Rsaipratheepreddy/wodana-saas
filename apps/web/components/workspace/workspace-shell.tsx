"use client";

import { ArrowLeft, ChevronRight, Menu, Moon, Settings, Sun } from "lucide-react";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WoddyProvider, useWoddy } from "@/components/crm/woddy-chat";
import { useAiReady } from "@/lib/workspace/ai-settings";
import { TourProvider } from "@/components/tours/tour-provider";
import { WoddyMenu } from "@/components/tours/woddy-menu";
import { TourPersonaBadge } from "@/components/tours/tour-persona-badge";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { GridDefaultsProvider, PageChrome, RememberProvider } from "@/design-system";
import { createGridDefaultsSource } from "@/lib/workspace/grid-settings";
import {
  findWorkspaceModule,
  homeTabs,
  peopleTabs,
  productNavigation,
  type WorkspaceIdentity,
  type WorkspaceModuleDefinition,
  type WorkspaceUser,
} from "./workspace-navigation";
import { WorkspaceFlowNavigation } from "./workspace-flow-navigation";
import { HomeTabs, currentTopbarTab } from "./home-tabs";
import { useWaitingCount } from "@/components/approvals/use-waiting-count";
import { SettingsLayout } from "./settings-layout";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { WorkspaceNotifications } from "./workspace-notifications";
import { QuickPanel } from "./quick-panel";
import { CommandPalette } from "./command-palette";
import type { AccessContext } from "@/lib/workspace/access";
import { PreProjectProvider, usePreProject } from "@/components/pre-project/pre-project-context";
import { caseRoute } from "@/lib/pre-project/types";
import { preProjectNavigation } from "@/lib/pre-project/navigation";
import styles from "./workspace.module.css";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { WorkspaceBreadcrumbProvider, useWorkspaceBreadcrumb } from "./workspace-breadcrumb";
import { WorkspaceIdentityProvider } from "./workspace-identity";
import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";
import { useT } from "@/lib/i18n/i18n-provider";

/** Staff screens follow the firm's colours only; its brand typeface (often all-caps) is for client-facing surfaces, so titles stay in sentence case. */
const staffBrandStyle = (workspace?: WorkspaceIdentity) => workspacePrimaryColorStyle({ primaryColor: workspace?.primaryColor, secondaryColor: workspace?.secondaryColor });

export type WorkspaceShellProps = {
  children: ReactNode;
  modules: WorkspaceModuleDefinition[];
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string; accountName: string | null }>;
  /** An owner or administrator: the account menu shows workspace setup progress. */
  canManageWorkspace?: boolean;
  /** Shown at the top of the content on every page, e.g. the view-as banner. */
  banner?: ReactNode;
  /** The person's permissions and roles, for what ⌘K offers to create. */
  access?: AccessContext;
};

export function WorkspaceShell({ banner, children, modules, user, workspaces, unavailableOrganizations = [], canManageWorkspace, access }: WorkspaceShellProps) {
  const identity = workspaces[0] ? { name: workspaces[0].name, logoUrl: workspaces[0].imageUrl ?? null } : null;
  const workspaceId = workspaces[0]?.id;
  const gridDefaults = useMemo(() => workspaceId ? createGridDefaultsSource(workspaceId) : null, [workspaceId]);
  return <PreProjectProvider><WorkspaceFocusProvider><WorkspaceBreadcrumbProvider><WorkspaceIdentityProvider identity={identity}><WoddyProvider key={workspaces[0]?.id} workspaceId={workspaces[0]?.id ?? ""}><TourProvider brandStyle={staffBrandStyle(workspaces[0])} userId={user.id ?? user.email ?? ""} userName={user.name} workspaceId={workspaces[0]?.id}><RememberProvider scope={workspaces[0]?.id && (user.id ?? user.email) ? `${user.id ?? user.email}:${workspaces[0].id}` : null}><GridDefaultsProvider source={gridDefaults}><WorkspaceShellContent banner={banner} canManageWorkspace={canManageWorkspace} modules={modules} unavailableOrganizations={unavailableOrganizations} user={user} workspaces={workspaces} access={access}>{children}</WorkspaceShellContent></GridDefaultsProvider></RememberProvider></TourProvider></WoddyProvider></WorkspaceIdentityProvider></WorkspaceBreadcrumbProvider></WorkspaceFocusProvider></PreProjectProvider>;
}

const FLOW_BUILDER = /^\/workspace\/enquiry-types\/[0-9a-f-]{36}\/?$/i;

function WorkspaceShellContent({ banner, children, modules, user, workspaces, unavailableOrganizations = [], canManageWorkspace, access }: WorkspaceShellProps) {
  const t = useT();
  const pathname = usePathname();
  const breadcrumb = useWorkspaceBreadcrumb();
  // A project page names itself in the breadcrumb (Projects › its name) once it has loaded.
  const projectPage = /^\/workspace\/projects\/[0-9a-f-]{36}(\/|$)/i.test(pathname);
  const builderSearch = useSearchParams();
  const preProjectRoute = caseRoute(pathname);
  const moduleSelector = false;
  const { selected } = usePreProject();
  const selectedCase = selected?.record.id === preProjectRoute?.id ? selected : null;
  const registeredFocus = useWorkspaceFocus();
  const focus = registeredFocus;
  const baseModule = findWorkspaceModule(pathname, modules);
  const workspaceId = workspaces[0]?.id ?? "";
  // What waits for this person across the modules (the Approvals tab's count).
  const waiting = useWaitingCount(workspaceId);
  const activeModule = baseModule.id === "pre-project"
    ? { ...baseModule, navigation: preProjectNavigation(baseModule.navigation, pathname, selectedCase?.search) }
    : baseModule;
  // One route map names the page, its breadcrumb, the sidebar entry and whether it is a Settings page.
  const route = resolveWorkspaceRoute(pathname, builderSearch);
  const recordTitle = projectPage ? breadcrumb?.title : selectedCase?.record.title;
  const pageTitle = route.record && recordTitle ? recordTitle : t(route.label as never);
  // A page that is one of its parent's tabs (Home › Approvals, Sales › Enquiries, People › Teams, a Settings page) is
  // named by its tab, so the breadcrumb ends at the parent instead of saying the name twice.
  // (Follow-ups and Attachments are Sales pages without a tab of their own.)
  const tabbed = route.homeTab || (!route.record && ["sales", "people", "settings", "factory"].includes(route.trail.at(-1)?.id ?? "") && !["follow-ups", "attachments"].includes(route.id));
  // A record page that shows its own name as its title (a project) ends the breadcrumb at the way back.
  const ownTitle = projectPage && Boolean(breadcrumb?.ownTitle);
  const crumbs = tabbed ? route.trail.slice(0, -1) : route.trail;
  const currentCrumb = tabbed ? t((route.trail.at(-1)?.label ?? route.label) as never) : pageTitle;
  const homeTabList = route.id === "home" || route.homeTab ? homeTabs(modules) : [];
  const peopleTabList = route.nav === "team" ? peopleTabs(modules) : [];
  // One title per view: the top bar names the page (its breadcrumb, Home's or People's open tab), so a page whose
  // title repeats one of these keeps it for screen readers only. The module's tab bar and the Settings menu add theirs.
  const openTopbarTab = currentTopbarTab(homeTabList, pathname) ?? currentTopbarTab(peopleTabList, pathname, true);
  const chromeNames = [...crumbs.map((crumb) => t(crumb.label as never)), currentCrumb, openTopbarTab ? t(openTopbarTab.label as never) : null];
  const workspaceName = workspaces[0]?.name;
  useEffect(() => {
    document.title = workspaceName ? `${pageTitle} · ${workspaceName}` : pageTitle;
  }, [pageTitle, workspaceName]);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const woddy = useWoddy();
  // Woddy's chat answers with AI: offered only where AI is switched on and set up.
  const aiReady = useAiReady(workspaces[0]?.id);
  const { theme, toggleTheme } = useWorkspaceTheme();
  const mobileOpen = mobileNavigationPath === pathname;
  // Products sit in the top bar; company and account settings open from the utilities.
  const settingsModule = modules.find((module) => module.id === "workspace");
  // People's areas (directory, teams, roles, attendance), as far as the person can open them.
  const people = peopleTabs(modules);
  // The Settings gear opens the first Settings page this person can use.
  const settingsHref = productNavigation(modules).flatMap((section) => section.items).find((item) => item.id === "settings")?.href ?? route.trail.find((crumb) => crumb.id === "settings")?.href ?? "/workspace/settings/profile";
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.dataset.scrollLock = "true";
    return () => {
      delete document.body.dataset.scrollLock;
    };
  }, [mobileOpen]);



  // The quote builder, the steps builder and the client view take the whole screen: the client view shows the portal as
  // the client does; the builders are focused editors with their own slim top bar and a way back.
  if (preProjectRoute?.section === "quotations" && builderSearch.has("quote") || pathname.startsWith("/workspace/client-view/") || FLOW_BUILDER.test(pathname)) {
    return <div className={styles.shell} data-workspace-theme={theme} style={{...staffBrandStyle(workspaces[0]),display:"block",minHeight:"100dvh"}}><main data-tour="page-content">{banner}{children}</main></div>;
  }

  return (
    <div className={styles.shell} data-workspace-theme={theme} data-account-flow={activeModule.id === "workspace" && pathname !== "/workspace" || undefined} data-task-flow={pathname === "/workspace/tasks" || undefined} data-project-flow={pathname.startsWith("/workspace/pre-projects") || pathname.startsWith("/workspace/projects") || undefined} data-focus={Boolean(focus) || moduleSelector || undefined} data-module-selector={moduleSelector || undefined} data-case-workspace={!!preProjectRoute || undefined} style={staffBrandStyle(workspaces[0])}>
      {!moduleSelector ? <div className={styles.desktopSidebar}>
        <WorkspaceSidebar
          activeModule={activeModule}
          key={`${activeModule.id}-${preProjectRoute?.id ?? "module"}`}
          modules={modules}
          unavailableOrganizations={unavailableOrganizations}
          navigation={activeModule.navigation}
          pathname={pathname}
          workspaces={workspaces}
        />
      </div> : null}

      {!moduleSelector ? <ModalOverlay
        className={styles.mobileOverlay}
        isDismissable
        isOpen={mobileOpen}
        onOpenChange={(open) => setMobileNavigationPath(open ? pathname : null)}
      >
        <Modal className={styles.mobileModal}>
          <Dialog aria-label={t("Mobile workspace navigation")} className={styles.mobileDialog}>
            <WorkspaceSidebar
              activeModule={activeModule}
                  key={`mobile-${activeModule.id}-${preProjectRoute?.id ?? "module"}`}
              mode="mobile"
              modules={modules}
              unavailableOrganizations={unavailableOrganizations}
              navigation={activeModule.navigation}
              onDismiss={() => setMobileNavigationPath(null)}
              onNavigate={() => setMobileNavigationPath(null)}
              pathname={pathname}
              workspaces={workspaces}
            />
          </Dialog>
        </Modal>
      </ModalOverlay> : null}

      <div className={styles.workspaceArea}>
        <header className={styles.topbar}>
          <button
            aria-expanded={mobileOpen}
            aria-label={t("Open navigation")}
            className={styles.mobileMenu}
            onClick={() => setMobileNavigationPath(pathname)}
            type="button"
          >
            <Menu size={19} />
          </button>
          {/* The case's Overview names the case in its own header; the other sections show it here. */}
          {preProjectRoute && !focus ? <div className={styles.caseHeader}><Link aria-label={t("All planning")} className={styles.focusBack} href="/workspace/pre-projects"><ArrowLeft size={16} data-directional="true" /><span>{t("Planning")}</span></Link>{selectedCase && preProjectRoute.section !== "overview" ? <div><strong>{selectedCase.record.title}</strong><small>{selectedCase.record.customerName}</small></div> : null}</div> : null}
          {focus ? <><Link className={styles.focusBack} href={focus.backHref}><ArrowLeft size={16} /> {preProjectRoute ? (focus.backHref.includes("/quotations") ? t("Back to quotations") : t("Back to planning")) : t("Back to CRM")}</Link><strong className={styles.focusTitle}>{focus.title}</strong></> : null}
          <nav aria-label={t("Breadcrumb")} className={styles.breadcrumbs} data-own-title={ownTitle || undefined} data-topbar-tabs={homeTabList.length > 1 || peopleTabList.length > 1 || undefined}>
            <ol>
              {crumbs.map((crumb, index) => <li key={crumb.id}><Link href={crumb.id === "settings" ? settingsHref : crumb.id === "people" ? people[0]?.href ?? crumb.href : crumb.href}>{t(crumb.label as never)}</Link>{ownTitle && index === crumbs.length - 1 ? null : <ChevronRight aria-hidden="true" data-directional="true" size={13} />}</li>)}
              {ownTitle ? null : <li aria-current="page">{route.record && !recordTitle ? <span aria-busy="true">{currentCrumb}</span> : currentCrumb}</li>}
            </ol>
          </nav>
          {route.id === "home" || route.homeTab ? <HomeTabs tabs={homeTabs(modules)} pathname={pathname} counts={{ approvals: waiting }} /> : null}
          {route.nav === "team" ? <HomeTabs label="People" nested tabs={people} pathname={pathname} /> : null}
          <div className={styles.globalUtilities}>
            {workspaceId ? <CommandPalette workspaceId={workspaceId} modules={modules} access={access ?? {}} /> : null}
            <TourPersonaBadge />
            <div className={styles.woddyControl}>
              {/* §0.3 P11: Help (this screen and the tours); the assistant panel is gone, AI suggests inside each step. */}
              <WoddyMenu plain className={styles.themeToggle} />
            </div>
            {workspaceId ? <QuickPanel workspaceId={workspaceId} className={styles.themeToggle} /> : null}
            <WorkspaceNotifications workspaceId={workspaceId} />
            {settingsModule ? <Link
              aria-current={route.settings ? "page" : undefined}
              aria-label={t("Settings")}
              className={styles.themeToggle}
              data-active={route.settings || undefined}
              href={settingsHref}
              title={t("Settings")}
            >
              <Settings aria-hidden="true" size={16} />
            </Link> : null}
            <button
              aria-label={theme === "light" ? t("Use dark mode") : t("Use light mode")}
              className={styles.themeToggle}
              onClick={toggleTheme}
              title={theme === "light" ? t("Use dark mode") : t("Use light mode")}
              type="button"
            >
              {theme === "light" ? <Moon aria-hidden="true" size={16} /> : <Sun aria-hidden="true" size={16} />}
            </button>
            <WorkspaceAccountMenu setup={canManageWorkspace && workspaceId ? { workspaceId, modules: modules.map((module) => module.id) } : undefined} user={user}
              attendance={workspaceId && modules.some((module) => module.id === "hrms") ? { workspaceId } : undefined} />
          </div>
        </header>
        <main className={styles.workspaceContent} data-tour="page-content" data-follow-ups={pathname === "/workspace/crm/follow-ups" || undefined} data-inbox={pathname === "/workspace/crm/conversations" || undefined} data-module={pathname !== "/workspace" ? activeModule.id : undefined}>{banner}<PageChrome names={chromeNames}><WorkspaceFlowNavigation hidden={pathname === "/workspace" || activeModule.id === "workspace"} module={activeModule} pathname={pathname}>{(activeModule.id === "crm" && pathname !== "/workspace" || pathname === "/workspace/projects" || projectPage) ? <div className={`${styles.crmContentPanel} ${styles.recordTablePanel}`} data-overview={pathname === "/workspace/projects" || projectPage || undefined}>{children}</div> : pathname === "/workspace/pre-projects" ? <div className={styles.recordTablePanel}>{children}</div> : route.settings && settingsModule ? <SettingsLayout module={settingsModule} pathname={pathname}>{children}</SettingsLayout> : children}</WorkspaceFlowNavigation></PageChrome></main>
      </div>
    </div>
  );
}
