"use client";

import { ArrowLeft, ChevronRight, Menu, Moon, Settings, Sun } from "lucide-react";
import { WoddyMark } from "@/components/brand";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WoddyProvider, useWoddy } from "@/components/crm/woddy-chat";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import {
  findWorkspaceModule,
  homeTabs,
  productNavigation,
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
import styles from "./workspace.module.css";
import { WorkspaceFocusProvider, useWorkspaceFocus } from "./workspace-focus";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { WorkspaceBreadcrumbProvider, useWorkspaceBreadcrumb } from "./workspace-breadcrumb";
import { WorkspaceIdentityProvider } from "./workspace-identity";
import { resolveWorkspaceRoute } from "@/lib/workspace/route-map";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";

export type WorkspaceShellProps = {
  children: ReactNode;
  modules: WorkspaceModuleDefinition[];
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string; accountName: string | null }>;
};

export function WorkspaceShell({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
  const identity = workspaces[0] ? { name: workspaces[0].name, logoUrl: workspaces[0].imageUrl ?? null } : null;
  return <PreProjectProvider><WorkspaceFocusProvider><WorkspaceBreadcrumbProvider><WorkspaceIdentityProvider identity={identity}><WoddyProvider key={workspaces[0]?.id} workspaceId={workspaces[0]?.id ?? ""}><WorkspaceShellContent modules={modules} unavailableOrganizations={unavailableOrganizations} user={user} workspaces={workspaces}>{children}</WorkspaceShellContent></WoddyProvider></WorkspaceIdentityProvider></WorkspaceBreadcrumbProvider></WorkspaceFocusProvider></PreProjectProvider>;
}

function WorkspaceShellContent({ children, modules, user, workspaces, unavailableOrganizations = [] }: WorkspaceShellProps) {
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
  const activeModule = baseModule.id === "pre-project"
    ? { ...baseModule, navigation: preProjectNavigation(baseModule.navigation, pathname, selectedCase?.search) }
    : baseModule;
  // One route map names the page, its breadcrumb, the sidebar entry and whether it is a Settings page.
  const route = resolveWorkspaceRoute(pathname, builderSearch);
  const recordTitle = projectPage ? breadcrumb?.title : selectedCase?.record.title;
  const pageTitle = route.record && recordTitle ? recordTitle : t(route.label as never);
  const crumbs = route.homeTab ? route.trail.slice(0, -1) : route.trail;
  const currentCrumb = route.homeTab ? t((route.trail.at(-1)?.label ?? route.label) as never) : pageTitle;
  const workspaceName = workspaces[0]?.name;
  useEffect(() => {
    document.title = workspaceName ? `${pageTitle} · ${workspaceName}` : pageTitle;
  }, [pageTitle, workspaceName]);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const woddy = useWoddy();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const mobileOpen = mobileNavigationPath === pathname;
  // Products sit in the top bar; company and account settings open from the utilities.
  const settingsModule = modules.find((module) => module.id === "workspace");
  // The Settings gear opens the first Settings page this person can use.
  const settingsHref = productNavigation(modules).flatMap((section) => section.items).find((item) => item.id === "settings")?.href ?? route.trail.find((crumb) => crumb.id === "settings")?.href ?? "/workspace/settings/profile";
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
    <div className={styles.shell} data-workspace-theme={theme} data-account-flow={activeModule.id === "workspace" && pathname !== "/workspace" || undefined} data-task-flow={pathname === "/workspace/tasks" || undefined} data-project-flow={pathname.startsWith("/workspace/pre-projects") || pathname.startsWith("/workspace/projects") || undefined} data-focus={Boolean(focus) || moduleSelector || undefined} data-module-selector={moduleSelector || undefined} data-case-workspace={!!preProjectRoute || undefined} style={workspacePrimaryColorStyle(workspaces[0])}>
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
          {preProjectRoute && !focus ? <div className={styles.caseHeader}><Link aria-label={t("All planning")} className={styles.focusBack} href="/workspace/pre-projects"><ArrowLeft size={16} data-directional="true" /><span>{t("Planning")}</span></Link>{selectedCase ? <div><strong>{selectedCase.record.title}</strong><small>{selectedCase.record.customerName}</small></div> : null}</div> : null}
          {focus ? <><Link className={styles.focusBack} href={focus.backHref}><ArrowLeft size={16} /> {preProjectRoute ? (focus.backHref.includes("/quotations") ? t("Back to quotations") : t("Back to planning")) : t("Back to CRM")}</Link><strong className={styles.focusTitle}>{focus.title}</strong></> : null}
          <nav aria-label={t("Breadcrumb")} className={styles.breadcrumbs}>
            <ol>
              {crumbs.map((crumb) => <li key={crumb.id}><Link href={crumb.id === "settings" ? settingsHref : crumb.href}>{t(crumb.label as never)}</Link><ChevronRight aria-hidden="true" data-directional="true" size={13} /></li>)}
              <li aria-current="page">{route.record && !recordTitle ? <span aria-busy="true">{currentCrumb}</span> : currentCrumb}</li>
            </ol>
          </nav>
          {route.id === "home" || route.homeTab ? <HomeTabs tabs={homeTabs(modules)} pathname={pathname} /> : null}
          <div className={styles.globalUtilities}>
            <div className={styles.woddyControl}>
              <button
                aria-label={t("Ask Woddy")}
                aria-haspopup="dialog"
                className={styles.woddyButton}
                onClick={woddy?.open}
                title={t("Ask Woddy")}
                type="button"
              >
                <WoddyMark
                  alt=""
                  className={styles.woddyAvatar}
                  priority
                  size={34}
                />
                <span className={styles.woddyLabel}>{t("Ask Woddy")}</span>
              </button>
            </div>
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
            <WorkspaceAccountMenu user={user} />
          </div>
        </header>
        <main className={styles.workspaceContent} data-follow-ups={pathname === "/workspace/crm/follow-ups" || undefined} data-inbox={pathname === "/workspace/crm/conversations" || undefined} data-module={pathname !== "/workspace" ? activeModule.id : undefined}>{pathname !== "/workspace" && activeModule.id !== "workspace" && <WorkspaceFlowNavigation module={activeModule} pathname={pathname} />}{(activeModule.id === "crm" && pathname !== "/workspace" || pathname === "/workspace/projects" || projectPage) ? <div className={`${styles.crmContentPanel} ${styles.recordTablePanel}`} data-overview={pathname === "/workspace/projects" || projectPage || undefined}>{children}</div> : pathname === "/workspace/pre-projects" ? <div className={styles.recordTablePanel}>{children}</div> : route.settings && settingsModule ? <SettingsLayout module={settingsModule} pathname={pathname}>{children}</SettingsLayout> : children}</main>
      </div>
    </div>
  );
}
