"use client";

import { useState } from "react";
import { Avatar, Button, Form, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalMeeting } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { FileStrip } from "./attach-files";

/**
 * PLM-153: the notes of one meeting as the team shared them (the latest version, saying when it was updated), their
 * files, and the conversation on them: the client comments, the team answers as one team.
 */
export function MeetingNotes({ meeting, caseId, api, format, onCommented }: { meeting: PortalMeeting; caseId: string; api: PortalApi; format: PortalFormat; onCommented: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A retried send is the same command and the same comment (never two).
  const [ids, setIds] = useState(() => ({ command: commandId(), comment: commandId() }));
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api.command(ids.command, { action: "minutes_comment", caseId, minutesId: meeting.id, commentId: ids.comment, text: text.trim() });
      setText(""); setIds({ command: commandId(), comment: commandId() }); onCommented();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const sender = (comment: PortalMeeting["comments"][number]) => (!comment.fromClient ? t("Your project team") : comment.mine ? t("You") : comment.author || t("Your household"));
  return <div className={styles.chat}>
    <p className={styles.muted}>{[format.date(meeting.meetingAt ?? meeting.sharedAt), meeting.updatedAt ? t("Updated {date}", { date: format.date(meeting.updatedAt) }) : ""]
      .filter(Boolean).join(" · ")}</p>
    <p className={styles.body} dir="auto">{meeting.text}</p>
    <FileStrip files={meeting.files} api={api} kind="minutes" />
    {meeting.comments.length ? <ol className={styles.chatLog} role="log" aria-label={t("Comments")} tabIndex={0}>
      {meeting.comments.map((comment) => <li key={comment.id} className={styles.bubble} data-mine={comment.fromClient} aria-label={sender(comment)}>
        <span className={styles.bubbleSender}><Avatar name={sender(comment)} size="sm" />{sender(comment)}</span>
        <p className={styles.body} dir="auto">{comment.text}</p>
        <span className={styles.bubbleMeta}><time dateTime={comment.at}>{format.date(comment.at)} {format.time(comment.at)}</time></span>
      </li>)}
    </ol> : null}
    <Form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Comment")} value={text} onChange={setText} maxLength={2000} />
      <div className={styles.composerActions}>
        <Button type="submit" variant="primary" isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button>
      </div>
    </Form>
  </div>;
}
