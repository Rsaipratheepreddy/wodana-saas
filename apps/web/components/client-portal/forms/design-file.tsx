"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Avatar, Badge, Button, Form, InlineNotice, SegmentedControl, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalFolderDesign } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { useDesignStatus } from "../sections/designs-section";

/**
 * PLM-153: one design in the client's Designs: the file (its picture, or the file to open), its earlier rounds, and the
 * conversation on the round shown. The client comments on any round, in review or approved; the team answers as one
 * team. A file waiting for the client's decision says where to give it.
 */
export function DesignFile({ design, fileId, caseId, api, format, onCommented, onDecide }: {
  design: PortalFolderDesign; fileId?: string; caseId: string; api: PortalApi; format: PortalFormat; onCommented: () => void;
  /** Opens the decision on a file in review (under Decisions), when the client can give it there. */
  onDecide?: (fileId: string) => void;
}) {
  const t = useT();
  const status = useDesignStatus();
  const [shown, setShown] = useState(() => design.files.find((file) => file.id === fileId)?.id ?? design.files[0].id);
  const file = design.files.find((item) => item.id === shown) ?? design.files[0];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A retried send is the same command and the same comment (never two).
  const [ids, setIds] = useState(() => ({ command: commandId(), comment: commandId() }));
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api.command(ids.command, { action: "design_file_comment", caseId, versionId: file.id, commentId: ids.comment, text: text.trim() });
      setText(""); setIds({ command: commandId(), comment: commandId() }); onCommented();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const [label, tone] = status[file.status];
  const sender = (comment: PortalFolderDesign["files"][number]["comments"][number]) =>
    (!comment.fromClient ? t("Your design team") : comment.mine ? t("You") : comment.author || t("Your household"));
  return <div className={styles.chat}>
    {design.files.length > 1 ? <SegmentedControl label={t("Round")} value={file.id} onChange={setShown}
      options={design.files.map((item) => ({ id: item.id, label: `V${item.number}` }))} /> : null}
    <p className={styles.muted}><Badge tone={tone}>{label}</Badge> {format.date(file.sharedAt)}</p>
    {file.hasPreview
      // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
      ? <a href={api.file("design", file.id)} rel="noreferrer" target="_blank"><img className={styles.designPreview} alt={t("{name}, version {number}", { name: design.title, number: file.number })} src={api.file("design", file.id, true)} /></a>
      : <a className={styles.inlineIcon} href={api.file("design", file.id)} rel="noreferrer" target="_blank">{t("Open the file")}<ExternalLink aria-hidden="true" size={14} /></a>}
    {file.status === "client_review" && onDecide ? <div><Button variant="primary" onPress={() => onDecide(file.id)}>{t("Give your decision")}</Button></div> : null}
    {file.comments.length ? <ol className={styles.chatLog} role="log" aria-label={t("Comments")} tabIndex={0}>
      {file.comments.map((comment) => <li key={comment.id} className={styles.bubble} data-mine={comment.fromClient} aria-label={sender(comment)}>
        <span className={styles.bubbleSender}><Avatar name={sender(comment)} size="sm" />{sender(comment)}</span>
        <p className={styles.body} dir="auto">{comment.text}</p>
        <span className={styles.bubbleMeta}><time dateTime={comment.at}>{format.date(comment.at)} {format.time(comment.at)}</time></span>
      </li>)}
    </ol> : null}
    {file.canComment ? <Form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Comment")} value={text} onChange={setText} maxLength={5000} />
      <div className={styles.composerActions}>
        <Button type="submit" variant={file.status === "client_review" && onDecide ? "secondary" : "primary"} isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button>
      </div>
    </Form> : null}
  </div>;
}
