"use client";

import { Check, CheckCheck } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Form, InlineNotice, TextAreaField, TextInput } from "@/design-system";
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

type Bubble = { id: string; at: string; text: string; files: PortalRequest["files"]; fromClient: boolean; author: string | null; mine: boolean; seen: boolean };

/**
 * One conversation as a chat, oldest at the top: the client's side at the end, the project team at the start,
 * a divider for each day, the sender once per run of messages, the time and whether the team has seen it, and
 * the reply box at the foot. It opens at the newest message; opening it marks the team's replies read.
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
  const log = useRef<HTMLOListElement>(null);
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
  const openedByClient = request.fromClient ?? true;
  const bubbles = useMemo(() => {
    const teamAnswered = request.comments.some((comment) => !comment.fromClient);
    const opener: Bubble = { id: request.id, at: request.createdAt, text: request.detail, files: request.files, fromClient: openedByClient, author: request.author ?? null,
      mine: request.mine ?? openedByClient, seen: request.seenByTeam || teamAnswered || request.comments.some((comment) => comment.fromClient && comment.seen) };
    const replies = request.comments.map((comment): Bubble => ({ id: comment.id, at: comment.at, text: comment.text, files: comment.files, fromClient: comment.fromClient,
      author: comment.author ?? null, mine: comment.mine ?? comment.fromClient, seen: comment.seen ?? (comment.fromClient ? request.seenByTeam : true) }));
    // Oldest first, whatever order they arrive in; the same moment keeps its order.
    return [opener, ...replies].map((bubble, index) => ({ bubble, index }))
      .sort((a, b) => (a.bubble.at < b.bubble.at ? -1 : a.bubble.at > b.bubble.at ? 1 : a.index - b.index)).map(({ bubble }) => bubble);
  }, [openedByClient, request]);
  // Open at the newest message, and follow new ones.
  useLayoutEffect(() => { const element = log.current; if (element) element.scrollTop = element.scrollHeight; }, [bubbles.length]);
  const sender = (bubble: Bubble) => (!bubble.fromClient ? t("Your project team") : bubble.mine ? t("You") : bubble.author || t("Your household"));
  return <div className={styles.chat}>
    <ol className={styles.chatLog} ref={log} role="log" aria-label={t("Messages")} tabIndex={0}>
      {bubbles.map((bubble, index) => {
        const previous = bubbles[index - 1];
        const newDay = !previous || format.day(previous.at) !== format.day(bubble.at);
        const continued = Boolean(previous) && !newDay && previous.fromClient === bubble.fromClient && previous.author === bubble.author
          && Date.parse(bubble.at) - Date.parse(previous.at) < 600_000;
        return <Fragment key={bubble.id}>
          {newDay ? <li className={styles.chatDay}><span>{format.date(bubble.at)}</span></li> : null}
          <li className={styles.bubble} data-mine={bubble.fromClient} data-continued={continued || undefined} aria-label={sender(bubble)}>
            {!continued ? <span className={styles.bubbleSender}><Avatar name={sender(bubble)} size="sm" />{sender(bubble)}</span> : null}
            {bubble.text ? <p className={styles.body} dir="auto">{bubble.text}</p> : null}
            <FileStrip files={bubble.files} api={api} />
            <span className={styles.bubbleMeta}>
              <time dateTime={bubble.at}>{format.time(bubble.at)}</time>
              {bubble.fromClient ? bubble.seen ? <CheckCheck aria-label={t("Seen by your project team")} data-seen="true" size={14} /> : <Check aria-label={t("Sent")} size={14} /> : null}
            </span>
          </li>
        </Fragment>;
      })}
    </ol>
    {request.resolution ? <p className={styles.muted} dir="auto">{request.resolution}</p> : null}
    <Form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Reply")} value={text} onChange={setText} maxLength={6000} />
      <div className={styles.composerActions}>
        <AttachFiles key={attachKey} caseId={caseId} api={api} onChange={setUploads} onBusy={setUploading} />
        <Button type="submit" variant="primary" isLoading={busy} isDisabled={(!text.trim() && !uploads.length) || uploading}>{t("Send")}</Button>
      </div>
    </Form>
  </div>;
}
