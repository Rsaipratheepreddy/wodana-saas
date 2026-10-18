"use client";

import { AtSign, BadgeCheck, CircleAlert, FileSignature, Send, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Button, EmptyState, InlineNotice, MenuButton, TextAreaField, formatDate, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { JobThread } from "@/lib/jobs/journey";

/** The icon an event line wears, by what happened. */
const EVENT_ICON: Record<string, ReactNode> = {
  document_sent: <Send aria-hidden="true" size={13} />, document_failed: <CircleAlert aria-hidden="true" size={13} />, document_signed: <FileSignature aria-hidden="true" size={13} />,
  payment_verified: <BadgeCheck aria-hidden="true" size={13} />, payment_reported: <Wallet aria-hidden="true" size={13} />, payment_returned: <Wallet aria-hidden="true" size={13} />,
};

/**
 * §0.3: the job's team thread, like a channel per job: the team's messages and the job's own events as lines (sent,
 * signed, paid), newest at the bottom. @mention someone on the job and they hear it in the app. Staff only; the client
 * talks to the team in their portal. Refreshes while open; opening it marks it read.
 */
export function JobThreadPanel({ workspaceId, jobId, initial, onUnread }: { workspaceId: string; jobId: string; initial: JobThread; onUnread?: (count: number) => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [thread, setThread] = useState(initial);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const url = (step = "") => `/api/workspace/jobs/${jobId}/thread${step ? `/${step}` : ""}?workspaceId=${workspaceId}`;
  const load = useCallback(async () => {
    const response = await fetch(url(), { cache: "no-store" }).catch(() => null);
    if (response?.ok) setThread(await response.json());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the url depends only on the ids
  }, [workspaceId, jobId]);
  // Open: read. While open and visible: new lines every 20 seconds.
  useEffect(() => {
    void fetch(url("read"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(() => onUnread?.(0)).catch(() => null);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per thread
  }, [load]);
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" }); }, [thread.messages.length]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError("");
    const response = await fetch(url(), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), body: text.trim(), mentions: mentions.filter((id) => text.includes(`@${thread.people.find((person) => person.membershipId === id)?.name ?? ""}`)) }) }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (response?.ok && data) { setThread(data); setText(""); setMentions([]); }
    else setError(typeof data?.message === "string" ? data.message : t("Could not save."));
    setBusy(false);
  };
  const mention = (membershipId: string) => {
    const person = thread.people.find((item) => item.membershipId === membershipId);
    if (!person) return;
    setText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${person.name} `);
    setMentions((current) => [...new Set([...current, membershipId])]);
  };
  // "@Name" for people on the job reads as a chip in the message.
  const words = (body: string) => {
    const names = thread.people.map((person) => person.name).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length) return body;
    const pattern = new RegExp(`(@(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
    return body.split(pattern).map((part, index) => part.startsWith("@") && names.includes(part.slice(1)) ? <span className="wd-thread-mention" key={index}>{part}</span> : part);
  };
  const when = (at: string) => formatDate(at, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" });
  return <section className="wd-thread" aria-label={t("Team")}>
    {thread.messages.length ? <ol className="wd-thread-list" ref={list}>{thread.messages.map((message) => message.kind === "event"
      ? <li key={message.id} className="wd-thread-event">
        <span className="wd-thread-event-icon">{EVENT_ICON[message.eventCode ?? ""] ?? <BadgeCheck aria-hidden="true" size={13} />}</span>
        <span className="wd-thread-event-text">{message.body}</span>
        <time className="wd-thread-time" dateTime={message.at}>{when(message.at)}</time>
      </li>
      : <li key={message.id} className="wd-thread-message" data-mine={message.mine || undefined}>
        <Avatar name={message.author?.name ?? ""} seed={message.author?.name ?? ""} />
        <div className="wd-thread-body">
          <div className="wd-thread-head"><strong>{message.mine ? t("You") : message.author?.name}</strong><time className="wd-thread-time" dateTime={message.at}>{when(message.at)}</time></div>
          <p className="wd-thread-text" dir="auto">{words(message.body)}</p>
        </div>
      </li>)}</ol>
      : <EmptyState illustration="empty" title={t("No messages yet")} />}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <form className="wd-thread-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}
      onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}>
      <TextAreaField label={t("Message")} value={text} onChange={setText} maxLength={4000} placeholder={t("Write a message")} />
      <div className="wd-thread-actions">
        {thread.people.length ? <MenuButton size="compact" label={<><AtSign aria-hidden="true" size={14} />{t("Mention someone")}</>}
          items={thread.people.map((person) => ({ id: person.membershipId, label: person.role ? `${person.name} · ${person.role}` : person.name }))} onAction={mention} /> : null}
        <Button type="submit" variant="primary" size="compact" isDisabled={!text.trim()} isLoading={busy}><Send aria-hidden="true" size={14} />{t("Send")}</Button>
      </div>
    </form>
  </section>;
}
