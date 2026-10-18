"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, MessageCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button, InlineNotice, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, staffPortalApi } from "@/lib/client-portal/client";
import type { StaffBoardComment, StaffMoodboard } from "@/lib/client-portal/types";
import styles from "./client-activity.module.css";

export type BoardTarget = "pin" | "design";
/** Only a whole moodboard replaces what's shown. */
const valid = (next: StaffMoodboard | null) => (Array.isArray(next?.shared) && Array.isArray(next?.comments) ? next : null);

/** The case's moodboard as the client works with it: what's shown to them, their likes and dislikes, and the conversation. */
export function useClientBoard(workspaceId: string, caseId: string) {
  const t = useT();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [board, setBoard] = useState<StaffMoodboard | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const next = valid(await api.moodboard(caseId)); if (next) setBoard(next); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the client's feedback.")); }
  }, [api, caseId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  /** Shows (or hides) pins in the client's portal. */
  const share = useCallback(async (entryIds: string[], shared: boolean) => { const next = valid(await api.shareMoodboard(caseId, { entryIds, shared })); if (next) setBoard(next); }, [api, caseId]);
  /** Answers the client on a pin or board; the id keeps a retry of the same reply safe. */
  const reply = useCallback(async (input: { id: string; targetKind: BoardTarget; targetId: string; text: string }) => { const next = valid(await api.replyMoodboard(caseId, input)); if (next) setBoard(next); }, [api, caseId]);
  return { board, error, load, share, reply };
}

export type ClientBoard = ReturnType<typeof useClientBoard>;

/** What the client said about one pin or board: who liked it, who disliked it, and the comments both ways. */
export function feedbackFor(board: StaffMoodboard | null, kind: BoardTarget, id: string) {
  const reactions = board?.reactions.filter((item) => item.targetKind === kind && item.targetId === id) ?? [];
  return {
    likes: reactions.filter((item) => item.reaction === "like").map((item) => item.by),
    dislikes: reactions.filter((item) => item.reaction === "dislike").map((item) => item.by),
    comments: board?.comments.filter((item) => item.targetKind === kind && item.targetId === id) ?? [],
  };
}

/** Small counts for a card: shown in the portal, likes, dislikes and comments. Nothing when there's nothing to say. */
export function FeedbackSignals({ board, kind, id, shown }: { board: StaffMoodboard | null; kind: BoardTarget; id: string; shown: boolean }) {
  const t = useT();
  const { likes, dislikes, comments } = feedbackFor(board, kind, id);
  if (!shown && !likes.length && !dislikes.length && !comments.length) return null;
  return <ul className={styles.signals} aria-label={t("Client feedback")}>
    {shown ? <li title={t("Shown to the client")}><Eye aria-hidden="true" size={13} />{t("Shown to the client")}</li> : null}
    {likes.length ? <li aria-label={likes.length === 1 ? t("1 like") : t("{count} likes", { count: likes.length })} title={likes.join(", ")}><ThumbsUp aria-hidden="true" size={13} />{likes.length}</li> : null}
    {dislikes.length ? <li aria-label={dislikes.length === 1 ? t("1 dislike") : t("{count} dislikes", { count: dislikes.length })} title={dislikes.join(", ")}><ThumbsDown aria-hidden="true" size={13} />{dislikes.length}</li> : null}
    {comments.length ? <li aria-label={comments.length === 1 ? t("1 comment") : t("{count} comments", { count: comments.length })}><MessageCircle aria-hidden="true" size={13} />{comments.length}</li> : null}
  </ul>;
}

/**
 * The client's reactions and the conversation on one pin or board, with a reply box for the design team
 * (the client is told by email). `canReply` is false when the client can't see it, or the person can't edit.
 */
export function ClientFeedback({ board, kind, id, canReply, onReply, title }: {
  board: StaffMoodboard | null; kind: BoardTarget; id: string; canReply: boolean; title?: string;
  onReply: (input: { id: string; targetKind: BoardTarget; targetId: string; text: string }) => Promise<void>;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const { likes, dislikes, comments } = feedbackFor(board, kind, id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One id per reply, kept while its words are retried unchanged, so a retry never posts twice.
  const attempt = useRef<{ id: string; text: string } | null>(null);
  const when = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (attempt.current?.text !== body) attempt.current = { id: commandId(), text: body };
    setBusy(true); setError("");
    try { await onReply({ id: attempt.current.id, targetKind: kind, targetId: id, text: body }); setText(""); attempt.current = null; }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); }
    setBusy(false);
  };
  return <section className={styles.feedback} aria-label={title ?? t("Client feedback")}>
    <h3 className={styles.subhead}>{title ?? t("Client feedback")}</h3>
    {likes.length || dislikes.length ? <ul className={styles.reactions}>
      {likes.length ? <li data-reaction="like"><ThumbsUp aria-hidden="true" size={14} />{t("Liked by {names}", { names: likes.join(", ") })}</li> : null}
      {dislikes.length ? <li data-reaction="dislike"><ThumbsDown aria-hidden="true" size={14} />{t("Disliked by {names}", { names: dislikes.join(", ") })}</li> : null}
    </ul> : null}
    {comments.length ? <ol className={styles.thread} aria-label={t("Comments")}>{comments.map((comment: StaffBoardComment) =>
      <li key={comment.id} className={styles.message} data-from={comment.fromClient ? "client" : "team"}>
        <span className={styles.meta}><strong>{comment.author || (comment.fromClient ? t("Client") : t("Team"))}</strong><time dateTime={comment.at}>{when(comment.at)}</time></span>
        <p className={styles.text}>{comment.text}</p>
      </li>)}</ol> : !likes.length && !dislikes.length ? <p className={styles.muted}>{t("No feedback from the client yet.")}</p> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {canReply ? <div className={styles.reply}>
      <TextAreaField label={t("Reply to the client")} maxLength={2000} value={text} onChange={setText} />
      <div className={styles.replyActions}><Button size="compact" variant="primary" isDisabled={!text.trim()} isLoading={busy} onPress={() => void send()}>{t("Send")}</Button></div>
    </div> : null}
  </section>;
}
