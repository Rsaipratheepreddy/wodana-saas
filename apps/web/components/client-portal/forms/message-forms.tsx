"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalRequest } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";

/** A new message to the project team. */
export function NewMessage({ caseId, api, onDone }: { caseId: string; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "request", caseId, title: title.trim(), detail: detail.trim() }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <TextInput label={t("Subject")} value={title} onChange={setTitle} maxLength={240} isRequired autoFocus />
    <TextAreaField label={t("Message")} value={detail} onChange={setDetail} maxLength={6000} isRequired />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!title.trim() || !detail.trim()}>{t("Send")}</Button></div>
  </Form>;
}

/** One conversation: what the client asked, the replies, and a reply box. */
export function Thread({ request, caseId, api, format, onReplied }: { request: PortalRequest; caseId: string; api: PortalApi; format: PortalFormat; onReplied: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id, setId] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "comment", caseId, requestId: request.id, text: text.trim() }); setText(""); setId(commandId()); onReplied(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <div className={styles.sheet}>
    <ol className={styles.messages}>
      <li className={styles.message} data-mine="true"><p className={styles.body}>{request.detail}</p><span className={styles.muted}>{format.date(request.createdAt)}</span></li>
      {request.comments.map((comment) => <li className={styles.message} data-mine={comment.fromClient} key={comment.id}>
        <span className={styles.muted}>{comment.fromClient ? t("You") : t("Your project team")}</span>
        <p className={styles.body}>{comment.text}</p><span className={styles.muted}>{format.date(comment.at)}</span>
      </li>)}
    </ol>
    {request.resolution ? <p className={styles.muted}>{request.resolution}</p> : null}
    <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Reply")} value={text} onChange={setText} maxLength={6000} />
      <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button></div>
    </Form>
  </div>;
}
