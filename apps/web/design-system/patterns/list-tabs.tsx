"use client";

import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useT } from "@/lib/i18n/i18n-provider";
import { useDesignSystem } from "../foundations/provider";

/** The most tabs a view may show (§5c D3); more belongs in a filter. */
export const MAX_TABS = 6;

/**
 * The lists a person works from (e.g. All · Ready to start · In design), under the title. The active tab is
 * bold and underlined. A count shows only when it asks for action: pass `count` for those tabs; zero hides.
 * Never cut off: the tabs that don't fit the width fold into a "More" menu at the end (showing the chosen one's name
 * when it is folded), so every label stays whole.
 */
export function ListTabs<T extends string>({ label, items, value, onChange }: { label: string; items: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (id: T) => void }) {
  if (items.length > MAX_TABS && process.env.NODE_ENV !== "production") console.error(`ListTabs "${label}" has ${items.length} tabs; at most ${MAX_TABS} are allowed. Move the rest into a filter.`);
  const t = useT();
  const { direction } = useDesignSystem();
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(items.length);
  const signature = items.map((item) => `${item.id}:${item.label}:${item.count ?? ""}`).join("|");
  useLayoutEffect(() => {
    const box = row.current;
    const ruler = measure.current;
    if (!box || !ruler || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const width = box.clientWidth;
      const tabs = [...ruler.children] as HTMLElement[];
      const more = tabs.pop();
      if (!width || !more || !more.offsetWidth) { setFits(items.length); return; }
      const gap = parseFloat(getComputedStyle(ruler).columnGap || "0") || 0;
      const sizes = tabs.map((tab) => tab.offsetWidth);
      const total = sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, sizes.length - 1);
      if (total <= width) { setFits(items.length); return; }
      let used = more.offsetWidth;
      let count = 0;
      for (const size of sizes) { if (used + gap + size > width) break; used += gap + size; count += 1; }
      setFits(Math.max(1, count));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature stands for the items
  }, [signature]);
  const shown = items.slice(0, fits);
  const folded = items.slice(fits);
  const chosenFolded = folded.find((item) => item.id === value);
  const tab = (item: { id: T; label: string; count?: number }) => <>
    <span className="wd-list-tab-label" data-label={item.label}>{item.label}</span>{item.count ? <span className="wd-count-chip wd-list-tab-count">{item.count}</span> : null}
  </>;
  return <div className="wd-list-tabs-frame">
    <div aria-label={label} className="wd-list-tabs" role="group" ref={row}>
      {shown.map((item) => <button aria-pressed={value === item.id} className="wd-list-tab" key={item.id} onClick={() => onChange(item.id)} type="button">{tab(item)}</button>)}
      {folded.length ? <MenuTrigger>
        <AriaButton className="wd-list-tab" aria-pressed={Boolean(chosenFolded)} aria-label={chosenFolded ? `${chosenFolded.label} · ${t("More")}` : t("More")}>
          {chosenFolded ? tab(chosenFolded) : <span className="wd-list-tab-label" data-label={t("More")}>{t("More")}</span>}<ChevronDown aria-hidden="true" size={14} />
        </AriaButton>
        <Popover className="wd-popover" dir={direction} placement="bottom end">
          <Menu className="wd-menu" aria-label={label} onAction={(key) => onChange(String(key) as T)}>
            {folded.map((item) => <MenuItem className="wd-menu-item" id={item.id} key={item.id} textValue={item.label}>
              <span>{item.label}</span>{item.count ? <span className="wd-count-chip">{item.count}</span> : null}
            </MenuItem>)}
          </Menu>
        </Popover>
      </MenuTrigger> : null}
    </div>
    {/* Measures every tab at its full width (never shown, never read by assistive technology). */}
    <div className="wd-list-tabs wd-list-tabs-measure" aria-hidden="true" ref={measure}>
      {items.map((item) => <span className="wd-list-tab" key={item.id}>{tab(item)}</span>)}
      <span className="wd-list-tab"><span className="wd-list-tab-label">{t("More")}</span><ChevronDown size={14} /></span>
    </div>
  </div>;
}
