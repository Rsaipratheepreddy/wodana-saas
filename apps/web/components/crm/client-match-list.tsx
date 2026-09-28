"use client";

import type { ReactNode } from "react";
import { Badge, formatDate, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ClientMatch } from "@/lib/crm/client-match";
import { customerDisplayName } from "@/lib/crm/customer-name";
import { formatPhoneForDisplay } from "@/lib/crm/phone";
import styles from "./client-match-list.module.css";

/** Existing clients a new enquiry may belong to: mobile, email, latest enquiry and its owner (LF-1, S-3). */
export function ClientMatchList({ matches, actions, label }: { matches: ClientMatch[]; actions: (match: ClientMatch) => ReactNode; label: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  return <ul className={styles.list} aria-label={label}>
    {matches.map((match) => <li key={match.candidateId ?? match.partyId} className={styles.item}>
      <div className={styles.facts}>
        <strong>{customerDisplayName(match.name)}</strong>
        <span>{[match.mobile ? formatPhoneForDisplay(match.mobile) : null, match.email].filter(Boolean).join(" · ") || t("No contact details")}</span>
        {match.reference ? <span className={styles.enquiry}>
          <Badge tone={match.open ? "info" : "neutral"}>{match.open ? t("Open") : t("Closed")}</Badge>
          {match.reference}{match.receivedAt ? ` · ${formatDate(new Date(match.receivedAt), { locale, timeZone }, { day: "numeric", month: "short", year: "numeric" })}` : ""}
          {match.ownerName ? ` · ${t("Owner {name}", { name: match.ownerName })}` : ""}
        </span> : <span className={styles.enquiry}>{t("No enquiries yet")}</span>}
      </div>
      <div className={styles.actions}>{actions(match)}</div>
    </li>)}
  </ul>;
}
