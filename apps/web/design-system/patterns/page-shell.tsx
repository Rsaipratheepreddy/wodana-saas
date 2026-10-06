"use client";

import { createContext, useContext, useRef, useState, type MutableRefObject, type ReactNode } from "react";

/**
 * The end of the tabs row, where the page's list puts its toolbar (search, Filter, ⋯) so the tabs and the tools
 * share one row instead of an almost empty toolbar row above the list. The first list on the page claims it.
 */
type ToolbarSlot = { element: HTMLElement | null; owner: MutableRefObject<string | null> };
const ToolbarSlotContext = createContext<ToolbarSlot | null>(null);
export function usePageToolbarSlot() { return useContext(ToolbarSlotContext); }

/** How a page spaces its sections: one gap scale per page type (§5c D6). */
export type PageKind = "list" | "record" | "form" | "dashboard";

/**
 * Every workspace page (§5c D1): a sticky header with one sentence-case title and at most one primary
 * action at the end, optional tabs under the title, an optional toolbar, then the content.
 * No eyebrow, no description paragraph, no decorative chrome.
 */
export function PageShell({ action, "aria-label": ariaLabel, children, kind = "list", tabs, title, toolbar }: {
  /** The one primary action (top-end). Secondary actions live in the toolbar's ⋯ menu. */
  action?: ReactNode;
  "aria-label"?: string;
  children: ReactNode;
  kind?: PageKind;
  /** Up to six tabs under the title (ListTabs or Tabs). */
  tabs?: ReactNode;
  title: ReactNode;
  toolbar?: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const owner = useRef<string | null>(null);
  return <section aria-label={ariaLabel} className="wd-page-shell" data-kind={kind}>
    <header className="wd-page-shell-header">
      <div className="wd-page-shell-bar">
        <h1 className="wd-page-shell-title">{title}</h1>
        {action ? <div className="wd-page-shell-action">{action}</div> : null}
      </div>
      {tabs ? <div className="wd-page-shell-tabs">
        <div className="wd-page-shell-tabs-start">{tabs}</div>
        <div className="wd-page-shell-tools" ref={setSlot}>{toolbar}</div>
      </div> : null}
    </header>
    {toolbar && !tabs ? <div className="wd-page-shell-toolbar">{toolbar}</div> : null}
    <ToolbarSlotContext.Provider value={tabs ? { element: slot, owner } : null}>
      <div className="wd-page-shell-body">{children}</div>
    </ToolbarSlotContext.Provider>
  </section>;
}

/** A card (§5c D5): one radius, padding and shadow; header (title · chip · action), body, footer. */
export function Card({ action, chip, children, footer, title, as: Tag = "section" }: {
  action?: ReactNode; chip?: ReactNode; children?: ReactNode; footer?: ReactNode; title?: ReactNode; as?: "section" | "article" | "div" | "li";
}) {
  return <Tag className="wd-card">
    {title || chip || action ? <header className="wd-card-header">
      {title ? <h2 className="wd-card-title">{title}</h2> : null}{chip ? <span className="wd-card-chip">{chip}</span> : null}
      {action ? <div className="wd-card-action">{action}</div> : null}
    </header> : null}
    {children ? <div className="wd-card-body">{children}</div> : null}
    {footer ? <footer className="wd-card-footer">{footer}</footer> : null}
  </Tag>;
}

/** Cards side by side at equal heights; wraps to one column on a phone. */
export function CardGrid({ children, min = "18rem" }: { children: ReactNode; /** Narrowest card before wrapping. */ min?: "14rem" | "18rem" | "24rem" }) {
  return <div className="wd-card-grid" data-min={min}>{children}</div>;
}
