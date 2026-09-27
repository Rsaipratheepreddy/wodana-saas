"use client";

import { ChevronRight } from "lucide-react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** Conversations with the project team: the client's requests and the team's replies. */
export function MessagesSection({ project, format, open }: SectionProps) {
  const t = useT();
  const messages = project.messages;
  if (!messages) return null;
  const write = <Button variant="primary" onPress={() => open({ kind: "new-message" })}>{t("New message")}</Button>;
  if (!messages.requests.length) return <EmptyState illustration="empty" title={t("No messages yet")} description={t("Ask your project team anything here.")} action={write} />;
  return <div className={styles.section}>
    <div>{write}</div>
    <ul className={styles.list}>{messages.requests.map((request) => <li key={request.id}>
      <button className={`${styles.item} ${styles.itemButton}`} type="button" onClick={() => open({ kind: "thread", id: request.id })}>
        <span className={styles.itemText}><span className={styles.itemTitle}>{request.title}</span>
          <span className={styles.itemMeta}>{format.date(request.createdAt)}{request.comments.length ? ` · ${t("{count} replies", { count: request.comments.length })}` : ""}</span></span>
        <span className={styles.itemEnd}><StateLabel state={request.status} /><ChevronRight aria-hidden="true" size={18} /></span>
      </button>
    </li>)}</ul>
  </div>;
}
