"use client";

import { ChevronDown } from "lucide-react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { FileStrip } from "../forms/attach-files";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** What's covered, one line per room (open it for the items), and the problems the client reported. */
export function WarrantySection({ project, api, format, open }: SectionProps) {
  const t = useT();
  const warranty = project.warranty;
  if (!warranty) return null;
  if (!warranty.rooms.length && !warranty.claims.length)
    return <EmptyState illustration="done" title={t("Your warranty starts at handover")} description={t("Once you accept the handover, what's covered and until when will be here.")} />;
  return <div className={styles.section}>
    {warranty.canClaim ? <div><Button variant="primary" onPress={() => open({ kind: "claim" })}>{t("Report a problem")}</Button></div> : null}
    {warranty.claims.length ? <section className={styles.group} aria-labelledby="portal-claims">
      <h2 className={styles.groupTitle} id="portal-claims">{t("Your reports")}</h2>
      <ul className={styles.list}>{warranty.claims.map((claim) => <li className={styles.item} key={claim.id}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle} dir="auto">{claim.description}</span>
          <span className={styles.itemMeta}>{format.date(claim.raisedOn)}</span>
          {claim.reason ? <span className={styles.itemMeta} dir="auto">{claim.reason}</span> : null}
          <FileStrip files={claim.files} api={api} />
        </span>
        <span className={styles.itemEnd}><StateLabel state={claim.status} /></span>
      </li>)}</ul>
    </section> : null}
    {warranty.rooms.length ? <section className={styles.group} aria-labelledby="portal-cover">
      <h2 className={styles.groupTitle} id="portal-cover">{t("What's covered")}</h2>
      <ul className={styles.list}>{warranty.rooms.map((room) => <li key={room.id ?? "general"}>
        <details className={styles.disclosure}>
          <summary className={styles.item}>
            <span className={styles.itemText}>
              <span className={styles.itemTitle} dir="auto">{room.name ?? t("Whole home")}</span>
              <span className={styles.itemMeta}>{[room.items.length === 1 ? t("1 item") : t("{count} items", { count: room.items.length }),
                room.active ? t("until {date}", { date: format.date(room.until) }) : t("ended {date}", { date: format.date(room.until) })].join(" · ")}</span>
            </span>
            <span className={styles.itemEnd}><ChevronDown aria-hidden="true" className={styles.disclosureIcon} size={18} /></span>
          </summary>
          <ul className={styles.subList}>{room.items.map((item) => <li key={item.id} dir="auto">{item.title}</li>)}</ul>
          {warranty.canClaim && room.active && room.id ? <div><Button size="compact" variant="quiet" onPress={() => open({ kind: "claim", areaId: room.id })}>
            {t("Report a problem here")}</Button></div> : null}
        </details>
      </li>)}</ul>
    </section> : null}
  </div>;
}
