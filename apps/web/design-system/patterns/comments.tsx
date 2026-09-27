"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Check, MessageCircle, Reply, RotateCcw, Send, SmilePlus, X } from "lucide-react";
import { Button, IconButton } from "../components/actions";
import { Avatar } from "../components/avatar";
import { Badge } from "../components/status";

export type CommentAuthor = { id: string; name: string; avatarUrl?: string };
export type CommentReply = { id: string; author: CommentAuthor; body: string; createdAt: string };
export type PointComment = {
  id: string;
  x: number;
  y: number;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  isResolved?: boolean;
  assignee?: CommentAuthor;
  reactions?: Record<string, number>;
  replies?: CommentReply[];
};

export type CommentLayerProps = {
  comments: PointComment[];
  currentUser: CommentAuthor;
  onChange: (comments: PointComment[]) => void;
  people?: CommentAuthor[];
  scopeId: string;
};

function Composer({ anchor, currentUser, onCancel, onSubmit, people = [] }: { anchor: { x: number; y: number }; currentUser: CommentAuthor; onCancel: () => void; onSubmit: (body: string) => void; people?: CommentAuthor[] }) {
  const t = useT();
  const [body, setBody] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const submit = () => { const value = body.trim(); if (value) onSubmit(value); };
  return <div className="wd-comment-composer" data-comment-ui style={{ insetInlineStart: `${Math.min(anchor.x, window.innerWidth - 330)}px`, insetBlockStart: `${Math.min(anchor.y, window.innerHeight - 230)}px` }}><header><Avatar name={currentUser.name} size="sm" /><strong>{t("New comment")}</strong><IconButton aria-label={t("Cancel comment")} onPress={onCancel} size="compact"><X size={14} /></IconButton></header><textarea aria-label={t("Comment")} autoFocus onChange={(event) => { setBody(event.target.value); setShowMentions(event.target.value.endsWith("@")); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); if (event.key === "Escape") onCancel(); }} placeholder={t("Write a comment. Type @ to mention…")} value={body} />{showMentions && people.length ? <div className="wd-mention-list">{people.map((person) => <button key={person.id} onClick={() => { setBody((value) => `${value}${person.name} `); setShowMentions(false); }} type="button"><Avatar name={person.name} size="sm" />{person.name}</button>)}</div> : null}<footer><span>{t("⌘↵ to send")}</span><Button isDisabled={!body.trim()} onPress={submit} size="compact" variant="primary"><Send size={13} />{t("Comment")}</Button></footer></div>;
}

function CommentThread({ comment, onClose, onReply, onResolve, onReact }: { comment: PointComment; onClose: () => void; onReply: (body: string) => void; onResolve: () => void; onReact: () => void }) {
  const t = useT();
  const [reply, setReply] = useState("");
  return <div className="wd-comment-thread" data-comment-ui style={{ insetInlineStart: `${Math.min(comment.x + 18, window.innerWidth - 340)}px`, insetBlockStart: `${Math.min(comment.y, window.innerHeight - 360)}px` }}><header><span><Avatar name={comment.author.name} size="sm" /><strong>{comment.author.name}</strong></span><IconButton aria-label={t("Close conversation")} onPress={onClose} size="compact"><X size={14} /></IconButton></header><div className="wd-comment-message"><p>{comment.body}</p><small>{comment.createdAt}</small></div>{comment.replies?.map((item) => <div className="wd-comment-reply" key={item.id}><Avatar name={item.author.name} size="sm" /><div><strong>{item.author.name}</strong><p>{item.body}</p><small>{item.createdAt}</small></div></div>)}<div className="wd-comment-reactions"><button onClick={onReact} type="button"><SmilePlus size={13} />{comment.reactions?.["👍"] ? `👍 ${comment.reactions["👍"]}` : t("React")}</button><button onClick={onResolve} type="button">{comment.isResolved ? <><RotateCcw size={13} />{t("Reopen")}</> : <><Check size={13} />{t("Resolve")}</>}</button></div><div className="wd-comment-reply-box"><textarea aria-label={t("Reply")} onChange={(event) => setReply(event.target.value)} placeholder={t("Reply or @mention…")} value={reply} /><Button isDisabled={!reply.trim()} onPress={() => { onReply(reply.trim()); setReply(""); }} size="compact"><Reply size={13} />{t("Reply")}</Button></div></div>;
}

export function CommentLayer({ comments, currentUser, onChange, people, scopeId }: CommentLayerProps) {
  const t = useT();
  const [mode, setMode] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visible = useMemo(() => comments.filter((comment) => !comment.isResolved), [comments]);
  useEffect(() => { const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !draftAnchor) setMode(false); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [draftAnchor]);
  const place = (event: MouseEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest("[data-comment-ui]")) return; setDraftAnchor({ x: event.clientX, y: event.clientY }); };
  const add = (body: string) => { if (!draftAnchor) return; onChange([...comments, { id: crypto.randomUUID(), x: draftAnchor.x, y: draftAnchor.y, author: currentUser, body, createdAt: new Date().toISOString(), replies: [] }]); setDraftAnchor(null); setMode(false); };
  const update = (id: string, transform: (comment: PointComment) => PointComment) => onChange(comments.map((comment) => comment.id === id ? transform(comment) : comment));
  return <><button aria-label={mode ? t("Exit comment mode") : t("Add page comment")} aria-pressed={mode} className="wd-comment-toggle" data-comment-ui data-enabled={mode || undefined} onClick={() => { setMode((value) => !value); setDraftAnchor(null); }} type="button"><MessageCircle size={18} /><span>{visible.length || ""}</span></button>{mode ? <div aria-label={t("Comment mode. Click anywhere to leave a comment.")} className="wd-comment-canvas" data-scope={scopeId} onClick={place} role="presentation" /> : null}{comments.map((comment, index) => <button aria-label={t("Open comment {number} by {name}", { number: index + 1, name: comment.author.name })} className="wd-comment-pin" data-comment-ui data-resolved={comment.isResolved || undefined} key={comment.id} onClick={() => setActiveId(comment.id)} style={{ insetInlineStart: comment.x, insetBlockStart: comment.y }} type="button">{index + 1}</button>)}{draftAnchor ? <Composer anchor={draftAnchor} currentUser={currentUser} onCancel={() => setDraftAnchor(null)} onSubmit={add} people={people} /> : null}{activeId ? (() => { const comment = comments.find((item) => item.id === activeId); return comment ? <CommentThread comment={comment} onClose={() => setActiveId(null)} onReact={() => update(comment.id, (item) => ({ ...item, reactions: { ...item.reactions, "👍": (item.reactions?.["👍"] ?? 0) + 1 } }))} onReply={(body) => update(comment.id, (item) => ({ ...item, replies: [...(item.replies ?? []), { id: crypto.randomUUID(), author: currentUser, body, createdAt: new Date().toISOString() }] }))} onResolve={() => update(comment.id, (item) => ({ ...item, isResolved: !item.isResolved }))} /> : null; })() : null}</>;
}

export function CommentSummary({ comments }: { comments: PointComment[] }) {
  const t = useT(); const open = comments.filter((comment) => !comment.isResolved).length; return <span className="wd-comment-summary"><MessageCircle size={14} /><Badge tone={open ? "info" : "neutral"}>{t("{count} open", { count: open })}</Badge></span>; }
