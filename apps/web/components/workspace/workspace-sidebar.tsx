"use client";

import Link from "next/link";
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
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
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
import styles from "./workspace.module.css";
import { identityInitials, identityStyle as visualForIdentity } from "@/lib/brand/identity";
import { WorkspaceUniversalSearch } from "./workspace-universal-search";

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
  const ActiveIcon = icons[activeModule.icon];
  return <DialogTrigger><AriaButton aria-label={`Switch module. Current: ${activeModule.label}`} className={styles.moduleButton}><ActiveIcon aria-hidden="true" size={16} /><span>{activeModule.label}</span><ChevronDown aria-hidden="true" size={14} /></AriaButton>
    <Popover className={styles.modulePopover} offset={8} placement="bottom start"><Dialog aria-label="Choose module" className={styles.moduleDialog}>{({ close }) => <><p className={styles.popoverLabel}>Products</p>{modules.map((module) => {
      const ModuleIcon = icons[module.icon];
      return <Link aria-current={module.id === activeModule.id ? "page" : undefined} className={styles.moduleOption} data-selected={module.id === activeModule.id || undefined} href={module.href} key={module.id} onClick={close}><span aria-hidden="true" className={styles.moduleOptionIcon} data-module={module.id}><ModuleIcon size={17} strokeWidth={1.8} /></span><span><strong>{module.label}</strong><small>{module.description}</small></span></Link>;
    })}</>}</Dialog></Popover>
  </DialogTrigger>;
}

export type WorkspaceSidebarProps = {
  activeModule: WorkspaceModuleDefinition;
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
  mode = "desktop",
  unavailableOrganizations = [],
  navigation,
  onDismiss,
  onNavigate,
  pathname,
  workspaces,
}: WorkspaceSidebarProps) {
  const instanceId = useId().replaceAll(":", "");
  const searchParams = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [query, setQuery] = useState("");
  const visibleNavigation = useMemo(() => navigation
    .map((section) => ({ ...section, items: section.items.filter((item) => item.showInSidebar !== false) }))
    .filter((section) => section.items.length > 0), [navigation]);
  // Newly authorized navigation groups start expanded; only explicit collapses are stored.
  const [closedSections, setClosedSections] = useState(() => new Set<string>());
  const [submenuOpen, setSubmenuOpen] = useState<Record<string, boolean>>({});
  const activeWorkspace = workspaces[0];
  const activeWorkspaceVisual = visualForIdentity(
    activeWorkspace?.id ?? "workspace",
    activeWorkspace?.imageUrl,
    { fit: "contain", surface: "brand" },
  );

  const filteredNavigation = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return visibleNavigation;
    return visibleNavigation
      .map((section) => ({
        ...section,
        items: section.items.flatMap((item) => {
          const itemMatches = [item.label, item.description].some((text) => text?.toLocaleLowerCase().includes(normalizedQuery));
          const matchingChildren = item.children?.filter((child) => child.label.toLocaleLowerCase().includes(normalizedQuery));
          if (!itemMatches && !matchingChildren?.length) return [];
          return [{ ...item, ...(itemMatches ? {} : { children: matchingChildren }) }];
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [visibleNavigation, query]);

  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        focusSearch();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [focusSearch]);

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
    setSubmenuOpen((current) => ({ ...current, [itemId]: !submenuIsOpen(itemId, active) }));
  };

  return (
    <div className={styles.sidebarFrame} data-mode={mode}>
      <aside aria-label="Workspace navigation" className={styles.sidebarCard}>
        <div className={styles.workspaceHeader}>
          <DialogTrigger>
            <AriaButton
              aria-label={`Switch workspace. Current: ${activeWorkspace?.name ?? "Workspace"}`}
              className={styles.workspaceButton}
            >
              <span
                aria-hidden="true"
                className={styles.workspaceMark}
                data-has-image={activeWorkspace?.imageUrl ? true : undefined}
                data-workspace-mark
                style={activeWorkspaceVisual}
              >
                {activeWorkspace?.imageUrl ? null : identityInitials(activeWorkspace?.name ?? "Workspace")}
              </span>
              <span className={styles.workspaceIdentity}>
                <strong>{activeWorkspace?.name ?? "Workspace"}</strong>
                <small>{activeWorkspace?.description ?? "Business workspace"}</small>
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
              <Dialog aria-label="Choose workspace" className={styles.workspaceDialog}>
                {({ close }) => (
                  <>
                    <p className={styles.popoverLabel}>Workspaces</p>
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
                            if (!response.ok) throw new Error("Workspace could not be switched. Your current workspace is unchanged.");
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
                        <span><strong>{organization.workspaceName}</strong><small>{organization.accountName ? `${organization.accountName} · ` : ""}{organization.workspaceStatus === "suspended" ? "Suspended" : "Unavailable"}</small></span>
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
                      <strong>Add or manage workspaces</strong>
                      <small>For a separate company with its own team, data and branding.</small>
                    </Link>
                  </>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
          {mode === "mobile" ? (
            <AriaButton
              aria-label="Close navigation"
              className={styles.mobileClose}
              onPress={onDismiss}
            >
              <X size={18} />
            </AriaButton>
          ) : null}
        </div>

        <div className={styles.searchArea}>
          <WorkspaceUniversalSearch
            inputRef={searchRef}
            onNavigate={onNavigate}
            onQueryChange={setQuery}
            query={query}
            workspaceId={activeWorkspace?.id ?? ""}
          />
        </div>

        <nav aria-label="Main navigation" className={styles.navigation}>
          {filteredNavigation.map((section) => {
            const sectionContentId = `${instanceId}-${section.id}`;
            const isOpen =
              !section.label || Boolean(query) || !closedSections.has(section.id);
            return (
              <section className={styles.navigationSection} data-heading={Boolean(section.label) || undefined} key={section.id}>
                {section.label ? (
                  <AriaButton
                    aria-controls={sectionContentId}
                    aria-expanded={isOpen}
                    className={styles.sectionToggle}
                    onPress={() => toggleSection(section.id)}
                  >
                    <span>{section.label}</span>
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
                      const active = pathname === item.href.split("?")[0]
                        || (item.id === "settings" && pathname.startsWith("/workspace/settings/"));
                      const showSubmenu = Boolean(item.children?.length) && (Boolean(query) || submenuIsOpen(item.id, active));
                      return (
                        <div className={styles.navigationItemGroup} key={item.id}>
                          <div className={styles.navigationItemRow} data-active={active || undefined}>
                            <Link
                              aria-current={active ? "page" : undefined}
                              className={styles.navigationItem}
                              data-active={active || undefined}
                              href={item.href}
                              onClick={onNavigate}
                              tabIndex={isOpen ? undefined : -1}
                            >
                              <ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} />
                              <span>{item.label}</span>
                            </Link>
                            {item.children?.length ? <AriaButton aria-controls={`${instanceId}-${item.id}-submenu`} aria-expanded={showSubmenu} aria-label={`Toggle ${item.label} submenu`} className={styles.submenuToggle} isDisabled={!isOpen} onPress={() => toggleSubmenu(item.id, active)}><ChevronDown aria-hidden="true" data-open={showSubmenu || undefined} size={15} /></AriaButton> : null}
                          </div>
                          {item.children?.length ? <div aria-hidden={!showSubmenu} className={styles.submenu} data-open={showSubmenu || undefined} id={`${instanceId}-${item.id}-submenu`}>
                            <div className={styles.submenuInner}>{item.children.map((child) => {
                              const childActive = location === child.href;
                              return <Link aria-current={childActive ? "page" : undefined} className={styles.submenuItem} data-active={childActive || undefined} href={child.href} key={child.id} onClick={onNavigate} tabIndex={isOpen && showSubmenu ? undefined : -1}>{child.label}</Link>;
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
          {filteredNavigation.length === 0 ? (
            <p className={styles.noResults}>No navigation results</p>
          ) : null}
        </nav>

      </aside>

    </div>
  );
}
