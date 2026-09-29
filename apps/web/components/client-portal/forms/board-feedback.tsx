"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button, Form, InlineNotice, TextAreaField, ToggleButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalComment, PortalReaction } from "@/lib/client-portal/types";
import { isolate, type PortalFormat } from "../portal-format";
import styles from "../portal.module.css";

type Target = { caseId: string; targetKind: "pin" | "design"; targetId: string };

/** Like or dislike a board or an idea; the same again takes it back. Shown at once, confirmed by the reload. */
export function Reactions({ target, reaction, api, onChanged, name }: { target: Target; reaction: PortalReaction | null; api: PortalApi; onChanged: () => void; name: string }) {
  const t = useT();
  const [shown, setShown] = useState<PortalReaction | null>(reaction);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState(reaction);
  if (seen !== reaction) { setSeen(reaction); setShown(reaction); }
  const choose = async (next: PortalReaction) => {
    const value = shown === next ? null : next;
    const before = shown;
    setShown(value); setError("");
    try { await api.command(commandId(), { action: "react", ...target, reaction: value }); onChanged(); }
    catch (cause) { setShown(before); setError((cause as Error).message); }
  };
  return <div className={styles.reactions}>
    <ToggleButton aria-label={t("I like {name}", { name })} isSelected={shown === "like"} size="compact" variant="quiet" onPress={() => void choose("like")}>
      <ThumbsUp aria-hidden="true" size={16} /></ToggleButton>
    <ToggleButton aria-label={t("Not for me: {name}", { name })} isSelected={shown === "dislike"} size="compact" variant="quiet" onPress={() => void choose("dislike")}>
      <ThumbsDown aria-hidden="true" size={16} /></ToggleButton>
    {error ? <span className={styles.itemMeta} role="alert">{error}</span> : null}
  </div>;
}

/** The comments on a board or idea, both ways: the client's side by name, the team as "your design team". */
export function Comments({ comments, format }: { comments: PortalComment[]; format: PortalFormat }) {
  const t = useT();
  if (!comments.length) return null;
  return <ol className={styles.messages}>{comments.map((comment) => <li className={styles.message} data-mine={comment.fromClient} key={comment.id}>
    <span className={styles.muted}>{comment.mine ? t("You") : comment.fromClient ? isolate(comment.author) : t("Your design team")}</span>
    <p className={styles.body} dir="auto">{comment.text}</p>
    <span className={styles.muted}>{format.date(comment.at)}</span>
  </li>)}</ol>;
}

/** Write a comment on a board or idea; the design team hears it. */
export function CommentBox({ target, api, onSent }: { target: Target; api: PortalApi; onSent: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id, setId] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "board_comment", ...target, text: text.trim() }); setText(""); setId(commandId()); onSent(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <TextAreaField label={t("Comment")} value={text} onChange={setText} maxLength={2000} />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button></div>
  </Form>;
}
