"use client";

import { EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isolate } from "../portal-format";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/**
 * PLM-170: the client's bill of quantities, room by room: each item with its description, quantity, unit, selling rate
 * and amount, a total per room and the agreed total, as the latest sealed revision stands. Nothing of the cost side is here.
 */
export function BoqSection({ project, format }: SectionProps) {
  const t = useT();
  const boq = project.boq;
  if (!boq) return null;
  if (!boq.rooms.length) return <EmptyState illustration="empty" title={t("No items yet")} description={t("Your bill of quantities will appear here once your quotation is accepted.")} />;
  const money = (value: string) => format.money(value, boq.currency);
  return <div className={styles.section} aria-label={t("Bill of quantities")}>
    {boq.rooms.map((room) => <section className={styles.group} key={room.id ?? "general"} aria-label={room.name ?? t("General")}>
      <ul className={styles.list}>
        <li className={styles.item}>
          <span className={styles.itemText}><span className={styles.itemTitle} dir="auto">{room.name ?? t("General")}</span></span>
          <span className={styles.itemEnd}><span className={styles.amount}>{money(room.total)}</span></span>
        </li>
        {room.lines.map((line) => <li className={styles.item} key={line.id}>
          <span className={styles.itemText}>
            <span className={styles.itemTitle} dir="auto">{line.title}</span>
            {line.description ? <span className={styles.itemMeta} dir="auto">{line.description}</span> : null}
            <span className={styles.itemMeta}>{t("{quantity} {unit} × {rate}", { quantity: isolate(format.number(line.quantity)), unit: line.unit, rate: money(line.rate) })}</span>
          </span>
          <span className={styles.itemEnd}><span className={styles.amount}>{money(line.amount)}</span></span>
        </li>)}
      </ul>
    </section>)}
    <p className={styles.total}>
      <span>{boq.revision ? t("Agreed total · {revision}", { revision: isolate(boq.revision) }) : t("Agreed total")}</span>
      <span className={styles.amount}>{money(boq.total)}</span>
    </p>
  </div>;
}
