"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  CircleUserRound,
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
  LogOut,
  MapPinned,
  MessagesSquare,
  MoreHorizontal,
  PackageSearch,
  PackageCheck,
  Palette,
  Plug,
  Ruler,
  Search,
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
  WorkspaceUser,
} from "./workspace-navigation";
import styles from "./workspace.module.css";
import { identityInitials, identityStyle as visualForIdentity } from "@/lib/brand/identity";

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
  return <DialogTrigger><AriaButton aria-label={`Switch module. Current: ${activeModule.label}`} className={styles.moduleButton}><LayoutGrid aria-hidden="true" size={18} /></AriaButton>
    <Popover className={styles.modulePopover} offset={8} placement="bottom start"><Dialog aria-label="Choose module" className={styles.moduleDialog}>{({ close }) => <><p className={styles.popoverLabel}>Products</p>{modules.map((module) => {
      const ModuleIcon = icons[module.icon];
      return <Link aria-current={module.id === activeModule.id ? "page" : undefined} className={styles.moduleOption} data-selected={module.id === activeModule.id || undefined} href={module.href} key={module.id} onClick={close}><span aria-hidden="true" className={styles.moduleOptionIcon} data-module={module.id}><ModuleIcon size={17} strokeWidth={1.8} /></span><span><strong>{module.label}</strong><small>{module.description}</small></span></Link>;
    })}</>}</Dialog></Popover>
  </DialogTrigger>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export type WorkspaceSidebarProps = {
  activeModule: WorkspaceModuleDefinition;
  mode?: "desktop" | "mobile";
  modules: WorkspaceModuleDefinition[];
  navigation: WorkspaceNavigationSection[];
  onDismiss?: () => void;
  onNavigate?: () => void;
  pathname: string;
  user: WorkspaceUser;
  workspaces: WorkspaceIdentity[];
};

export function WorkspaceSidebar({
  activeModule,
  mode = "desktop",
  modules,
  navigation,
  onDismiss,
  onNavigate,
  pathname,
  user,
  workspaces,
}: WorkspaceSidebarProps) {
  const router = useRouter();
  const instanceId = useId().replaceAll(":", "");
  const searchRef = useRef<HTMLInputElement>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [query, setQuery] = useState("");
  const visibleNavigation = useMemo(() => navigation
    .map((section) => ({ ...section, items: section.items.filter((item) => item.showInSidebar !== false) }))
    .filter((section) => section.items.length > 0), [navigation]);
  // Newly authorized navigation groups start expanded; only explicit collapses are stored.
  const [closedSections, setClosedSections] = useState(() => new Set<string>());
  const activeWorkspace = workspaces[0];
  const activeWorkspaceVisual = visualForIdentity(
    activeWorkspace?.id ?? "workspace",
    activeWorkspace?.imageUrl,
  );
  const userVisual = visualForIdentity(user.name, user.avatarUrl);

  const filteredNavigation = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return visibleNavigation;
    return visibleNavigation
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          [item.label, item.description].some((text) => text?.toLocaleLowerCase().includes(normalizedQuery)),
        ),
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

  const [signOutError, setSignOutError] = useState("");
  const signOut = async () => {
    setSignOutError("");
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setSignOutError("Unable to log out this device. Please try again.");
      return;
    }
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className={styles.sidebarFrame} data-mode={mode}>
      {signOutError ? <p role="alert">{signOutError}</p> : null}
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
                      <button
                        className={styles.workspaceOption}
                        data-selected={workspace.id === activeWorkspace?.id || undefined}
                        key={workspace.id}
                        disabled={switchingWorkspace}
                        onClick={async () => {
                          if (workspace.id === activeWorkspace?.id) { close(); return; }
                          setSwitchingWorkspace(true); setWorkspaceError("");
                          try {
                            const response = await fetch("/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id }) });
                            if (!response.ok) throw new Error("Workspace could not be switched. Your current workspace is unchanged.");
                            window.location.assign(activeModule.href);
                          } catch (error) { setWorkspaceError((error as Error).message); setSwitchingWorkspace(false); }
                        }}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={styles.optionMark}
                          data-has-image={workspace.imageUrl ? true : undefined}
                          style={visualForIdentity(workspace.id, workspace.imageUrl)}
                        >
                          {workspace.imageUrl ? null : identityInitials(workspace.name)}
                        </span>
                        <span>
                          <strong>{workspace.name}</strong>
                          <small>{workspace.description}</small>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
          <DialogTrigger>
            <AriaButton
              aria-label={`Switch module. Current: ${activeModule.label}`}
              className={styles.moduleButton}
            >
              <LayoutGrid aria-hidden="true" size={18} strokeWidth={1.8} />
            </AriaButton>
            <Popover
              className={styles.modulePopover}
              offset={8}
              placement={mode === "desktop" ? "right top" : "bottom end"}
            >
              <Dialog aria-label="Choose module" className={styles.moduleDialog}>
                {({ close }) => (
                  <>
                    <p className={styles.popoverLabel}>Products</p>
                    {modules.map((module) => {
                      const ModuleIcon = icons[module.icon];
                      return (
                        <Link
                          aria-current={module.id === activeModule.id ? "page" : undefined}
                          className={styles.moduleOption}
                          data-selected={module.id === activeModule.id || undefined}
                          href={module.href}
                          key={module.id}
                          onClick={() => {
                            onNavigate?.();
                            close();
                          }}
                        >
                          <span aria-hidden="true" className={styles.moduleOptionIcon} data-module={module.id}>
                            <ModuleIcon size={17} strokeWidth={1.8} />
                          </span>
                          <span>
                            <strong>{module.label}</strong>
                            <small>{module.description}</small>
                          </span>
                        </Link>
                      );
                    })}
                  </>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
          {mode === "mobile" ? (
            <button
              aria-label="Close navigation"
              className={styles.mobileClose}
              onClick={onDismiss}
              type="button"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <div className={styles.searchArea}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search navigation"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search…"
              ref={searchRef}
              type="search"
              value={query}
            />
            <kbd aria-hidden="true">⌘ K</kbd>
          </label>
        </div>

        <nav aria-label="Main navigation" className={styles.navigation}>
          {filteredNavigation.map((section) => {
            const sectionContentId = `${instanceId}-${section.id}`;
            const isOpen =
              !section.label || Boolean(query) || !closedSections.has(section.id);
            return (
              <section className={styles.navigationSection} data-heading={Boolean(section.label) || undefined} key={section.id}>
                {section.label ? (
                  <button
                    aria-controls={sectionContentId}
                    aria-expanded={isOpen}
                    className={styles.sectionToggle}
                    onClick={() => toggleSection(section.id)}
                    type="button"
                  >
                    <span>{section.label}</span>
                    <ChevronDown aria-hidden="true" data-open={isOpen || undefined} size={15} />
                  </button>
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
                      return (
                        <Link
                          aria-current={active ? "page" : undefined}
                          className={styles.navigationItem}
                          data-active={active || undefined}
                          href={item.href}
                          key={item.id}
                          onClick={onNavigate}
                          tabIndex={isOpen ? undefined : -1}
                        >
                          <ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} />
                          <span>{item.label}</span>
                        </Link>
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

        <div className={styles.sidebarFooter}>
          <DialogTrigger>
            <AriaButton
              className={styles.userButton}
            >
              <span
                aria-hidden="true"
                className={styles.avatar}
                data-has-image={user.avatarUrl ? true : undefined}
                style={userVisual}
              >
                {user.avatarUrl ? null : initials(user.name)}
              </span>
              <span className={styles.userIdentity}>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <MoreHorizontal aria-hidden="true" className={styles.userMore} size={17} />
            </AriaButton>
            <Popover
              className={styles.userPopover}
              placement="top start"
            >
              <Dialog aria-label="Account menu" className={styles.accountDialog}>
                {({ close }) => (
                  <>
                    <div className={styles.accountSummary}>
                      <span
                        aria-hidden="true"
                        className={styles.avatar}
                        data-has-image={user.avatarUrl ? true : undefined}
                        style={userVisual}
                      >
                        {user.avatarUrl ? null : initials(user.name)}
                      </span>
                      <span>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </span>
                    </div>
                    <Link href="/workspace/settings" onClick={close}>
                      <CircleUserRound size={16} /> User Settings
                    </Link>
                    {user.platformRole === "administrator" ? <Link href="/internal" onClick={close}>
                      <Building2 size={16} /> Internal portal
                    </Link> : null}
                    <button
                      className={styles.accountAction}
                      onClick={async () => {
                        close();
                        await signOut();
                      }}
                      type="button"
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
        </div>
      </aside>

    </div>
  );
}
