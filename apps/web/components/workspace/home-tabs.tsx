"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./home-tabs.module.css";

/** Home's tabs: the overview and the person's own queues, one compact pill bar; a queue shows how many wait. */
export function HomeTabs({ tabs, pathname, counts = {} }: { tabs: { id: string; label: string; href: string }[]; pathname: string; counts?: Record<string, number | null | undefined> }) {
  const t = useT();
  if (tabs.length < 2) return null;
  return <nav aria-label={t("Home")} className={styles.bar}>
    <div className={styles.tabs}>{tabs.map((tab) => {
      const count = counts[tab.id];
      return <Link key={tab.id} href={tab.href} className={styles.tab} aria-current={tab.href.split("?")[0] === pathname ? "page" : undefined}>
        {t(tab.label as never)}
        {count ? <span className="wd-count-chip" aria-label={t("{count} waiting", { count })}>{count}</span> : null}
      </Link>;
    })}</div>
  </nav>;
}
