"use client";

import { useState, type MouseEvent } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Badge, Button, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalDesignThread } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../../pre-project/design-decisions.module.css";

/**
 * Design comments both ways (plan §6.7a): the client pins a comment on a point of the picture (or on the whole
 * file), replies in a thread and resolves what they started; the team's shared threads sit in the same list. The
 * design team is "your design team", never a staff name.
 */
export function DesignComments({ caseId, versionId, image, threads, canComment, api, format, onChanged }: {
  caseId: string; versionId: string; image: string | null; threads: PortalDesignThread[]; canComment: boolean; api: PortalApi; format: PortalFormat; onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ids] = useState(() => ({ comment: commandId() }));
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(""); try { await work(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); } finally { setBusy(false); } };
  const pin = (event: MouseEvent<HTMLButtonElement>) => {
    if (!canComment) return;
    const box = event.currentTarget.getBoundingClientRect();
    const round = (value: number) => Math.min(1, Math.max(0, Math.round(value * 10000) / 10000));
    setAnchor({ x: round((event.clientX - box.left) / box.width), y: round((event.clientY - box.top) / box.height) });
    setWriting(true);
  };
  const numbered = threads.filter((thread) => thread.anchor);
  return <section className={styles.stack} aria-label={t("Comments")}>
    {image ? <div className={styles.canvas} dir="ltr">
      {/* The picture keeps its own left-to-right coordinates in every language; pins sit where they were placed. */}
      <button type="button" aria-label={canComment ? t("Tap the picture to pin a comment") : t("Design picture")} onClick={pin} disabled={!canComment} className={styles.canvasButton}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route */}
        <img alt="" src={image} />
      </button>
      {numbered.map((thread, index) => <span key={thread.id} className={styles.pin} data-client={thread.fromClient || undefined} data-resolved={thread.status === "resolved" || undefined}
        style={{ insetInlineStart: `${thread.anchor!.x * 100}%`, insetBlockStart: `${thread.anchor!.y * 100}%` }} aria-hidden="true">{index + 1}</span>)}
      {anchor ? <span className={styles.pin} style={{ insetInlineStart: `${anchor.x * 100}%`, insetBlockStart: `${anchor.y * 100}%` }} aria-hidden="true">+</span> : null}
    </div> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {canComment && !writing ? <div><Button size="compact" onPress={() => { setAnchor(null); setWriting(true); }}><MessageSquarePlus aria-hidden="true" size={14} />{t("Comment on the whole design")}</Button></div> : null}
    {writing ? <div className={styles.stack}>
      <TextAreaField autoFocus isRequired label={anchor ? t("Your comment on this spot") : t("Your comment")} maxLength={5000} value={text} onChange={setText} />
      <div className={styles.bar}><span className={styles.spacer} />
        <Button size="compact" variant="quiet" onPress={() => { setWriting(false); setAnchor(null); setText(""); }}>{t("Cancel")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} isDisabled={!text.trim()} onPress={() => void run(async () => {
          await api.command(ids.comment, { action: "design_comment", caseId, versionId, text: text.trim(), anchor });
          ids.comment = commandId(); setWriting(false); setAnchor(null); setText("");
        })}>{t("Send")}</Button>
      </div>
    </div> : null}
    {threads.length ? <ol className={styles.history} aria-label={t("Comments")}>{threads.map((thread) => {
      const number = thread.anchor ? numbered.indexOf(thread) + 1 : null;
      return <li className={styles.version} key={thread.id}>
        <span className={styles.versionNumber}>{number ?? "•"}</span>
        <div className={styles.stack}>
          {thread.messages.map((message) => <div className={styles.cell} key={message.id}>
            <span>{message.text}</span>
            <small>{message.fromClient ? message.author ?? t("You") : t("Your design team")} · {format.date(message.at)}</small>
          </div>)}
          <div className={styles.inline}>
            {thread.status === "resolved" ? <Badge tone="success">{t("Resolved")}</Badge> : null}
            {thread.status === "open" && canComment ? <TextAreaField label={t("Reply")} maxLength={5000} value={replies[thread.id] ?? ""} onChange={(value) => setReplies((current) => ({ ...current, [thread.id]: value }))} /> : null}
          </div>
          <div className={styles.bar}><span className={styles.spacer} />
            {thread.canResolve ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void run(() => api.command(commandId(), { action: "design_resolve", caseId, threadId: thread.id, version: thread.version, status: thread.status === "resolved" ? "open" : "resolved" }))}>
              {thread.status === "resolved" ? t("Reopen") : t("Resolve")}</Button> : null}
            {thread.status === "open" && canComment && (replies[thread.id] ?? "").trim() ? <Button size="compact" isLoading={busy} onPress={() => void run(async () => {
              await api.command(commandId(), { action: "design_reply", caseId, threadId: thread.id, text: (replies[thread.id] ?? "").trim() });
              setReplies((current) => ({ ...current, [thread.id]: "" }));
            })}>{t("Reply")}</Button> : null}
          </div>
        </div>
      </li>;
    })}</ol> : <p className={styles.muted}>{canComment ? t("No comments yet. Tap the picture to pin one where it matters.") : t("No comments yet.")}</p>}
  </section>;
}
