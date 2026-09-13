"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from "react-aria-components";
import { Button, IconButton } from "./actions";

export type TabItem = { id: string; label: ReactNode; panel: ReactNode };
export function Tabs({ defaultSelectedKey, items, selectedKey, onSelectionChange, variant = "underline" }: { defaultSelectedKey?: string; items: TabItem[]; selectedKey?: string; onSelectionChange?: (key: string) => void; variant?: "underline" | "segmented" }) {
  return <AriaTabs className="wd-tabs" data-variant={variant} defaultSelectedKey={defaultSelectedKey} selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange?.(String(key))}><div aria-label="Scrollable sections" className="wd-tab-scroll" role="region" tabIndex={0}><TabList aria-label="Sections" className="wd-tab-list" items={items}>{(item) => <Tab className="wd-tab" id={item.id}>{item.label}</Tab>}</TabList></div>{items.map((item) => <TabPanel className="wd-tab-panel" id={item.id} key={item.id}>{item.panel}</TabPanel>)}</AriaTabs>;
}

export function Breadcrumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return <nav aria-label="Breadcrumb" className="wd-breadcrumbs"><ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}{index < items.length - 1 ? <ChevronRight aria-hidden="true" data-directional="true" size={14} /> : null}</li>)}</ol></nav>;
}

export function Pagination({ ariaLabel = "Pagination", page, pageCount, onPageChange }: { ariaLabel?: string; page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return <nav aria-label={ariaLabel} className="wd-pagination"><IconButton aria-label="Previous page" isDisabled={page <= 1} onPress={() => onPageChange(page - 1)}><ChevronLeft data-directional="true" size={16} /></IconButton><span>Page <strong>{page}</strong> of {pageCount}</span><IconButton aria-label="Next page" isDisabled={page >= pageCount} onPress={() => onPageChange(page + 1)}><ChevronRight data-directional="true" size={16} /></IconButton></nav>;
}

export function AppShell({ children, navigation, title, topActions }: { children: ReactNode; navigation: ReactNode; title: ReactNode; topActions?: ReactNode }) {
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
  return <div className="wd-app-shell" data-collapsed={collapsed} data-mobile-open={mobileOpen || undefined}>
    <aside aria-label="Primary navigation" className="wd-app-sidebar">
      <div className="wd-app-brand"><strong aria-hidden={collapsed}>Wodana</strong><IconButton aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="wd-desktop-sidebar-toggle" onPress={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</IconButton><IconButton aria-label="Close navigation" className="wd-mobile-sidebar-close" onPress={() => setMobileOpen(false)}><PanelLeftClose size={17} /></IconButton></div>
      {navigation}
    </aside>
    <button aria-label="Close navigation" className="wd-app-scrim" onClick={() => setMobileOpen(false)} type="button" />
    <div className="wd-app-main"><header className="wd-app-topbar"><IconButton aria-expanded={mobileOpen} aria-label="Open navigation" className="wd-mobile-menu" onPress={() => setMobileOpen(true)}><Menu size={17} /></IconButton><strong>{title}</strong><div>{topActions}</div></header><div className="wd-app-content">{children}</div></div>
  </div>;
}

export function CommandPaletteTrigger({ onPress }: { onPress?: () => void }) { return <Button onPress={onPress} variant="quiet"><Search size={15} />Search or jump to…<kbd>⌘K</kbd></Button>; }
