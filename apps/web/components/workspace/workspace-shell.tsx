"use client";

import { ArrowLeft, ChevronRight, Menu, Moon, Sun } from "lucide-react";
import type { HrmsBootstrap } from '@wodana/contracts';
import { scopedHrmsNavigation } from '@/lib/hrms/navigation';
import { hrmsRequest } from '@/lib/hrms/client';
import Image from "next/image";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { WODDY_MARK_SRC } from "@/lib/brand/identity";
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
import { PreProjectProvider, usePreProject } from "@/components/pre-project/pre-project-context";
import { caseRoute, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import { preProjectNavigation } from "@/lib/pre-project/navigation";
import { DEMO_PROJECT, demoProjectNavigation, demoProjectSection, realProjectRoute, projectNavigation } from "@/lib/projects/demo";
import styles from "./workspace.module.css";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus";

export type WorkspaceShellProps = {
  children: ReactNode;
  modules: WorkspaceModuleDefinition[];
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
};

export function WorkspaceShell({ children, modules, user, workspaces }: WorkspaceShellProps) {
  return <PreProjectProvider><WorkspaceFocusProvider><WoddyProvider key={workspaces[0]?.id} workspaceId={workspaces[0]?.id ?? ""}><WorkspaceShellContent modules={modules} user={user} workspaces={workspaces}>{children}</WorkspaceShellContent></WoddyProvider></WorkspaceFocusProvider></PreProjectProvider>;
}

function WorkspaceShellContent({ children, modules, user, workspaces }: WorkspaceShellProps) {
  const pathname = usePathname();
  const preProjectRoute = caseRoute(pathname);
  const projectRoute = realProjectRoute(pathname);
  const projectSection = projectRoute?.section ?? demoProjectSection(pathname);
  const projectsSelector = pathname === "/workspace/projects";
  const moduleSelector = projectsSelector;
  const { selected } = usePreProject();
  const selectedCase = selected?.record.id === preProjectRoute?.id ? selected : null;
  const backHref = `${PRE_PROJECT_ROOT}${selectedCase?.search ? `?${selectedCase.search}` : ""}`;
  const registeredFocus = useWorkspaceFocus();
  // These destinations are full-page on the first server render, before effects register.
  const routeFocusTitle = pathname === "/workspace/crm/automations" ? "Automations" : null;
  const focus = routeFocusTitle ? { title: routeFocusTitle, backHref: "/workspace/crm" } : registeredFocus;
  const baseModule = findWorkspaceModule(pathname, modules);
  const [hrmsAccess,setHrmsAccess]=useState<{workspaceId:string;permissions:HrmsBootstrap['permissions']}|null>(null);
  const hrmsActive=baseModule.id==='hrms',workspaceId=workspaces[0]?.id??'';
  useEffect(()=>{if(!hrmsActive||!workspaceId)return;let active=true;hrmsRequest<HrmsBootstrap>(workspaceId,'bootstrap').then(boot=>{if(active)setHrmsAccess({workspaceId,permissions:boot.permissions});}).catch(()=>{});return()=>{active=false;};},[hrmsActive,workspaceId]);
  const activeModule = hrmsActive ? scopedHrmsNavigation(baseModule,hrmsAccess?.workspaceId===workspaceId?hrmsAccess.permissions:undefined) : baseModule.id === "pre-project"
    ? { ...baseModule, navigation: preProjectNavigation(baseModule.navigation, pathname, selectedCase?.search) }
    : projectSection ? { ...baseModule, navigation: projectRoute ? projectNavigation(baseModule.navigation,projectRoute.root) : demoProjectNavigation(baseModule.navigation) } : baseModule;
  const currentScreen = preProjectRoute || projectSection ? activeModule.navigation.flatMap((group) => group.items).find((item) => item.href.split("?")[0] === pathname) ?? findWorkspaceScreen(pathname, modules) : findWorkspaceScreen(pathname, modules);
  const currentSection = activeModule.navigation.find((section) =>
    section.items.some((item) => item.href === currentScreen.href),
  );
  const breadcrumbContext =
    activeModule.id === "workspace" ? currentSection?.label : activeModule.label;
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
    <div className={styles.shell} data-focus={Boolean(focus) || moduleSelector || undefined} data-module-selector={moduleSelector || undefined} data-case-workspace={!!preProjectRoute || !!projectSection || undefined}>
      {!moduleSelector ? <div className={styles.desktopSidebar}>
        <WorkspaceSidebar
          activeModule={activeModule}
          key={`${activeModule.id}-${preProjectRoute?.id ?? "module"}`}
          modules={modules}
          navigation={activeModule.navigation}
          pathname={pathname}
          user={user}
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
              navigation={activeModule.navigation}
              onDismiss={() => setMobileNavigationPath(null)}
              onNavigate={() => setMobileNavigationPath(null)}
              pathname={pathname}
              user={user}
              workspaces={workspaces}
            />
          </Dialog>
        </Modal>
      </ModalOverlay> : null}

      <div className={styles.workspaceArea}>
        <header className={styles.topbar}>
          {moduleSelector ? <><WorkspaceModuleSwitcher activeModule={activeModule} modules={modules} /><strong className={styles.selectorTitle}>Projects</strong><span className={styles.selectorWorkspace}>{workspaces[0]?.name}</span></> : null}
          {preProjectRoute && !focus ? <div className={styles.caseHeader}><Link aria-label="Qualified leads" className={styles.focusBack} href={backHref}><ArrowLeft size={16} data-directional="true" /><span>Qualified leads</span></Link><div><strong>{selectedCase?.record.title ?? "Pre-execution"}</strong><small>{selectedCase?.record.customerName ?? "Loading case…"}</small></div></div> : null}
          {projectSection ? <div className={styles.caseHeader}><Link aria-label="All projects" className={styles.focusBack} href="/workspace/projects"><ArrowLeft size={16} data-directional="true" /><span>All projects</span></Link><div><strong>{projectRoute ? "Project workspace" : DEMO_PROJECT.title}</strong><small>{projectRoute ? "Plan · deliver · hand over" : `${DEMO_PROJECT.customer} · Demo`}</small></div></div> : null}
          {focus ? <><Link className={styles.focusBack} href={focus.backHref}><ArrowLeft size={16} /> {preProjectRoute ? (focus.backHref.includes("/quotations") ? "Back to quotations" : "Back to pre-execution") : "Back to CRM"}</Link><strong className={styles.focusTitle}>{focus.title}</strong></> : null}
          <button
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            className={styles.mobileMenu}
            onClick={() => setMobileNavigationPath(pathname)}
            type="button"
          >
            <Menu size={19} />
          </button>
          <span
            aria-label={`Current product: ${activeModule.label}`}
            className={styles.moduleContext}
          >
            {activeModule.label}
          </span>
          <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
            <ol>
              {currentScreen.href === "/workspace" ? (
                <li aria-current="page">{currentScreen.label}</li>
              ) : (
                <>
                  <li>
                    <Link href="/workspace">Home</Link>
                  </li>
                  {breadcrumbContext ? (
                    <>
                      <ChevronRight aria-hidden="true" data-directional="true" size={14} />
                      <li className={styles.breadcrumbContext}>{breadcrumbContext}</li>
                    </>
                  ) : null}
                  <ChevronRight aria-hidden="true" data-directional="true" size={14} />
                  <li aria-current="page">{currentScreen.label}</li>
                </>
              )}
            </ol>
          </nav>
          <div className={styles.woddyControl}>
            <button
              aria-label="Ask Woddy"
              aria-haspopup="dialog"
              className={styles.woddyButton}
              onClick={woddy?.open}
              title="Ask Woddy"
              type="button"
            >
              <Image
                alt=""
                aria-hidden="true"
                className={styles.woddyAvatar}
                height={34}
                priority
                src={WODDY_MARK_SRC}
                width={34}
              />
              <span className={styles.woddyLabel}>Ask Woddy</span>
            </button>
          </div>
          <button
            aria-label={theme === "light" ? "Use dark mode" : "Use light mode"}
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === "light" ? "Use dark mode" : "Use light mode"}
            type="button"
          >
            {theme === "light" ? <Moon aria-hidden="true" size={16} /> : <Sun aria-hidden="true" size={16} />}
          </button>
        </header>
        <main className={styles.workspaceContent}>{children}</main>
      </div>
    </div>
  );
}
