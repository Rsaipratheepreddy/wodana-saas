"use client";

import { ChevronRight } from "lucide-react";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";

/** One thing to decide (or decided) in the client's list: what it is, a short fact, its state; opens the decision. */
export function DecisionRow({ title, meta, state, waiting, "data-tour": tour, onOpen }: { title: string; meta: string; state: string; waiting: boolean; "data-tour"?: string; onOpen: () => void }) {
  return <button className={`${styles.item} ${styles.itemButton}`} data-tour={tour} data-tour-safe type="button" onClick={onOpen}>
    <span className={styles.itemText}><span className={styles.itemTitle}>{title}</span>{meta ? <span className={styles.itemMeta}>{meta}</span> : null}</span>
    <span className={styles.itemEnd}><StateLabel state={state} canDecide={waiting} /><ChevronRight aria-hidden="true" size={18} /></span>
  </button>;
}
