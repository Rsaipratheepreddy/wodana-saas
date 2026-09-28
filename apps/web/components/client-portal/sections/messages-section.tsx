"use client";

import { ChevronRight, Paperclip } from "lucide-react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** Conversations with the project team, newest activity first; a count shows replies the client hasn't read. */
export function MessagesSection({ project, format, open }: SectionProps) {
  const t = useT();
  const messages = project.messages;
  if (!messages) return null;
  const write = <Button variant="primary" onPress={() => open({ kind: "new-message" })}>{t("New message")}</Button>;
  if (!messages.requests.length) return <EmptyState illustration="empty" title={t("No messages yet")} description={t("Ask your project team anything here.")} action={write} />;
  return <div className={styles.section}>
    <div>{write}</div>
    <ul className={styles.list}>{messages.requests.map((request) => {
      const files = request.files.length + request.comments.reduce((sum, comment) => sum + comment.files.length, 0);
      const replies = request.comments.length === 1 ? t("1 reply") : t("{count} replies", { count: request.comments.length });
      return <li key={request.id}>
        <button className={`${styles.item} ${styles.itemButton}`} data-unread={request.unread > 0 || undefined} type="button" onClick={() => open({ kind: "thread", id: request.id })}>
          <span className={styles.itemText}><span className={styles.itemTitle} dir="auto">{request.title}</span>
            <span className={styles.itemMeta}>{format.date(request.lastAt)}{request.comments.length ? ` · ${replies}` : ""}
              {files ? <> · <span className={styles.inlineIcon} aria-label={t("{count} files", { count: files })}><Paperclip aria-hidden="true" size={12} />{files}</span></> : null}</span></span>
          <span className={styles.itemEnd}>
            {request.unread ? <span className="wd-count-chip" aria-label={t("{count} new", { count: request.unread })}>{request.unread}</span> : <StateLabel state={request.status} />}
            <ChevronRight aria-hidden="true" size={18} /></span>
        </button>
      </li>;
    })}</ul>
  </div>;
}
