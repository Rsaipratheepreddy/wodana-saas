"use client";

import { ArrowLeft, ChevronRight, Menu, Moon, Settings, Sun } from "lucide-react";
import type { HrmsBootstrap } from '@wodana/contracts';
import { scopedHrmsNavigation } from '@/lib/hrms/navigation';
import { hrmsRequest } from '@/lib/hrms/client';
import { WoddyMark } from "@/components/brand";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WoddyProvider, useWoddy } from "@/components/crm/woddy-chat";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  findWorkspaceModule,
  findWorkspaceScreen,
  HOME_ROUTES,
  homeTabs,
  type WorkspaceIdentity,
  type WorkspaceModuleDefinition,
  type WorkspaceUser,
} from "./workspace-navigation";
import { WorkspaceFlowNavigation } from "./workspace-flow-navigation";
import { HomeTabs } from "./home-tabs";
import { SettingsLayout } from "./settings-layout";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { WorkspaceNotifications } from "./workspace-notifications";
import { PreProjectProvider, usePreProject } from "@/components/pre-project/pre-project-context";
import { caseRoute } from "@/lib/pre-project/types";
import { preProjectNavigation } from "@/lib/pre-project/navigation";
import { projectNavigation, projectPortfolioNavigation, realProjectRoute } from "@/lib/projects/routing";
import styles from "./workspace.module.css";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { WorkspaceBreadcrumbProvider, useWorkspaceBreadcrumb } from "./workspace-breadcrumb";
import { projectDisplayName } from "@/lib/projects/format";

export type WorkspaceShellProps = {
  children: ReactNode;
  modules: WorkspaceModuleDefinition[];
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string; accountName: string | null }>;
};

export function WorkspaceShell({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
  return <PreProjectProvider><WorkspaceFocusProvider><WorkspaceBreadcrumbProvider><WoddyProvider key={workspaces[0]?.id} workspaceId={workspaces[0]?.id ?? ""}><WorkspaceShellContent modules={modules} unavailableOrganizations={unavailableOrganizations} user={user} workspaces={workspaces}>{children}</WorkspaceShellContent></WoddyProvider></WorkspaceBreadcrumbProvider></WorkspaceFocusProvider></PreProjectProvider>;
}

function WorkspaceShellContent({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
  const pathname = usePathname();
  const breadcrumb = useWorkspaceBreadcrumb();
  const revampedProject = pathname.startsWith("/workspace/projects/new/");
  const builderSearch = useSearchParams();
  const projectId = revampedProject ? pathname.split("/")[4] : null;
  const [loadedProjectName, setLoadedProjectName] = useState<{id:string;name:string;error?:boolean}|null>(null);
  const projectBreadcrumbTitle = breadcrumb?.title || builderSearch.get("projectName")?.trim() || (loadedProjectName?.id === projectId ? loadedProjectName.name : "");
  const preProjectRoute = caseRoute(pathname);
  const projectRoute = realProjectRoute(pathname);
  const projectSection = projectRoute?.section ?? null;
  const projectPortfolio = pathname === "/workspace/projects/clients" || pathname === "/workspace/projects" || pathname === "/workspace/projects/calendar" || pathname === "/workspace/projects/workflow-templates";
  const operationsScreen = ["/workspace/projects/purchasing", "/workspace/projects/inventory", "/workspace/projects/factory"].includes(pathname);
  const moduleSelector = false;
  const { selected } = usePreProject();
  const selectedCase = selected?.record.id === preProjectRoute?.id ? selected : null;
  const registeredFocus = useWorkspaceFocus();
  const focus = registeredFocus;
  const baseModule = findWorkspaceModule(pathname, modules);
  const [hrmsAccess,setHrmsAccess]=useState<{workspaceId:string;permissions:HrmsBootstrap['permissions']}|null>(null);
  const hrmsActive=baseModule.id==='hrms',workspaceId=workspaces[0]?.id??'';
  useEffect(() => {
    if (!projectId || !workspaceId || projectBreadcrumbTitle) return;
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/execution?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Project unavailable");
        const project = await response.json();
        if (typeof project.name !== "string" || !project.name.trim()) throw new Error("Project name unavailable");
        if (!controller.signal.aborted) setLoadedProjectName({id:projectId,name:projectDisplayName(project.name)});
      })
      .catch(() => { if (!controller.signal.aborted) setLoadedProjectName({id:projectId,name:"",error:true}); });
    return () => controller.abort();
  }, [projectId, workspaceId, projectBreadcrumbTitle]);
  useEffect(()=>{if(!hrmsActive||!workspaceId)return;let active=true;hrmsRequest<HrmsBootstrap>(workspaceId,'bootstrap').then(boot=>{if(active)setHrmsAccess({workspaceId,permissions:boot.permissions});}).catch(()=>{});return()=>{active=false;};},[hrmsActive,workspaceId]);
  const activeModule = hrmsActive ? scopedHrmsNavigation(baseModule,hrmsAccess?.workspaceId===workspaceId?hrmsAccess.permissions:undefined) : baseModule.id === "pre-project"
    ? { ...baseModule, navigation: preProjectNavigation(baseModule.navigation, pathname, selectedCase?.search) }
    : projectRoute ? { ...baseModule, navigation: projectNavigation(baseModule.navigation, projectRoute.root) }
    : projectPortfolio ? { ...baseModule, navigation: projectPortfolioNavigation(baseModule.navigation) } : baseModule;
  // The Settings menu belongs to settings pages only, not to every page without a module of its own (Tasks, Approvals…).
  const settingsPage = activeModule.id === "workspace" && activeModule.navigation.some((group) => group.items.some((item) => item.href !== "/workspace" && (pathname === item.href || pathname.startsWith(`${item.href}/`))));
  // Sales sub-sections share /workspace/crm/leads; name the breadcrumb after the tab the person is on.
  const salesSection = pathname === "/workspace/crm/leads" ? builderSearch.get("section") : null;
  const salesSectionLabel = salesSection && ["forms", "sources"].includes(salesSection) ? "Campaigns" : salesSection && ["assignment", "sla", "options", "automations"].includes(salesSection) ? "Settings" : salesSection === "reports" ? "Reports" : null;
  const currentScreen = salesSectionLabel ? { label: salesSectionLabel } : pathname === "/workspace/crm/follow-ups" && ["schedule", "calendar"].includes(builderSearch.get("view") ?? "") ? { label: "Calendar" } : pathname === "/workspace/crm/preparation" ? { label: "Preparation" } : pathname === "/workspace/projects/clients" ? { label: "Clients" } : pathname === "/workspace/tasks" || pathname === "/workspace/approvals" ? { label: "Home" } : pathname === "/workspace/projects/factory" ? { label: "Factory" } : preProjectRoute || projectSection ? activeModule.navigation.flatMap((group) => group.items).find((item) => item.href.split("?")[0] === pathname) ?? findWorkspaceScreen(pathname, modules) : findWorkspaceScreen(pathname, modules);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const woddy = useWoddy();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const mobileOpen = mobileNavigationPath === pathname;
  // Products sit in the top bar; company and account settings open from the utilities.
  const settingsModule = modules.find((module) => module.id === "workspace");
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.dataset.scrollLock = "true";
    return () => {
      delete document.body.dataset.scrollLock;
    };
  }, [mobileOpen]);



  if (preProjectRoute?.section === "quotations" && builderSearch.has("quote")) {
    return <div className={styles.shell} data-workspace-theme={theme} style={{...workspacePrimaryColorStyle(workspaces[0]),display:"block",minHeight:"100dvh"}}><main>{children}</main></div>;
  }

  return (
    <div className={styles.shell} data-workspace-theme={theme} data-account-flow={activeModule.id === "workspace" && pathname !== "/workspace" || undefined} data-task-flow={pathname === "/workspace/tasks" || undefined} data-project-flow={pathname.startsWith("/workspace/pre-projects") || pathname.startsWith("/workspace/projects") || undefined} data-focus={Boolean(focus) || moduleSelector || undefined} data-module-selector={moduleSelector || undefined} data-case-workspace={!!preProjectRoute || !!projectSection || undefined} style={workspacePrimaryColorStyle(workspaces[0])}>
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
          <Dialog aria-label="Mobile workspace navigation" className={styles.mobileDialog}>
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

      <div className={styles.workspaceArea} data-project-revamp={revampedProject || undefined}>
        <header className={styles.topbar}>
          <button
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            className={styles.mobileMenu}
            onClick={() => setMobileNavigationPath(pathname)}
            type="button"
          >
            <Menu size={19} />
          </button>
          {preProjectRoute && !focus ? <div className={styles.caseHeader}><Link aria-label="All planning" className={styles.focusBack} href="/workspace/pre-projects"><ArrowLeft size={16} data-directional="true" /><span>Planning</span></Link>{selectedCase ? <div><strong>{selectedCase.record.title}</strong><small>{selectedCase.record.customerName}</small></div> : null}</div> : null}
          {projectRoute ? <div className={styles.caseHeader}><Link aria-label="All projects" className={styles.focusBack} href="/workspace/projects"><ArrowLeft size={16} data-directional="true" /><span>All projects</span></Link><div><strong>Project workspace</strong><small>Plan · deliver · hand over</small></div></div> : null}
          {focus ? <><Link className={styles.focusBack} href={focus.backHref}><ArrowLeft size={16} /> {preProjectRoute ? (focus.backHref.includes("/quotations") ? "Back to quotations" : "Back to planning") : "Back to CRM"}</Link><strong className={styles.focusTitle}>{focus.title}</strong></> : null}
          <nav aria-label="Breadcrumb" className={styles.breadcrumbs} data-project={revampedProject || undefined}>
            <ol>
              {revampedProject ? <li><Link href="/workspace/projects">Projects</Link><ChevronRight aria-hidden="true" data-directional="true" size={13}/></li> : !operationsScreen && pathname !== "/workspace" && pathname !== "/workspace/tasks" && pathname !== "/workspace/approvals" && !pathname.startsWith("/workspace/catalogs") && currentScreen.label !== activeModule.label ? <li><Link href={activeModule.href}>{activeModule.label}</Link><ChevronRight aria-hidden="true" data-directional="true" size={13} /></li> : null}
              <li aria-current="page" title={revampedProject ? projectBreadcrumbTitle : undefined}>{revampedProject ? projectBreadcrumbTitle ? <Link href={`${pathname}?${new URLSearchParams({projectName:projectBreadcrumbTitle})}`} aria-current="page">{projectBreadcrumbTitle}</Link> : loadedProjectName?.id === projectId && loadedProjectName.error ? <span>Project unavailable</span> : <span aria-busy="true">Loading project…</span> : pathname === "/workspace" ? "Home" : currentScreen.label}</li>
            </ol>
          </nav>
          {HOME_ROUTES.includes(pathname) ? <HomeTabs tabs={homeTabs(modules)} pathname={pathname} /> : null}
          <div className={styles.globalUtilities}>
            <div className={styles.woddyControl}>
              <button
                aria-label="Ask Woddy"
                aria-haspopup="dialog"
                className={styles.woddyButton}
                onClick={woddy?.open}
                title="Ask Woddy"
                type="button"
              >
                <WoddyMark
                  alt=""
                  className={styles.woddyAvatar}
                  priority
                  size={34}
                />
                <span className={styles.woddyLabel}>Ask Woddy</span>
              </button>
            </div>
            <WorkspaceNotifications workspaceId={workspaceId} />
            {settingsModule ? <Link
              aria-current={activeModule.id === "workspace" ? "page" : undefined}
              aria-label="Settings"
              className={styles.themeToggle}
              data-active={activeModule.id === "workspace" || undefined}
              href={settingsModule.href}
              title="Settings"
            >
              <Settings aria-hidden="true" size={16} />
            </Link> : null}
            <button
              aria-label={theme === "light" ? "Use dark mode" : "Use light mode"}
              className={styles.themeToggle}
              onClick={toggleTheme}
              title={theme === "light" ? "Use dark mode" : "Use light mode"}
              type="button"
            >
              {theme === "light" ? <Moon aria-hidden="true" size={16} /> : <Sun aria-hidden="true" size={16} />}
            </button>
            <WorkspaceAccountMenu user={user} />
          </div>
        </header>
        <main className={styles.workspaceContent} data-follow-ups={pathname === "/workspace/crm/follow-ups" || undefined} data-inbox={pathname === "/workspace/crm/conversations" || undefined} data-module={pathname !== "/workspace" ? activeModule.id : undefined}>{pathname !== "/workspace" && activeModule.id !== "workspace" && <WorkspaceFlowNavigation module={activeModule} pathname={pathname} />}{(activeModule.id === "crm" && pathname !== "/workspace" || pathname === "/workspace/projects") ? <div className={`${styles.crmContentPanel} ${styles.recordTablePanel}`} data-overview={pathname === "/workspace/projects" || undefined}>{children}</div> : pathname === "/workspace/pre-projects" ? <div className={styles.recordTablePanel}>{children}</div> : activeModule.id === "workspace" && settingsPage ? <SettingsLayout module={activeModule} pathname={pathname}>{children}</SettingsLayout> : children}</main>
      </div>
    </div>
  );
}
