"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import Link from "next/link";
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from "react-aria-components";
import { Button, IconButton } from "./actions";

export type TabItem = { id: string; label: ReactNode; panel: ReactNode; count?: number };
export type ModuleNavigationItem = { id: string; href: string; label: string; /** Items waiting there (e.g. new enquiries); omit when there are none. */ count?: number };

export function ModuleNavigation({ activeId, className, items }: { activeId: string; className?: string; items: ModuleNavigationItem[] }) {
  const t = useT();
  return <nav aria-label={t("Modules")} className={["wd-module-nav", className].filter(Boolean).join(" ")}>
    {items.map((item) => <Link aria-current={item.id === activeId ? "page" : undefined} className="wd-module-link" href={item.href} key={item.id}>{item.label}{typeof item.count === "number" ? <span className="wd-count-chip">{item.count}</span> : null}</Link>)}
  </nav>;
}

export function Tabs({ defaultSelectedKey, items, selectedKey, onSelectionChange, variant = "underline" }: { defaultSelectedKey?: string; items: TabItem[]; selectedKey?: string; onSelectionChange?: (key: string) => void; variant?: "underline" | "segmented" }) {
  const t = useT();
  return <AriaTabs className="wd-tabs" data-variant={variant} defaultSelectedKey={defaultSelectedKey} selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange?.(String(key))}><div aria-label={t("Scrollable sections")} className="wd-tab-scroll" role="region" tabIndex={0}><TabList aria-label={t("Sections")} className="wd-tab-list" items={items}>{(item) => <Tab className="wd-tab" id={item.id}>{item.label}{typeof item.count === "number" ? <span className="wd-count-chip">{item.count}</span> : null}</Tab>}</TabList></div>{items.map((item) => <TabPanel className="wd-tab-panel" id={item.id} key={item.id}>{item.panel}</TabPanel>)}</AriaTabs>;
}

export type PillTabItem = { id: string; label: ReactNode; done?: boolean };

/** Simple pill tabs that switch what's shown below; the selected one is filled. Arrow keys move between them. */
export function PillTabs({ ariaLabel, items, selectedKey, onSelectionChange }: { ariaLabel: string; items: PillTabItem[]; selectedKey: string; onSelectionChange: (key: string) => void }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const index = items.findIndex((item) => item.id === selectedKey);
    const step = (event.key === "ArrowRight") !== rtl ? 1 : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + step + items.length) % items.length;
    onSelectionChange(items[next].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div aria-label={ariaLabel} className="wd-pill-tabs" role="tablist" onKeyDown={move}>
    {items.map((item) => <button aria-selected={item.id === selectedKey} className="wd-pill-tab" data-done={item.done || undefined} key={item.id} role="tab" tabIndex={item.id === selectedKey ? 0 : -1} type="button" onClick={() => onSelectionChange(item.id)}>
      {item.done ? <Check aria-hidden="true" size={13} strokeWidth={2.5} /> : null}{item.label}
    </button>)}
  </div>;
}

export function Breadcrumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  const t = useT();
  return <nav aria-label={t("Breadcrumb")} className="wd-breadcrumbs"><ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}{index < items.length - 1 ? <ChevronRight aria-hidden="true" data-directional="true" size={14} /> : null}</li>)}</ol></nav>;
}

export function Pagination({ ariaLabel, page, pageCount, onPageChange }: { ariaLabel?: string; page: number; pageCount: number; onPageChange: (page: number) => void }) {
  const t = useT();
  return <nav aria-label={ariaLabel ?? t("Pagination")} className="wd-pagination"><IconButton aria-label={t("Previous page")} isDisabled={page <= 1} onPress={() => onPageChange(page - 1)}><ChevronLeft data-directional="true" size={16} /></IconButton><span>{t("Page {page} of {count}", { page, count: pageCount })}</span><IconButton aria-label={t("Next page")} isDisabled={page >= pageCount} onPress={() => onPageChange(page + 1)}><ChevronRight data-directional="true" size={16} /></IconButton></nav>;
}

export function AppShell({ children, navigation, title, topActions, topNavigation }: { children: ReactNode; navigation?: ReactNode; title: ReactNode; topActions?: ReactNode; /** Module links next to the title (a portal without a sidebar). */ topNavigation?: ReactNode }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);
  return <div className="wd-app-shell" data-collapsed={collapsed} data-mobile-open={mobileOpen || undefined} data-navigation={navigation ? "sidebar" : "none"}>
    {navigation ? <aside aria-label={t("Primary navigation")} className="wd-app-sidebar">
      <div className="wd-app-brand"><strong aria-hidden={collapsed}>Wodana</strong><IconButton aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")} className="wd-desktop-sidebar-toggle" onPress={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</IconButton><IconButton aria-label={t("Close navigation")} className="wd-mobile-sidebar-close" onPress={() => setMobileOpen(false)}><PanelLeftClose size={17} /></IconButton></div>
      {navigation}
    </aside> : null}
    {navigation ? <button aria-label={t("Close navigation")} className="wd-app-scrim" onClick={() => setMobileOpen(false)} type="button" /> : null}
    <div className="wd-app-main"><header className="wd-app-topbar" data-top-navigation={topNavigation ? "" : undefined}>{navigation ? <IconButton aria-expanded={mobileOpen} aria-label={t("Open navigation")} className="wd-mobile-menu" onPress={() => setMobileOpen(true)}><Menu size={17} /></IconButton> : null}<strong>{title}</strong>{topNavigation ? <div className="wd-app-topnav">{topNavigation}</div> : null}<div>{topActions}</div></header><div className="wd-app-content">{children}</div></div>
  </div>;
}

export function CommandPaletteTrigger({ onPress }: { onPress?: () => void }) {
  const t = useT(); return <Button onPress={onPress} variant="quiet"><Search size={15} />{t("Search or jump to…")}<kbd>⌘K</kbd></Button>; }
