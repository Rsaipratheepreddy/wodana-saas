"use client";

import { ChevronRight, MessageCircle, Paperclip } from "lucide-react";
import { EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** PLM-153: the notes of each meeting with the team, newest meeting first; each opens with its files and the conversation on it. */
export function MeetingsSection({ project, format, open }: SectionProps) {
  const t = useT();
  const meetings = project.meetings?.meetings;
  if (!meetings) return null;
  if (!meetings.length) return <EmptyState illustration="empty" title={t("No meeting notes yet")} description={t("Notes from your meetings with the team appear here.")} />;
  return <div className={styles.section}>
    <ul className={styles.list}>{meetings.map((meeting) => <li key={meeting.id}>
      <button className={`${styles.item} ${styles.itemButton}`} type="button" onClick={() => open({ kind: "minutes", id: meeting.id })}>
        <span className={styles.itemText}><span className={styles.itemTitle} dir="auto">{meeting.title}</span>
          <span className={styles.itemMeta}>{format.date(meeting.meetingAt ?? meeting.sharedAt)}{meeting.updatedAt ? ` · ${t("Updated {date}", { date: format.date(meeting.updatedAt) })}` : ""}
            {meeting.files.length ? <> · <span className={styles.inlineIcon} aria-label={t("{count} files", { count: meeting.files.length })}><Paperclip aria-hidden="true" size={12} />{meeting.files.length}</span></> : null}
            {meeting.comments.length ? <> · <span className={styles.inlineIcon} aria-label={t("{count} comments", { count: meeting.comments.length })}><MessageCircle aria-hidden="true" size={12} />{meeting.comments.length}</span></> : null}
          </span></span>
        <span className={styles.itemEnd}><ChevronRight aria-hidden="true" size={18} /></span>
      </button>
    </li>)}</ul>
  </div>;
}
