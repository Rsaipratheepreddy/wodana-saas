"use client";

import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** What's under warranty and until when, and the problems the client reported. */
export function WarrantySection({ project, format, open }: SectionProps) {
  const t = useT();
  const warranty = project.warranty;
  if (!warranty) return null;
  if (!warranty.items.length && !warranty.claims.length)
    return <EmptyState illustration="done" title={t("Your warranty starts at handover")} description={t("Once you accept the handover, what's covered and until when will be here.")} />;
  return <div className={styles.section}>
    {warranty.canClaim ? <div><Button variant="primary" onPress={() => open({ kind: "claim" })}>{t("Report a problem")}</Button></div> : null}
    {warranty.claims.length ? <section className={styles.group} aria-labelledby="portal-claims">
      <h2 className={styles.groupTitle} id="portal-claims">{t("Your reports")}</h2>
      <ul className={styles.list}>{warranty.claims.map((claim) => <li className={styles.item} key={claim.id}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle}>{claim.description}</span>
          <span className={styles.itemMeta}>{[format.date(claim.raisedOn), claim.reason].filter(Boolean).join(" · ")}</span>
        </span>
        <span className={styles.itemEnd}><StateLabel state={claim.status} /></span>
      </li>)}</ul>
    </section> : null}
    {warranty.items.length ? <section className={styles.group} aria-labelledby="portal-cover">
      <h2 className={styles.groupTitle} id="portal-cover">{t("What's covered")}</h2>
      <ul className={styles.list}>{warranty.items.map((item) => <li className={styles.item} key={item.id}>
        <span className={styles.itemText}><span className={styles.itemTitle}>{item.title}</span>{item.area ? <span className={styles.itemMeta}>{item.area}</span> : null}</span>
        <span className={styles.itemEnd}>{item.active ? t("Until {date}", { date: format.date(item.endsOn) }) : t("Ended {date}", { date: format.date(item.endsOn) })}</span>
      </li>)}</ul>
    </section> : null}
  </div>;
}
