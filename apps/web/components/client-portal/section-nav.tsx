"use client";

import { FileText, Images, LayoutGrid, ListChecks, MessageCircle, NotebookPen, ShieldCheck, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalSection } from "@/lib/client-portal/types";
import styles from "./portal.module.css";

export type PortalPage = "overview" | PortalSection;
export type NavItem = { id: PortalPage; label: string; badge?: { text: string; tone: "warning" | "danger" | "info" } };

const ICONS: Record<PortalPage, LucideIcon> = {
  overview: LayoutGrid, progress: TrendingUp, decisions: ListChecks, moodboard: Images, payments: Wallet, documents: FileText, warranty: ShieldCheck, meetings: NotebookPen,
  messages: MessageCircle,
};

/**
 * The project's sections: a list down the side on a wide screen, one row that scrolls sideways on a narrow one.
 * The open one is marked as the current page; a badge says what waits there ("2 to decide"). Arrow keys move along it.
 */
export function SectionNav({ items, current, onSelect, layout }: { items: NavItem[]; current: PortalPage; onSelect: (id: PortalPage) => void; layout: "list" | "scroll" | "tabs" }) {
  const t = useT();
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const forward = layout === "list" ? "ArrowDown" : "ArrowRight", back = layout === "list" ? "ArrowUp" : "ArrowLeft";
    if (![forward, back, "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    // Sideways, the arrow keys follow the reading direction.
    const rtl = layout !== "list" && getComputedStyle(event.currentTarget).direction === "rtl";
    const step = (event.key === forward) !== rtl ? 1 : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return <nav aria-label={t("Sections")} className={styles.sectionNav} data-layout={layout} onKeyDown={move}>
    <ul>{items.map((item) => {
      const Icon = ICONS[item.id];
      return <li key={item.id}>
        <button aria-current={item.id === current ? "page" : undefined} className={styles.navItem} data-tour={`portal-tab-${item.id}`} data-tour-safe="" type="button"
          onClick={(event) => { onSelect(item.id); event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}>
          <Icon aria-hidden="true" size={18} />
          <span className={styles.navLabel}>{item.label}</span>
          {item.badge ? <span className={styles.navBadge} data-tone={item.badge.tone}>{item.badge.text}</span> : null}
        </button>
      </li>;
    })}</ul>
  </nav>;
}
