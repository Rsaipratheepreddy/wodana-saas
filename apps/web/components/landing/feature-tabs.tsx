"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Check, ClipboardCheck, Factory, FileText, Handshake, LayoutDashboard, SquareKanban, type LucideIcon } from "lucide-react";
import styles from "./feature-tabs.module.css";

/** The tour's tabs in order; each id is also its anchor (/#sales). */
export const FEATURE_TAB_IDS = ["sales", "quotes", "projects", "purchasing", "site", "portal"] as const;
export type FeatureTabIcon = (typeof FEATURE_TAB_IDS)[number];
const ICONS: Record<FeatureTabIcon, LucideIcon> = {
  sales: Handshake, quotes: FileText, projects: SquareKanban, purchasing: Factory, site: ClipboardCheck, portal: LayoutDashboard,
};

export type FeatureTab = {
  /** Also the tab's anchor: /#sales opens and scrolls to it. */
  id: FeatureTabIcon;
  label: string;
  title: string;
  points: string[];
  /** The screenshot(s), rendered on the server. */
  visual: ReactNode;
};

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * The product tour: a row of tabs, each swapping in its own screenshot and three points. While the section is on
 * screen it moves to the next tab every few seconds (a bar fills under the current tab); hovering or focusing it
 * pauses, and choosing a tab stops it. Reduced motion never advances. Keyboard: the arrows, Home and End move between
 * tabs (reversed in right-to-left), and /#<tab> links open the tab they name.
 */
export function FeatureTabs({ tabs, label, interval = 7000 }: { tabs: FeatureTab[]; label: string; interval?: number }) {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = useCallback((index: number, focus = false) => {
    setActive(index);
    setStopped(true);
    if (focus) buttons.current[index]?.focus();
  }, []);

  useEffect(() => {
    const media = window.matchMedia(REDUCED);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Advance only while at least a third of the tour is on screen.
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // /#sales, /#quotes… open their tab (on load and when a menu link changes the hash).
  useEffect(() => {
    const open = () => {
      const index = tabs.findIndex((tab) => `#${tab.id}` === window.location.hash);
      if (index >= 0) { setActive(index); setStopped(true); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [tabs]);

  // Keep the current tab in view when the row scrolls sideways (phones), without moving the page.
  useEffect(() => {
    const button = buttons.current[active];
    const list = button?.parentElement;
    if (!button || !list || list.scrollWidth <= list.clientWidth) return;
    const box = button.getBoundingClientRect();
    const frame = list.getBoundingClientRect();
    list.scrollBy?.({ left: box.left + box.width / 2 - (frame.left + frame.width / 2) });
  }, [active]);

  const playing = !stopped && !reduced && visible && !hovered && !focused;
  const auto = !stopped && !reduced;
  const next = useCallback(() => setActive((current) => (current + 1) % tabs.length), [tabs.length]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    const index = event.key === forward ? (active + 1) % tabs.length
      : event.key === back ? (active - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (index < 0) return;
    event.preventDefault();
    choose(index, true);
  };

  return <div className={styles.tour} data-playing={playing || undefined} ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onFocus={() => setFocused(true)} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    style={{ "--tour-interval": `${interval}ms` } as CSSProperties}>
    <div aria-label={label} className={styles.tabs} onKeyDown={onKey} role="tablist">
      {tabs.map((tab, index) => {
        const Icon = ICONS[tab.id];
        const selected = index === active;
        return <button aria-controls={`${tab.id}-panel`} aria-selected={selected} className={styles.tab} id={tab.id} key={tab.id}
          onClick={() => choose(index)} ref={(node) => { buttons.current[index] = node; }} role="tab" tabIndex={selected ? 0 : -1} type="button">
          <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
          <span>{tab.label}</span>
          {selected && auto ? <span aria-hidden="true" className={styles.progress} key={`${tab.id}-${active}`} onAnimationEnd={next} /> : null}
        </button>;
      })}
    </div>
    <div className={styles.panels}>
      {tabs.map((tab, index) => {
        const selected = index === active;
        return <div aria-hidden={!selected || undefined} aria-labelledby={tab.id} className={styles.panel} data-active={selected || undefined}
          id={`${tab.id}-panel`} inert={!selected} key={tab.id} role="tabpanel" tabIndex={selected ? 0 : -1}>
          <div className={styles.copy}>
            <h3 className={styles.title}>{tab.title}</h3>
            <ul className={styles.points}>
              {tab.points.map((point) => <li key={point}><Check aria-hidden="true" size={18} strokeWidth={2.25} /><span>{point}</span></li>)}
            </ul>
          </div>
          <div className={styles.visual}>{tab.visual}</div>
        </div>;
      })}
    </div>
  </div>;
}
