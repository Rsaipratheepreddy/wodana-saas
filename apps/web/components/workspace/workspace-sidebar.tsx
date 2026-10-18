"use client";

import Link from "next/link";
import { ProjectShortcuts } from "./project-shortcuts";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  BadgeDollarSign,
  BellRing,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Calculator,
  ChevronDown,
  ChevronsUpDown,
  ClipboardCheck,
  Route,
  ClipboardList,
  Factory,
  FileText,
  FileSignature,
  FolderKanban,
  GitCompareArrows,
  Hammer,
  Handshake,
  Home,
  KeyRound,
  LayoutGrid,
  Languages,
  MapPinned,
  MessagesSquare,
  PackageSearch,
  PackageCheck,
  Palette,
  Plug,
  Ruler,
  Send,
  Settings,
  ShoppingCart,
  Users,
  UserCog,
  Network,
  ScrollText,
  ShieldCheck,
  CreditCard,
  Workflow,
  Wrench,
  X,
  ChartNoAxesCombined,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import {
  useId,
  useMemo,
  useState,
} from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";
import type {
  WorkspaceIconName,
  WorkspaceIdentity,
  WorkspaceModuleDefinition,
  WorkspaceNavigationSection,
} from "./workspace-navigation";
import { useTours } from "@/components/tours/tour-provider";
import { inPersonaView } from "@/lib/tours/personas";
import { ModuleIcon as WorkspaceModuleIconTile } from "@/design-system/atoms/module-icon";
import { productNavigation, productNavigationActive } from "./workspace-navigation";
import styles from "./workspace.module.css";
import { useWaitingCount } from "@/components/approvals/use-waiting-count";
import { identityInitials, identityStyle as visualForIdentity } from "@/lib/brand/identity";
import { useT } from "@/lib/i18n/i18n-provider";

const icons: Record<WorkspaceIconName, LucideIcon> = {
  activity: Activity,
  audit: ScrollText,
  automations: Workflow,
  billing: CreditCard,
  calendar: CalendarDays,
  boq: Calculator,
  commercial: BadgeDollarSign,
  contracts: FileSignature,
  company: Building2,
  companies: Building2,
  conversations: MessagesSquare,
  customers: Users,
  designs: Palette,
  documents: FileText,
  executionRelease: PackageCheck,
  handover: KeyRound,
  home: Home,
  installation: Hammer,
  integrations: Plug,
  language: Languages,
  leads: BriefcaseBusiness,
  materialPlan: PackageSearch,
  measurements: Ruler,
  members: Users,
  opportunities: Handshake,
  preProjects: ClipboardCheck,
  jobs: Route,
  teamChat: MessageSquareText,
  procurement: ShoppingCart,
  production: Factory,
  projects: FolderKanban,
  reports: ChartNoAxesCombined,
  requirements: ClipboardList,
  roles: UserCog,
  security: ShieldCheck,
  sequences: Send,
  settings: Settings,
  siteVisits: MapPinned,
  snagging: Wrench,
  teams: Network,
  variations: GitCompareArrows,
  followUps: BellRing,
  workspace: LayoutGrid,
};

export function WorkspaceModuleSwitcher({ activeModule, modules }: { activeModule: WorkspaceModuleDefinition; modules: WorkspaceModuleDefinition[] }) {
  const t = useT();
  const ActiveIcon = icons[activeModule.icon];
  return <DialogTrigger><AriaButton aria-label={t("Switch module. Current: {module}", { module: t(activeModule.label as never) })} className={styles.moduleButton}><ActiveIcon aria-hidden="true" size={16} /><span>{t(activeModule.label as never)}</span><ChevronDown aria-hidden="true" size={14} /></AriaButton>
    <Popover className={styles.modulePopover} offset={8} placement="bottom start"><Dialog aria-label={t("Choose module")} className={styles.moduleDialog}>{({ close }) => <><p className={styles.popoverLabel}>{t("Workspaces")}</p>{modules.map((module) => {
      const ModuleIcon = icons[module.icon];
      return <Link aria-current={module.id === activeModule.id ? "page" : undefined} className={styles.moduleOption} data-selected={module.id === activeModule.id || undefined} href={module.href} key={module.id} onClick={close}><span aria-hidden="true" className={styles.moduleOptionIcon} data-module={module.id}><ModuleIcon size={17} strokeWidth={1.8} /></span><span><strong>{t(module.label as never)}</strong><small>{t(module.description as never)}</small></span></Link>;
    })}</>}</Dialog></Popover>
  </DialogTrigger>;
}

/** Home's count of what waits for this person (approvals across the modules). */
function WaitingBadge({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const count = useWaitingCount(workspaceId);
  if (!count) return null;
  return <span className={`wd-count-chip ${styles.navigationCount}`} aria-label={t("{count} waiting", { count })}>{count}</span>;
}

export type WorkspaceSidebarProps = {
  activeModule: WorkspaceModuleDefinition;
  activeItemId?: string;
  mode?: "desktop" | "mobile";
  modules: WorkspaceModuleDefinition[];
  unavailableOrganizations?: Array<{ workspaceId: string; workspaceName: string; workspaceStatus: string; accountName: string | null }>;
  navigation: WorkspaceNavigationSection[];
  onDismiss?: () => void;
  onNavigate?: () => void;
  pathname: string;
  workspaces: WorkspaceIdentity[];
};

export function WorkspaceSidebar({
  activeModule,
  activeItemId,
  modules,
  mode = "desktop",
  unavailableOrganizations = [],
  onDismiss,
  onNavigate,
  pathname,
  workspaces,
}: WorkspaceSidebarProps) {
  const t = useT();
  // A tour's demo "view as": destinations outside the current person's work step back (presentation only).
  const tourActor = useTours()?.persona?.id ?? null;
  const contextualNavigation = useMemo(() => productNavigation(modules), [modules]);
  const instanceId = useId().replaceAll(":", "");
  const searchParams = useSearchParams();
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const visibleNavigation = useMemo(() => contextualNavigation
    .map((section) => ({ ...section, items: section.items.filter((item) => item.showInSidebar !== false) }))
    .filter((section) => section.items.length > 0), [contextualNavigation]);
  // Newly authorized navigation groups start expanded; only explicit collapses are stored.
  const [closedSections, setClosedSections] = useState(() => new Set<string>());
  const [submenuOpen, setSubmenuOpen] = useState<Record<string, boolean>>({});
  const activeWorkspace = workspaces[0];
  const activeWorkspaceVisual = visualForIdentity(
    activeWorkspace?.id ?? "workspace",
    activeWorkspace?.imageUrl,
    { fit: "contain", surface: "brand" },
  );

  const toggleSection = (sectionId: string) => {
    setClosedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const location = searchParams.size ? `${pathname}?${searchParams}` : pathname;
  const submenuIsOpen = (itemId: string, active: boolean) => submenuOpen[itemId] ?? active;
  const toggleSubmenu = (itemId: string, active: boolean) => {
    setSubmenuOpen((current) => ({ ...current, [itemId]: !(current[itemId] ?? active) }));
  };

  return (
    <div className={styles.sidebarFrame} data-mode={mode}>
      <aside aria-label={t("Workspace navigation")} className={styles.sidebarCard}>
        <div className={styles.workspaceHeader}>
          <DialogTrigger>
            <AriaButton
              aria-label={t("Switch workspace. Current: {workspace}", { workspace: activeWorkspace?.name ?? t("Workspace") })}
              className={styles.workspaceButton}
            >
              <span
                aria-hidden="true"
                className={styles.workspaceMark}
                data-has-image={activeWorkspace?.imageUrl ? true : undefined}
                data-workspace-mark
                style={activeWorkspaceVisual}
              >
                {activeWorkspace?.imageUrl ? null : identityInitials(activeWorkspace?.name ?? t("Workspace"))}
              </span>
              <span className={styles.workspaceIdentity}>
                <strong>{activeWorkspace?.name ?? t("Workspace")}</strong>
                <small>{activeWorkspace?.description ?? t("Business workspace")}</small>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                className={styles.workspaceChevron}
                size={15}
              />
            </AriaButton>
            <Popover
              className={styles.workspacePopover}
              offset={mode === "desktop" ? 46 : 8}
              placement={mode === "desktop" ? "right top" : "bottom start"}
            >
              <Dialog aria-label={t("Choose workspace")} className={styles.workspaceDialog}>
                {({ close }) => (
                  <>
                    <p className={styles.popoverLabel}>{t("Workspaces")}</p>
                    {workspaceError ? <p role="alert">{workspaceError}</p> : null}
                    {workspaces.map((workspace) => (
                      <AriaButton
                        className={styles.workspaceOption}
                        data-selected={workspace.id === activeWorkspace?.id || undefined}
                        key={workspace.id}
                        isDisabled={switchingWorkspace}
                        onPress={async () => {
                          if (workspace.id === activeWorkspace?.id) { close(); return; }
                          setSwitchingWorkspace(true); setWorkspaceError("");
                          try {
                            const response = await fetch("/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id }) });
                            if (!response.ok) throw new Error(t("Workspace could not be switched. Your current workspace is unchanged."));
                            window.location.assign(activeModule.href);
                          } catch (error) { setWorkspaceError((error as Error).message); setSwitchingWorkspace(false); }
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className={styles.optionMark}
                          data-has-image={workspace.imageUrl ? true : undefined}
                          style={visualForIdentity(workspace.id, workspace.imageUrl, { fit: "contain", surface: "brand" })}
                        >
                          {workspace.imageUrl ? null : identityInitials(workspace.name)}
                        </span>
                        <span>
                          <strong>{workspace.name}</strong>
                          <small>{workspace.description}</small>
                        </span>
                      </AriaButton>
                    ))}
                    {unavailableOrganizations.map((organization) => (
                      <div aria-disabled="true" className={styles.workspaceOption} key={organization.workspaceId}>
                        <span aria-hidden="true" className={styles.optionMark} style={visualForIdentity(organization.workspaceId)}>{identityInitials(organization.workspaceName)}</span>
                        <span><strong>{organization.workspaceName}</strong><small>{organization.accountName ? `${organization.accountName} · ` : ""}{organization.workspaceStatus === "suspended" ? t("Suspended") : t("Unavailable")}</small></span>
                      </div>
                    ))}
                    <Link
                      className={styles.workspaceManageLink}
                      href="/workspace/organizations"
                      onClick={() => {
                        onNavigate?.();
                        close();
                      }}
                    >
                      <strong>{t("Add or manage workspaces")}</strong>
                      <small>{t("For a separate company with its own team, data and branding.")}</small>
                    </Link>
                  </>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
          {mode === "mobile" ? (
            <AriaButton
              aria-label={t("Close navigation")}
              className={styles.mobileClose}
              onPress={onDismiss}
            >
              <X size={18} />
            </AriaButton>
          ) : null}
        </div>

        <nav aria-label={t("Main navigation")} className={styles.navigation}>
          {visibleNavigation.map((section) => {
            const sectionContentId = `${instanceId}-${section.id}`;
            const isOpen =
              !section.label || !closedSections.has(section.id);
            return (
              <section className={styles.navigationSection} data-heading={Boolean(section.label) || undefined} key={section.id}>
                {section.label ? (
                  <AriaButton
                    aria-controls={sectionContentId}
                    aria-expanded={isOpen}
                    className={styles.sectionToggle}
                    onPress={() => toggleSection(section.id)}
                  >
                    <span>{t(section.label as never)}</span>
                    <ChevronDown aria-hidden="true" data-open={isOpen || undefined} size={15} />
                  </AriaButton>
                ) : null}
                <div
                  aria-hidden={!isOpen}
                  className={styles.sectionContent}
                  data-open={isOpen || undefined}
                  id={sectionContentId}
                >
                  <div className={styles.sectionContentInner}>
                    {section.items.map((item) => {
                      const ItemIcon = icons[item.icon];
                      const active = item.id === (activeItemId ?? productNavigationActive(pathname, searchParams, visibleNavigation));
                      const defaultOpen = active || Boolean(item.children?.some((child) => child.href.split("?")[0] === pathname));
                      const showSubmenu = Boolean(item.children?.length) && submenuIsOpen(item.id, defaultOpen);
                      return (
                        <div className={styles.navigationItemGroup} data-destination={item.id} data-persona-muted={!inPersonaView(tourActor, item.id) || undefined} key={item.id}>
                          <div className={styles.navigationItemRow} data-active={active || undefined}>
                            {item.children?.length ? (
                              <AriaButton
                                aria-controls={`${instanceId}-${item.id}-submenu`}
                                aria-expanded={showSubmenu}
                                className={`${styles.navigationItem} ${styles.accordionTrigger}`}
                                isDisabled={!isOpen}
                                onPress={() => toggleSubmenu(item.id, defaultOpen)}
                              >
                                <WorkspaceModuleIconTile className={styles.navigationMark}><ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} /></WorkspaceModuleIconTile>
                                <span>{t(item.label as never)}</span>
                                <ChevronDown aria-hidden="true" className={styles.accordionChevron} data-open={showSubmenu || undefined} size={15} />
                              </AriaButton>
                            ) : <Link
                              aria-current={active ? "page" : undefined}
                              className={styles.navigationItem}
                              data-active={active || undefined}
                              data-tour={`nav-${item.id}`}
                              href={item.href}
                              onClick={onNavigate}
                              tabIndex={isOpen ? undefined : -1}
                            >
                              <WorkspaceModuleIconTile className={styles.navigationMark}><ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} /></WorkspaceModuleIconTile>
                              <span>{t(item.label as never)}</span>
                              {item.id === "home" && activeWorkspace?.id ? <WaitingBadge workspaceId={activeWorkspace.id} /> : null}
                            </Link>}
                          </div>
                          {item.id === "projects" && activeWorkspace?.id ? <ProjectShortcuts workspaceId={activeWorkspace.id} pathname={pathname} visible={isOpen} onNavigate={onNavigate} /> : null}
                          {item.children?.length ? <div aria-hidden={!showSubmenu} className={styles.submenu} data-open={showSubmenu || undefined} id={`${instanceId}-${item.id}-submenu`}>
                            <div className={styles.submenuInner}>{item.children.map((child) => {
                              const childActive = location === child.href;
                              return <Link aria-current={childActive ? "page" : undefined} className={styles.submenuItem} data-active={childActive || undefined} href={child.href} key={child.id} onClick={onNavigate} tabIndex={isOpen && showSubmenu ? undefined : -1}>{t(child.label as never)}</Link>;
                            })}</div>
                          </div> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </nav>

      </aside>

    </div>
  );
}
