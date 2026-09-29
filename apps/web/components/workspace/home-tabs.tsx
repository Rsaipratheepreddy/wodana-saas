"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./home-tabs.module.css";

type TopbarTab = { id: string; label: string; href: string };

/**
 * A destination's tabs in the top bar, one compact pill bar: Home's overview and queues, People's areas.
 * The current tab is the one whose address is the page's, or its parent (People › Attendance › Leave).
 */
export function HomeTabs({ tabs, pathname, label = "Home", nested = false, counts = {} }: {
  tabs: TopbarTab[]; pathname: string; label?: string; nested?: boolean;
  /** How many wait in a queue tab (Approvals), shown beside its name. */
  counts?: Record<string, number | null | undefined>;
}) {
  const t = useT();
  if (tabs.length < 2) return null;
  const path = (tab: TopbarTab) => tab.href.split("?")[0];
  const current = nested
    ? [...tabs].sort((a, b) => path(b).length - path(a).length).find((tab) => pathname === path(tab) || pathname.startsWith(`${path(tab)}/`))
    : tabs.find((tab) => path(tab) === pathname);
  return <nav aria-label={t(label as never)} className={styles.bar}>
    <div className={styles.tabs}>{tabs.map((tab) => <Link key={tab.id} href={tab.href} className={styles.tab} aria-current={tab === current ? "page" : undefined}>
      {t(tab.label as never)}
      {counts[tab.id] ? <span className="wd-count-chip" aria-label={t("{count} waiting", { count: counts[tab.id]! })}>{counts[tab.id]}</span> : null}
    </Link>)}</div>
  </nav>;
}
