"use client";

import { BRANCH_COMPONENT, CHECK_CATALOGUE, COMPONENT_GROUPS } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { COMPONENT_MIME } from "./flow-canvas";
import { BranchIcon, CHECK_ICONS } from "./flow-icons";
import styles from "./flows.module.css";

/** The component id for a branch; every other component is a catalogue check. */
export const BRANCH = "branch";

/**
 * The left panel (plan §5a): components grouped Contact · Meetings · Sell · Design · Logic. Drag one onto the canvas,
 * or press it to add it after the selected card.
 */
export function FlowPalette({ canBranch, onAdd }: { canBranch: boolean; onAdd: (component: string) => void }) {
  const t = useT();
  return <nav aria-label={t("Components")} className={styles.palette}>
    {COMPONENT_GROUPS.map((group) => {
      const items = group.id === "logic"
        ? [{ id: BRANCH, label: t(BRANCH_COMPONENT.label), hint: t(BRANCH_COMPONENT.hint), Icon: BranchIcon, disabled: !canBranch }]
        : CHECK_CATALOGUE.filter((item) => item.group === group.id).map((item) => ({ id: item.check as string, label: t(item.label), hint: t(item.hint), Icon: CHECK_ICONS[item.check], disabled: false }));
      return <section aria-labelledby={`flow-group-${group.id}`} className={styles.paletteGroup} key={group.id}>
        <h2 className={styles.paletteTitle} id={`flow-group-${group.id}`}>{t(group.label)}</h2>
        <ul className={styles.paletteList}>
          {items.map(({ id, label, hint, Icon, disabled }) => <li key={id}>
            <button aria-disabled={disabled || undefined} className={styles.paletteItem} draggable={!disabled} type="button"
              onClick={() => { if (!disabled) onAdd(id); }}
              onDragStart={(event) => { event.dataTransfer.setData(COMPONENT_MIME, id); event.dataTransfer.effectAllowed = "copy"; }}>
              <span aria-hidden="true" className={styles.paletteIcon} data-tone={group.id}><Icon size={15} /></span>
              <span className={styles.paletteText}><strong>{label}</strong><small>{hint}</small></span>
            </button>
          </li>)}
        </ul>
      </section>;
    })}
  </nav>;
}
