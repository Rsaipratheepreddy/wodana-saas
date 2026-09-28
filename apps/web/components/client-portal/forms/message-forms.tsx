"use client";

import { CheckCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Form, InlineNotice, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalRequest } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { AttachFiles, FileStrip } from "./attach-files";

/** A new message to the project team, with photos or PDFs. */
export function NewMessage({ caseId, api, onDone }: { caseId: string; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "request", caseId, title: title.trim(), detail: detail.trim(), uploadIds: uploads }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <TextInput label={t("Subject")} value={title} onChange={setTitle} maxLength={240} isRequired autoFocus />
    <TextAreaField label={t("Message")} value={detail} onChange={setDetail} maxLength={6000} isRequired />
    <AttachFiles caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!title.trim() || !detail.trim() || uploading}>{t("Send")}</Button></div>
  </Form>;
}

/**
 * One conversation: what the client asked, the replies (with files), whether the team has seen their last word,
 * and a reply box. Opening it marks the team's replies read.
 */
export function Thread({ request, caseId, api, format, onReplied }: { request: PortalRequest; caseId: string; api: PortalApi; format: PortalFormat; onReplied: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachKey, setAttachKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id, setId] = useState(commandId);
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !request.unread) return;
    marked.current = true;
    void api.command(commandId(), { action: "read_thread", caseId, requestId: request.id }).then(onReplied, () => undefined);
  }, [api, caseId, onReplied, request.id, request.unread]);
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api.command(id, { action: "comment", caseId, requestId: request.id, text: text.trim(), uploadIds: uploads });
      setText(""); setId(commandId()); setAttachKey((key) => key + 1); onReplied();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const last = request.comments.at(-1);
  const lastIsMine = !last || last.fromClient;
  return <div className={styles.sheet}>
    <ol className={styles.messages}>
      <li className={styles.message} data-mine="true"><p className={styles.body} dir="auto">{request.detail}</p><FileStrip files={request.files} api={api} />
        <span className={styles.muted}>{format.date(request.createdAt)}</span></li>
      {request.comments.map((comment) => <li className={styles.message} data-mine={comment.fromClient} key={comment.id}>
        <span className={styles.muted}>{comment.fromClient ? t("You") : t("Your project team")}</span>
        {comment.text ? <p className={styles.body} dir="auto">{comment.text}</p> : null}
        <FileStrip files={comment.files} api={api} />
        <span className={styles.muted}>{format.date(comment.at)}</span>
      </li>)}
    </ol>
    {lastIsMine && request.seenByTeam ? <p className={styles.seen}><CheckCheck aria-hidden="true" size={14} />{t("Seen by your project team")}</p> : null}
    {request.resolution ? <p className={styles.muted} dir="auto">{request.resolution}</p> : null}
    <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Reply")} value={text} onChange={setText} maxLength={6000} />
      <AttachFiles key={attachKey} caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} />
      <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={(!text.trim() && !uploads.length) || uploading}>{t("Send")}</Button></div>
    </Form>
  </div>;
}
