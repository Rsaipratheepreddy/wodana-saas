"use client";

import { ArrowLeft, Menu, Moon, Sun } from "lucide-react";
import type { HrmsBootstrap } from '@wodana/contracts';
import { scopedHrmsNavigation } from '@/lib/hrms/navigation';
import { hrmsRequest } from '@/lib/hrms/client';
import { WoddyMark } from "@/components/brand";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WoddyProvider, useWoddy } from "@/components/crm/woddy-chat";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  findWorkspaceModule,
  findWorkspaceScreen,
  type WorkspaceIdentity,
  type WorkspaceModuleDefinition,
  type WorkspaceUser,
} from "./workspace-navigation";
import { WorkspaceSidebar, WorkspaceModuleSwitcher } from "./workspace-sidebar";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { WorkspaceNotifications } from "./workspace-notifications";
import { PreProjectProvider, usePreProject } from "@/components/pre-project/pre-project-context";
import { caseRoute, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import { preProjectNavigation } from "@/lib/pre-project/navigation";
import { projectNavigation, projectPortfolioNavigation, realProjectRoute } from "@/lib/projects/routing";
import styles from "./workspace.module.css";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { ModuleNavigation } from "@/design-system";

export type WorkspaceShellProps = {
  children: ReactNode;
  modules: WorkspaceModuleDefinition[];
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string; accountName: string | null }>;
};

export function WorkspaceShell({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
  return <PreProjectProvider><WorkspaceFocusProvider><WoddyProvider key={workspaces[0]?.id} workspaceId={workspaces[0]?.id ?? ""}><WorkspaceShellContent modules={modules} unavailableOrganizations={unavailableOrganizations} user={user} workspaces={workspaces}>{children}</WorkspaceShellContent></WoddyProvider></WorkspaceFocusProvider></PreProjectProvider>;
}

function WorkspaceShellContent({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
  const pathname = usePathname();
  const preProjectRoute = caseRoute(pathname);
  const projectRoute = realProjectRoute(pathname);
  const projectSection = projectRoute?.section ?? null;
  const projectPortfolio = pathname === "/workspace/projects" || pathname === "/workspace/projects/calendar" || pathname === "/workspace/projects/workflow-templates";
  const moduleSelector = false;
  const { selected } = usePreProject();
  const selectedCase = selected?.record.id === preProjectRoute?.id ? selected : null;
  const backHref = `${PRE_PROJECT_ROOT}${selectedCase?.search ? `?${selectedCase.search}` : ""}`;
  const registeredFocus = useWorkspaceFocus();
  const focus = registeredFocus;
  const baseModule = findWorkspaceModule(pathname, modules);
  const [hrmsAccess,setHrmsAccess]=useState<{workspaceId:string;permissions:HrmsBootstrap['permissions']}|null>(null);
  const hrmsActive=baseModule.id==='hrms',workspaceId=workspaces[0]?.id??'';
  useEffect(()=>{if(!hrmsActive||!workspaceId)return;let active=true;hrmsRequest<HrmsBootstrap>(workspaceId,'bootstrap').then(boot=>{if(active)setHrmsAccess({workspaceId,permissions:boot.permissions});}).catch(()=>{});return()=>{active=false;};},[hrmsActive,workspaceId]);
  const activeModule = hrmsActive ? scopedHrmsNavigation(baseModule,hrmsAccess?.workspaceId===workspaceId?hrmsAccess.permissions:undefined) : baseModule.id === "pre-project"
    ? { ...baseModule, navigation: preProjectNavigation(baseModule.navigation, pathname, selectedCase?.search) }
    : projectRoute ? { ...baseModule, navigation: projectNavigation(baseModule.navigation, projectRoute.root) }
    : projectPortfolio ? { ...baseModule, navigation: projectPortfolioNavigation(baseModule.navigation) } : baseModule;
  const currentScreen = preProjectRoute || projectSection ? activeModule.navigation.flatMap((group) => group.items).find((item) => item.href.split("?")[0] === pathname) ?? findWorkspaceScreen(pathname, modules) : findWorkspaceScreen(pathname, modules);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const woddy = useWoddy();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const mobileOpen = mobileNavigationPath === pathname;
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.dataset.scrollLock = "true";
    return () => {
      delete document.body.dataset.scrollLock;
    };
  }, [mobileOpen]);



  return (
    <div className={styles.shell} data-brand-palette={workspaces[0]?.brandPalette} data-focus={Boolean(focus) || moduleSelector || undefined} data-module-selector={moduleSelector || undefined} data-case-workspace={!!preProjectRoute || !!projectSection || undefined} style={workspacePrimaryColorStyle(workspaces[0])}>
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

      <div className={styles.workspaceArea}>
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
          <ModuleNavigation activeId={activeModule.id} className={styles.topModuleNav} items={modules} />
          <div className={styles.topModuleMenu}><WorkspaceModuleSwitcher activeModule={activeModule} modules={modules} /></div>
          {preProjectRoute && !focus ? <div className={styles.caseHeader}><Link aria-label="Qualified leads" className={styles.focusBack} href={backHref}><ArrowLeft size={16} data-directional="true" /><span>Qualified leads</span></Link><div><strong>{selectedCase?.record.title ?? "Pre-execution"}</strong><small>{selectedCase?.record.customerName ?? "Loading case…"}</small></div></div> : null}
          {projectRoute ? <div className={styles.caseHeader}><Link aria-label="All projects" className={styles.focusBack} href="/workspace/projects"><ArrowLeft size={16} data-directional="true" /><span>All projects</span></Link><div><strong>Project workspace</strong><small>Plan · deliver · hand over</small></div></div> : null}
          {focus ? <><Link className={styles.focusBack} href={focus.backHref}><ArrowLeft size={16} /> {preProjectRoute ? (focus.backHref.includes("/quotations") ? "Back to quotations" : "Back to pre-execution") : "Back to CRM"}</Link><strong className={styles.focusTitle}>{focus.title}</strong></> : null}
          <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
            <ol><li aria-current="page">{currentScreen.label}</li></ol>
          </nav>
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
        <main className={styles.workspaceContent}>{children}</main>
      </div>
    </div>
  );
}
