"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The end of the tabs row, where the page's list puts its toolbar (search, Filter, ⋯) so the tabs and the tools
 * share one row instead of an almost empty toolbar row above the list. The first list on the page claims it.
 */
type ToolbarSlot = {
  element: HTMLElement | null; owner: MutableRefObject<string | null>;
  /** Claims the slot for a component (true when it holds it); release gives it back. */
  claim: (id: string) => boolean; release: (id: string) => void;
};
const ToolbarSlotContext = createContext<ToolbarSlot | null>(null);
export function usePageToolbarSlot() { return useContext(ToolbarSlotContext); }

/** The tabs row's tool slot for this component, when it is the first on the page to claim it (else null: render in place). */
export function usePageToolbarElement() {
  const slot = useContext(ToolbarSlotContext);
  const id = useId();
  const mine = slot ? slot.claim(id) : false;
  useEffect(() => () => slot?.release(id), [slot, id]);
  return mine ? slot!.element : null;
}

/**
 * One title per view (plan §2): the names the workspace chrome already shows for the open page — its breadcrumb,
 * the active module tab, the active Home, People or Settings entry. A page whose title repeats one of them keeps
 * its `<h1>` for screen readers only, and its tabs, tools and primary action share one row.
 * Nested providers add their names to the outer ones (the shell's breadcrumb, then the module's tabs).
 */
const PageChromeContext = createContext<readonly string[] | null>(null);
const nameKey = (value: string) => value.trim().toLocaleLowerCase();

export function PageChrome({ names, children }: { names: ReadonlyArray<string | null | undefined | false>; children: ReactNode }) {
  const parent = useContext(PageChromeContext);
  const key = names.filter((name): name is string => typeof name === "string" && name.trim() !== "").map(nameKey).join("\n");
  const value = useMemo(() => [...(parent ?? []), ...(key ? key.split("\n") : [])], [parent, key]);
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

/** Whether the chrome around the page already shows `title` (so the page doesn't repeat it). */
export function useNamedByChrome(title: ReactNode) {
  const names = useContext(PageChromeContext);
  return Boolean(names && typeof title === "string" && names.includes(nameKey(title)));
}

/**
 * A section's own tools (search, its one action) moved up into the page's row when the page offers it, so a section
 * under the page's tabs adds no row of its own; rendered in place otherwise.
 */
export function PageTools({ children }: { children: ReactNode }) {
  const slot = usePageToolbarElement();
  return slot ? createPortal(children, slot) : <>{children}</>;
}

/** How a page spaces its sections: one gap scale per page type (§5c D6). */
export type PageKind = "list" | "record" | "form" | "dashboard";

/**
 * Every workspace page (§5c D1): one sentence-case title, at most one primary action, optional tabs, an optional
 * toolbar, then the content. No eyebrow, no description paragraph, no decorative chrome.
 *
 * When the chrome already names the page (see `PageChrome`), the title is for screen readers only and the page starts
 * with ONE row: the tabs at the start, then the toolbar and the primary action at the end. Otherwise (a record named by
 * its own title, or a page outside the workspace chrome) a compact title row with the action comes first.
 */
export function PageShell({ action, "aria-label": ariaLabel, children, kind = "list", tabs, title, toolbar }: {
  /** The one primary action: the end of the page's first row. Secondary actions live in the toolbar's ⋯ menu. */
  action?: ReactNode;
  "aria-label"?: string;
  children: ReactNode;
  kind?: PageKind;
  /** Up to six tabs (ListTabs or Tabs); the toolbar sits at the end of their row. */
  tabs?: ReactNode;
  title: ReactNode;
  toolbar?: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const owner = useRef<string | null>(null);
  const claim = useCallback((id: string) => { if (owner.current === null || owner.current === id) owner.current = id; return owner.current === id; }, []);
  const release = useCallback((id: string) => { if (owner.current === id) owner.current = null; }, []);
  const named = useNamedByChrome(title);
  // The row exists for tabs; on a named page also for the toolbar and the action, and on a named list for its first
  // grid's search, Filter and ⋯ (an empty row takes no space).
  const row = Boolean(tabs) || (named && Boolean(toolbar || action || kind === "list"));
  return <section aria-label={ariaLabel} className="wd-page-shell" data-kind={kind} data-named={named || undefined}>
    <header className="wd-page-shell-header">
      {named ? <h1 className="wd-visually-hidden">{title}</h1> : <div className="wd-page-shell-bar">
        <h1 className="wd-page-shell-title">{title}</h1>
        {action ? <div className="wd-page-shell-action">{action}</div> : null}
      </div>}
      {row ? <div className="wd-page-shell-tabs" data-tabs={tabs ? "" : undefined}>
        {tabs ? <div className="wd-page-shell-tabs-start">{tabs}</div> : null}
        <div className="wd-page-shell-tools" ref={setSlot}>{toolbar}</div>
        {named && action ? <div className="wd-page-shell-action">{action}</div> : null}
      </div> : null}
    </header>
    {toolbar && !row ? <div className="wd-page-shell-toolbar">{toolbar}</div> : null}
    <ToolbarSlotContext.Provider value={tabs || (row && kind === "list") ? { element: slot, owner, claim, release } : null}>
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
