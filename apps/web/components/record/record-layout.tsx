"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Card, Tabs, type TabItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./record.module.css";

/**
 * A record (§5c D.7), the same anatomy for an enquiry, an opportunity, a client, a planning case and a project:
 * the header (one title, its muted line, its actions), a status strip, then the next step and the activity
 * in the main column beside the sidebar's tabs (Overview · Details · Files). On a narrow frame the columns
 * stack: the next step, the sidebar, then the activity.
 */
export function RecordFrame({ children, className, tour }: { children: ReactNode; className?: string; tour?: string }) {
  return <div className={styles.record} data-tour={tour}><div className={[styles.frame, className].filter(Boolean).join(" ")}>{children}</div></div>;
}

/** The record's one title (an h2 inside its sheet or modal), one muted line under it, and its actions at the end. */
export function RecordHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return <header className={styles.header}>
    <div className={styles.identity}>{title}{meta ? <p className={styles.meta}>{meta}</p> : null}</div>
    {actions ? <div className={styles.headerActions}>{actions}</div> : null}
  </header>;
}

/** Where the record stands, in one row under the header: each item a label and its value (`<div><dt/><dd/></div>`). */
export function RecordStrip({ label, children, tour }: { label: string; children: ReactNode; tour?: string }) {
  return <dl className={styles.strip} aria-label={label} data-layout="stacked" data-tour={tour}>{children}</dl>;
}

/** One item of the status strip. */
export function StripItem({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return <div><dt>{icon}{label}</dt><dd>{children}</dd></div>;
}

/** The main column (the next step, then the activity) beside the sidebar's tabs; each column scrolls on its own in a fixed frame. */
export function RecordColumns({ next, activity, sideLabel, tabs, tab, onTabChange }: {
  next?: ReactNode; activity?: ReactNode; sideLabel: string; tabs: TabItem[];
  /** Controlled: the record opens a tab itself (Add on a checklist row opens Details). */
  tab?: string; onTabChange?: (key: string) => void;
}) {
  const [own, setOwn] = useState(tabs[0]?.id ?? "");
  const selected = tab ?? own;
  const sideRef = useRef<HTMLElement>(null);
  // Another tab starts at its top.
  useEffect(() => { sideRef.current?.scrollTo?.({ top: 0 }); }, [selected]);
  return <div className={styles.layout}>
    <div className={styles.main}>
      {next ? <div className={styles.next}>{next}</div> : null}
      {activity ? <div className={styles.activity}>{activity}</div> : null}
    </div>
    <aside ref={sideRef} className={styles.side} aria-label={sideLabel}>
      <Tabs selectedKey={selected} onSelectionChange={(key) => { setOwn(key); onTabChange?.(key); }} items={tabs} />
    </aside>
  </div>;
}

/** A sidebar tab's content: its sections one under the other. */
export function RecordPanel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}

/** A section of the record, in the sidebar or the main column: a titled card (a chip and one action in its header), then its content. */
export function SideSection({ title, action, chip, id, children }: { title: string; action?: ReactNode; chip?: ReactNode; id?: string; children: ReactNode }) {
  return <Card level={3} id={id} title={title} chip={chip} action={action}>{children}</Card>;
}

/**
 * The next step: what to do now, one line on why, who does it or the one action, then what belongs to it
 * (the pending follow-up, a checklist, the linked records).
 */
export function NextStepCard({ title, why, meta, status, tour, children, label, id }: { title: string; why?: ReactNode; meta?: ReactNode; status?: string; tour?: string; children?: ReactNode;
  /** The card's own heading ("Next step" by default); none once the record is done. */
  label?: string | null;
  /** An anchor a KPI tile opens. */
  id?: string }) {
  const t = useT();
  const titleId = useId();
  const heading = label === undefined ? (status === "done" ? null : t("Next step")) : label;
  return <section className={styles.now} id={id} aria-labelledby={titleId} data-status={status} data-tour={tour}>
    <div className={styles.nowHead}>
      <div className={styles.nowMain}>
        {heading ? <span className={styles.nowLabel}>{heading}</span> : null}
        <h3 id={titleId}>{title}</h3>
        {why ? <p className={styles.why}>{why}</p> : null}
      </div>
      {meta ? <div className={styles.nowMeta}>{meta}</div> : null}
    </div>
    {children}
  </section>;
}

/**
 * The record's long sections (stages, site updates, requirements, approvals, history) as sub-tabs under the next
 * step, so the overview stays about one screen; the small facts stay beside them as titled cards.
 */
export function SectionTabs({ tabs, tab, onTabChange, tabsRef }: {
  tabs: TabItem[]; tab: string; onTabChange: (key: string) => void;
  /** Where a KPI tile brings the reader when it opens a tab. */
  tabsRef?: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const selected = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id ?? "";
  if (!tabs.length) return null;
  return <div ref={tabsRef} className={styles.sectionTabs}><Tabs ariaLabel={t("Lists")} items={tabs} selectedKey={selected} onSelectionChange={onTabChange} /></div>;
}

/** The sub-tab shown, and a way for a KPI tile to open one and bring it into view. */
export function useSectionTabs(initial: string) {
  const [tab, setTab] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const open = useCallback((id: string) => {
    setTab(id);
    requestAnimationFrame(() => ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  }, []);
  return { tab, setTab, open, ref };
}
