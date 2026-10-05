"use client";

import type { ReactNode } from "react";
import { ListTabs, MAX_TABS, Tabs } from "@/design-system";
import type { useT } from "@/lib/i18n/i18n-provider";
import styles from "./operations.module.css";

export type ModuleTab<T extends string> = { id: T; label: string; count?: number; panel: ReactNode };

/**
 * A module's sections as tabs under its title (PageShell `tabs`), and the open section as the page content.
 * Over six, the sections named in `more` move under a final "More" tab with their own switch, so a person
 * never sees more than six tabs (§5c D3); each section keeps its own address. One section is just its content.
 * A plain function (no hooks), so a page may call it after an early return.
 */
export function moduleTabs<T extends string>({ t, items, value, onChange, more = [], tour }: {
  t: ReturnType<typeof useT>;
  items: Array<ModuleTab<T>>; value: T; onChange: (id: T) => void; /** Sections grouped under "More" when there are more than six. */ more?: readonly T[];
  /** Names each tab `data-tour="<tour>-<id>"` for Woddy's tours. */ tour?: string;
}): { tabs: ReactNode; content: ReactNode } {
  const grouped = items.length > MAX_TABS ? items.filter((item) => more.includes(item.id)) : [];
  const main = items.filter((item) => !grouped.includes(item));
  const inMore = grouped.some((item) => item.id === value);
  const panel = items.find((item) => item.id === value)?.panel ?? null;
  if (items.length <= 1) return { tabs: null, content: panel };
  // The sections are routes and their content is the page body, so the tab list carries no panel of its own.
  const tabs = <div className={styles.moduleTabs}><Tabs tour={tour} selectedKey={inMore ? "more" : value} onSelectionChange={(key) => onChange(key === "more" ? grouped[0].id : key as T)}
    items={[...main.map(({ id, label, count }) => ({ id, label, count: count || undefined, panel: null })),
      ...(grouped.length ? [{ id: "more", label: t("More"), count: grouped.reduce((sum, item) => sum + (item.count ?? 0), 0) || undefined, panel: null }] : [])]} /></div>;
  return { tabs, content: inMore ? <>
    <ListTabs label={t("More")} items={grouped.map(({ id, label, count }) => ({ id, label, count: count || undefined }))} value={value} onChange={onChange} />{panel}
  </> : panel };
}
