"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./home-tabs.module.css";

type TopbarTab = { id: string; label: string; href: string };

/**
 * A destination's tabs in the top bar, one compact pill bar: Home's overview and queues, People's areas.
 * The current tab is the one whose address is the page's, or its parent (People › Attendance › Leave).
 */
export function HomeTabs({ tabs, pathname, label = "Home", nested = false }: { tabs: TopbarTab[]; pathname: string; label?: string; nested?: boolean }) {
  const t = useT();
  if (tabs.length < 2) return null;
  const path = (tab: TopbarTab) => tab.href.split("?")[0];
  const current = nested
    ? [...tabs].sort((a, b) => path(b).length - path(a).length).find((tab) => pathname === path(tab) || pathname.startsWith(`${path(tab)}/`))
    : tabs.find((tab) => path(tab) === pathname);
  return <nav aria-label={t(label as never)} className={styles.bar}>
    <div className={styles.tabs}>{tabs.map((tab) => <Link key={tab.id} href={tab.href} className={styles.tab} aria-current={tab === current ? "page" : undefined}>{t(tab.label as never)}</Link>)}</div>
  </nav>;
}
