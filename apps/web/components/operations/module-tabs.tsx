"use client";

import type { ReactNode } from "react";
import { IconMenuButton, MAX_TABS, Tabs } from "@/design-system";
import type { useT } from "@/lib/i18n/i18n-provider";
import styles from "./operations.module.css";

export type ModuleTab<T extends string> = { id: T; label: string; count?: number; panel: ReactNode };

/**
 * A module's sections as tabs under its title (PageShell `tabs`), and the open section as the page content.
 * Over six, the sections named in `more` move into a "More" menu (⋯) at the end of the tabs, so a person never sees
 * more than six tabs (§5c D3) and the page keeps one row; the one opened from it shows as the last tab while it is
 * open. Each section keeps its own address. One section is just its content.
 * A plain function (no hooks), so a page may call it after an early return.
 */
export function moduleTabs<T extends string>({ t, items, value, onChange, more = [], tour }: {
  t: ReturnType<typeof useT>;
  items: Array<ModuleTab<T>>; value: T; onChange: (id: T) => void; /** Sections grouped under "More" when there are more than six. */ more?: readonly T[];
  /** Names each tab `data-tour="<tour>-<id>"` for Woddy's tours. */ tour?: string;
}): { tabs: ReactNode; content: ReactNode } {
  const grouped = items.length > MAX_TABS ? items.filter((item) => more.includes(item.id)) : [];
  const rest = grouped.filter((item) => item.id !== value);
  const shown = [...items.filter((item) => !grouped.includes(item)), ...grouped.filter((item) => item.id === value)];
  const panel = items.find((item) => item.id === value)?.panel ?? null;
  if (items.length <= 1) return { tabs: null, content: panel };
  const waiting = rest.reduce((sum, item) => sum + (item.count ?? 0), 0);
  // The sections are routes and their content is the page body, so the tab list carries no panel of its own.
  const tabs = <div className={styles.moduleTabs}>
    <Tabs tour={tour} selectedKey={value} onSelectionChange={(key) => onChange(key as T)}
      items={shown.map(({ id, label, count }) => ({ id, label, count: count || undefined, panel: null }))} />
    {rest.length ? <IconMenuButton ariaLabel={t("More")} count={waiting} items={rest.map(({ id, label }) => ({ id, label }))} onAction={(id) => onChange(id as T)} /> : null}
  </div>;
  return { tabs, content: panel };
}
