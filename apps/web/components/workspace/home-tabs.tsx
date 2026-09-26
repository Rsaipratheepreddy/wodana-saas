"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./home-tabs.module.css";

/** Home's tabs: the overview and the person's own queues, one compact pill bar. */
export function HomeTabs({ tabs, pathname }: { tabs: { id: string; label: string; href: string }[]; pathname: string }) {
  const t = useT();
  if (tabs.length < 2) return null;
  return <nav aria-label={t("Home")} className={styles.bar}>
    <div className={styles.tabs}>{tabs.map((tab) => <Link key={tab.id} href={tab.href} className={styles.tab} aria-current={tab.href.split("?")[0] === pathname ? "page" : undefined}>{t(tab.label as never)}</Link>)}</div>
  </nav>;
}
