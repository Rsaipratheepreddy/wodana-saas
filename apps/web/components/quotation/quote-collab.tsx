"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { Avatar, IconButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import type { QuoteAnchor, QuotePerson, QuoteThread } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

type Api = ReturnType<typeof quoteApi>;
type Member = { id: string; name: string };

/**
 * Presence: every few seconds the builder says which line it's on and learns who else is here, and
 * whether the quote or its comments changed (then it reloads them). Stops while the tab is hidden.
 */
export function usePulse(api: Api, focus: { current: { lineId: string | null; field: string | null } }, handlers: { revision: number; onRevision: () => void; onComments: () => void }) {
  const [people, setPeople] = useState<QuotePerson[]>([]);
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; }, [handlers]);
  useEffect(() => {
    let alive = true, comments = "";
    const beat = async () => {
      if (document.hidden) return;
      try {
        const result = await api.pulse(focus.current.lineId, focus.current.field);
        if (!alive) return;
        setPeople(Array.isArray(result.people) ? result.people : []);
        if (typeof result.revision === "number" && result.revision !== latest.current.revision) latest.current.onRevision();
        if (comments && result.comments !== comments) latest.current.onComments();
        comments = result.comments;
      } catch { /* presence is best effort */ }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [api, focus]);
  return people;
}

export function PeopleHere({ people }: { people: QuotePerson[] }) {
  const t = useT();
  if (!people.length) return null;
  return <span className={styles.people} aria-label={t("Also here: {names}", { names: people.map((person) => person.name).join(", ") })}>
    {people.slice(0, 4).map((person) => <span key={person.userId} title={person.name}><Avatar name={person.name} size="sm" /></span>)}
    {people.length > 4 ? <small>+{people.length - 4}</small> : null}
  </span>;
}

export const anchorKey = (anchor: QuoteAnchor) => `${anchor.kind}:${anchor.key}`;
export const threadsAt = (threads: QuoteThread[], anchor: QuoteAnchor) => threads.filter((thread) => thread.anchorKind === anchor.kind && thread.anchorKey === anchor.key);

/** The comment bubble on a line, group or the totals: shows the open count and opens the threads there. */
export function CommentButton({ threads, label, onOpen }: { threads: QuoteThread[]; label: string; onOpen: () => void }) {
  const open = threads.filter((thread) => thread.status === "open").length;
  return <button type="button" className={styles.commentButton} data-has={open || undefined} aria-label={label} onClick={onOpen}>
    <MessageCircle aria-hidden="true" size={13} />{open ? <span>{open}</span> : null}
  </button>;
}

/** The threads pinned to one place, with a composer for a new comment (Figma-style). */
export function CommentPanel({ anchor, title, threads, members, api, meId, onThreads, onClose, onError }: {
  anchor: QuoteAnchor; title: string; threads: QuoteThread[]; members: Member[]; api: Api; meId: string | null;
  onThreads: (threads: QuoteThread[]) => void; onClose: () => void; onError: (message: string) => void;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [showResolved, setShowResolved] = useState(false);
  const here = threadsAt(threads, anchor).filter((thread) => showResolved || thread.status === "open");
  const resolvedCount = threadsAt(threads, anchor).filter((thread) => thread.status === "resolved").length;
  const when = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  const run = async (work: () => Promise<{ threads: QuoteThread[] }>) => { try { onThreads((await work()).threads ?? []); return true; } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); return false; } };
  return <section className={styles.commentPanel} aria-label={t("Comments on {name}", { name: title })} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header>
      <strong>{title}</strong>
      {resolvedCount ? <button type="button" className={styles.linkButton} onClick={() => setShowResolved((value) => !value)}>{showResolved ? t("Hide resolved") : t("Resolved · {count}", { count: resolvedCount })}</button> : null}
      <IconButton aria-label={t("Close")} size="compact" variant="quiet" onPress={onClose}><X aria-hidden="true" size={14} /></IconButton>
    </header>
    {here.map((thread) => <article key={thread.id} className={styles.thread} data-resolved={thread.status === "resolved" || undefined}>
      <div className={styles.threadHead}>
        {thread.anchorField ? <small>{t("On {field}", { field: t(FIELD_LABEL[thread.anchorField] as never) })}</small> : <span />}
        <IconButton aria-label={thread.status === "open" ? t("Resolve") : t("Reopen")} size="compact" variant="quiet"
          onPress={() => void run(() => api.threadStatus(thread.id, thread.version, thread.status === "open" ? "resolved" : "open"))}>
          {thread.status === "open" ? <Check aria-hidden="true" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}
        </IconButton>
      </div>
      <ol>{thread.messages.map((message) => <li key={message.id}>
        <Avatar name={message.createdByName} size="sm" />
        <div><span className={styles.messageMeta}><strong>{message.createdByName}</strong><time dateTime={message.createdAt}>{when(message.createdAt)}</time></span><p>{message.body}</p></div>
      </li>)}</ol>
      {thread.status === "open" ? <Composer members={members} meId={meId} placeholder={t("Reply")} onSend={(body, mentions) => run(() => api.reply(thread.id, crypto.randomUUID(), body, mentions))} /> : null}
    </article>)}
    <Composer autoFocus={!here.length} members={members} meId={meId} placeholder={here.length ? t("New comment") : t("Write a comment · @ to mention")}
      onSend={(body, mentions) => run(() => api.comment(crypto.randomUUID(), anchor, body, mentions))} />
  </section>;
}

/**
 * Every conversation on the quote in one place, newest first: open ones, then (on request) resolved.
 * Opening one shows its thread; the composer at the end starts a comment on the quote as a whole.
 */
export function CommentsList({ threads, members, api, meId, titleOf, onOpen, onThreads, onError }: {
  threads: QuoteThread[]; members: Member[]; api: Api; meId: string | null; titleOf: (thread: QuoteThread) => string;
  onOpen: (thread: QuoteThread) => void; onThreads: (threads: QuoteThread[]) => void; onError: (message: string) => void;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [showResolved, setShowResolved] = useState(false);
  const last = (thread: QuoteThread) => thread.messages[thread.messages.length - 1];
  const sorted = [...threads].sort((a, b) => (last(b)?.createdAt ?? b.createdAt).localeCompare(last(a)?.createdAt ?? a.createdAt));
  const open = sorted.filter((thread) => thread.status === "open");
  const resolved = sorted.filter((thread) => thread.status === "resolved");
  const shown = showResolved ? [...open, ...resolved] : open;
  const when = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  return <div className={styles.commentList}>
    {shown.length ? <ul>{shown.map((thread) => {
      const message = last(thread);
      return <li key={thread.id}>
        <button type="button" onClick={() => onOpen(thread)} data-resolved={thread.status === "resolved" || undefined}>
          <Avatar name={message?.createdByName ?? thread.createdByName} size="sm" />
          <span>
            <strong>{titleOf(thread)}</strong>
            <span className={styles.snippet}>{message ? `${message.createdByName}: ${message.body}` : ""}</span>
            <small>{message ? when(message.createdAt) : ""}{thread.messages.length > 1 ? ` · ${t("{count} replies", { count: thread.messages.length - 1 })}` : ""}{thread.status === "resolved" ? ` · ${t("Resolved")}` : ""}</small>
          </span>
        </button>
      </li>;
    })}</ul> : <p className={styles.noComments}><MessageCircle aria-hidden="true" size={18} />{t("No comments yet")}</p>}
    {resolved.length ? <button type="button" className={styles.linkButton} onClick={() => setShowResolved((value) => !value)}>{showResolved ? t("Hide resolved") : t("Resolved · {count}", { count: resolved.length })}</button> : null}
    <Composer members={members} meId={meId} placeholder={t("Comment on the quote · @ to mention")}
      onSend={async (body, mentions) => { try { onThreads((await api.comment(crypto.randomUUID(), { kind: "total", key: "" }, body, mentions)).threads ?? []); return true; } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); return false; } }} />
  </div>;
}

const FIELD_LABEL: Record<string, string> = { title: "Item", quantity: "Qty", unit: "Unit", rate: "Rate", amount: "Amount", area: "Area", trade: "Work package" };

function Composer({ members, meId, placeholder, autoFocus, onSend }: { members: Member[]; meId: string | null; placeholder: string; autoFocus?: boolean; onSend: (body: string, mentions: string[]) => Promise<boolean> }) {
  const t = useT();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const suggestions = query ? members.filter((member) => member.id !== meId && member.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6) : [];
  const detect = (value: string, caret: number) => {
    const match = value.slice(0, caret).match(/(?:^|\s)@([^@\n]*)$/);
    setQuery(match ? { start: caret - match[1].length - 1, text: match[1] } : null); setActive(0);
  };
  const choose = (member: Member) => {
    if (!query) return;
    const caret = field.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, query.start)}@${member.name} ${body.slice(caret)}`;
    setBody(next); setQuery(null);
    requestAnimationFrame(() => { const at = query.start + member.name.length + 2; field.current?.focus(); field.current?.setSelectionRange(at, at); });
  };
  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    const mentions = members.filter((member) => text.includes(`@${member.name}`)).map((member) => member.id);
    setBusy(true);
    if (await onSend(text, mentions)) setBody("");
    setBusy(false);
  };
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <textarea ref={field} autoFocus={autoFocus} rows={2} aria-label={placeholder} placeholder={placeholder} value={body} disabled={busy} maxLength={5000}
      onChange={(event) => { setBody(event.target.value); detect(event.target.value, event.target.selectionStart); }}
      onKeyDown={(event) => {
        if (query && suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return; }
        if (query && suggestions.length && (event.key === "Enter" || event.key === "Tab")) { event.preventDefault(); choose(suggestions[active]); return; }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
    {query && suggestions.length ? <ul role="listbox" aria-label={t("Mention someone")} className={styles.mentionList}>
      {suggestions.map((member, index) => <li key={member.id} role="option" aria-selected={index === active} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(member)}><Avatar name={member.name} size="sm" />{member.name}</li>)}
    </ul> : null}
    <IconButton type="submit" aria-label={t("Send")} size="compact" variant="primary" isDisabled={!body.trim() || busy}><Send aria-hidden="true" data-directional="true" size={13} /></IconButton>
  </form>;
}
