"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, CheckCheck, Clock3, FileText, ImageIcon, Info, MessageCircle, Plus, RefreshCw, Send, Video } from "lucide-react";
import { SampleInbox } from "./sample-inbox";
import { MessagingMark } from "@/components/brand/messaging-mark";
import { ProviderMark } from "@/components/brand/provider-mark";
import { Globe2 } from "lucide-react";
import { Avatar, Button, Callout, ControlledModalDialog, IconButton, InspectorSheet, SearchInput, SegmentedControl, SelectField, TextInput, ToggleButton, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, label, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell, useCrmTime } from "./crm-product-shell";
import { submitChatOnEnter } from "./chat-composer";
import styles from "./crm-inbox.module.css";

type ChatPage = { data: RecordData[]; nextCursor: string | null };
const timeout = () => AbortSignal.timeout(20_000);
export function CrmInbox({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const t = useT();
  const time = useCrmTime();
  const { locale, timeZone } = useDesignSystem();
  const [sample, setSample] = useState(false);
  const [channelFilter, setChannelFilter] = useState("all");
  const [items, setItems] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [selected, setSelected] = useState<string | null>(initialRecordId ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const requestPending = useRef(false), controller = useRef<AbortController | null>(null), cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const query = new URLSearchParams({ limit: "100", ...(channelFilter !== "all" ? { channel: channelFilter } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(filter === "unread" ? { unread: "true" } : filter === "closed" ? { status: "closed" } : {}) }).toString();
  const reload = useCallback(async (more = false, background = false) => {
    if (background && requestPending.current) return;
    requestPending.current = true;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    if (!background) setBusy(true);
    try {
      const result = await crmRequest<ChatPage>(initialData.workspaceId, `conversations?${query}${more && cursorRef.current ? `&cursor=${encodeURIComponent(cursorRef.current)}` : ""}`, "GET", undefined, AbortSignal.any([request.signal, timeout()]));
      if (request.signal.aborted) return;
      setItems((old) => more ? [...old, ...result.data.filter((row) => !old.some((item) => item.id === row.id))] : result.data);
      setCursor(result.nextCursor); setFailure("");
    } catch (error) { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : t("Chats could not be loaded.")); }
    finally { if (controller.current === request) requestPending.current = false; if (!request.signal.aborted) setBusy(false); }
  }, [initialData.workspaceId, query, t]);
  useEffect(() => {
    if (!initialData.canView) return;
    const timer = setTimeout(() => void reload(), 250);
    const poll = setInterval(() => { if (document.visibilityState === "visible" && !cursorRef.current) void reload(false, true); }, 8_000);
    return () => { clearTimeout(timer); clearInterval(poll); controller.current?.abort(); };
  }, [reload, initialData.canView]);
  return <CrmProductShell title={t("Inbox")} description={t("Customer conversations")} canView={initialData.canView} compact useWorkspaceColors>
    {sample ? <SampleInbox onClose={() => setSample(false)} /> : <div className={styles.inbox} data-selected={Boolean(selected)}>
      <section aria-label={t("Customer conversations")} className={styles.threadList}>
        <header className={styles.listHeading}><h1>{t("Inbox")}</h1><div className={styles.actions}><IconButton aria-label={t("Refresh inbox")} size="compact" isLoading={busy} onPress={() => void reload()}><RefreshCw size={16} /></IconButton><IconButton aria-label={t("New conversation")} className={styles.brandButton} variant="primary" size="compact" onPress={() => setCreating(true)}><Plus size={19} /></IconButton></div></header>
        <div className={styles.searchArea}><SearchInput label={t("Search inbox")} placeholder={t("Search conversations")} value={search} maxLength={200} onChange={setSearch} /></div>
        <div className={styles.channels} aria-label={t("Conversation channels")}>{["all", "whatsapp", "portal"].map(channel => <button key={channel} aria-pressed={channelFilter === channel} onClick={() => setChannelFilter(channel)}>{channel === "whatsapp" ? <span className={styles.channelMark}><ProviderMark provider="whatsapp" /></span> : channel === "portal" ? <Globe2 size={15} /> : null}{channel === "all" ? t("All") : channel === "portal" ? t("Client portal") : "WhatsApp"}</button>)}</div>
        <div className={styles.filters}><SegmentedControl label={t("Inbox filters")} options={[{ id: "all", label: t("All") }, { id: "unread", label: t("Unread") }, { id: "closed", label: t("Resolved") }]} value={filter} onChange={setFilter} /></div>
        {failure ? <p className={styles.error} role="alert">{failure} <Button size="compact" variant="quiet" onPress={() => void reload()}>{t("Retry")}</Button></p> : null}
        <div aria-busy={busy} className={styles.threadItems}>{items.map((item) => <ToggleButton key={item.id} className={styles.threadItem} isSelected={selected === item.id} onPress={() => setSelected(item.id)} variant="quiet">
          <Avatar name={String(item.partyName ?? t("Customer"))} size="md" />
          <span className={styles.threadCopy}><span className={styles.threadTop}><strong>{String(item.partyName ?? t("Customer"))}</strong><time dateTime={String(item.lastMessageAt ?? "")} title={item.lastMessageAt ? time(item.lastMessageAt) : t("New conversation")}>{inboxDate(item.lastMessageAt, locale, timeZone, t("New"))}</time></span><span className={styles.threadBottom}><span className={styles.preview}>{item.lastMessageDirection === "outbound" ? <DeliveryState status={String(item.lastMessageStatus)} compact /> : null}{String(item.lastMessageText ?? item.subject ?? t("No messages yet"))}</span>{Number(item.unreadCount) > 0 ? <span className={styles.unread} aria-label={t("{count} unread messages", { count: Number(item.unreadCount) })}>{String(item.unreadCount)}</span> : <small>{label(item.channel)}</small>}</span></span>
        </ToggleButton>)}{!items.length && !busy ? <div className={styles.empty}><MessagingMark size={36} /><p>{search || filter !== "all" ? t("No matching conversations.") : t("Customer conversations will appear here.")}</p></div> : null}</div>
        {cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more chats")}</Button> : null}
      </section>
      {selected ? <ConversationThread key={`${initialData.workspaceId}/${selected}`} workspaceId={initialData.workspaceId} id={selected} draft={drafts[selected] ?? ""} onDraftChange={(value) => setDrafts((old) => ({ ...old, [selected]: value }))} onBack={() => setSelected(null)} onChanged={() => reload(false, true)} /> : <section className={styles.empty} aria-label={t("Conversation messages")}><span className={styles.emptyMark}><MessagingMark size={48} /></span><h2>{t("Your conversations, together")}</h2><p>{t("Select a chat or start a conversation with a client.")}</p><Button size="compact" variant="primary" className={styles.brandButton} onPress={() => setCreating(true)}><Plus size={16} />{t("New conversation")}</Button><Button size="compact" variant="quiet" onPress={() => setSample(true)}>{t("Explore sample chats")}</Button></section>}
    </div>}
    {creating ? <NewChat workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); setSelected(id); void reload(); }} /> : null}
  </CrmProductShell>;
}

function ConversationThread({ workspaceId, id, draft, onDraftChange, onBack, onChanged }: { workspaceId: string; id: string; draft: string; onDraftChange: (value: string) => void; onBack: () => void; onChanged: () => Promise<void> }) {
  const t = useT();
  const { thread, failure: loadFailure, refresh } = useLiveConversation(workspaceId, id);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const saving = useRef(false), attempt = useRef<{ text: string; id: string } | null>(null), input = useRef<HTMLTextAreaElement>(null);
  const readVersion = useRef<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!thread || !Number(thread.unreadCount) || document.visibilityState !== "visible") return;
    const key = `${thread.version}/${thread.unreadCount}`;
    if (readVersion.current === key) return;
    readVersion.current = key;
    void crmRequest(workspaceId, `conversations/${id}/read`, "POST", {}, timeout()).then(() => { void refresh(); void onChanged(); }).catch(() => { readVersion.current = null; });
  }, [thread, workspaceId, id, refresh, onChanged]);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${Math.min(input.current.scrollHeight, 112)}px`; } }, [draft, thread?.id]);
  const inboundAt = Date.parse(String(thread?.lastInboundAt ?? ""));
  const windowOpen = Number.isFinite(inboundAt) && now - inboundAt >= -300000 && now - inboundAt < 86400000;
  const isWhatsApp = thread?.channel === "whatsapp";
  const blocked = !thread?.canSend ? t("You can view this conversation. Ask an administrator for permission to reply.") : thread?.status !== "open" ? t("This conversation is resolved. Reopen it to reply.") : isWhatsApp && !thread.whatsappConnected ? t("Connect WhatsApp in Integrations to reply.") : isWhatsApp && !windowOpen ? t("Waiting for a message from this contact. WhatsApp allows replies within 24 hours of their last message.") : "";
  if (!thread) return <section className={styles.empty}><IconButton aria-label={t("Back to chats")} onPress={onBack}><ArrowLeft size={18} /></IconButton>{loadFailure ? <><p role="alert">{loadFailure}</p><Button onPress={() => void refresh()}>{t("Retry")}</Button></> : <p role="status">{t("Loading chat…")}</p>}</section>;
  return <div className={styles.conversation}><section aria-label={t("Chat messages")} className={styles.thread}>
    <header className={styles.threadHeading}><IconButton aria-label={t("Back to inbox")} className={styles.mobileBack} size="compact" onPress={onBack}><ArrowLeft size={18} /></IconButton><Avatar name={String(thread.partyName ?? t("Customer"))} size="md" /><div className={styles.headingIdentity}><h2>{String(thread.partyName ?? t("Customer"))}</h2><span>{thread.leadId ? <Link href={`/workspace/crm/leads?lead=${thread.leadId}`}>{t("View enquiry")}</Link> : label(thread.channel)}</span></div><div className={styles.actions}><IconButton aria-label={t("Contact details")} className={styles.detailsToggle} size="compact" onPress={() => setDetailsOpen(true)}><Info size={16}/></IconButton><IconButton aria-label={t("Refresh conversation")} size="compact" onPress={() => void refresh()}><RefreshCw size={16} /></IconButton>{thread.canSend ? <Button size="compact" isDisabled={busy} onPress={async () => { if (saving.current) return; saving.current = true; setBusy(true); setFailure(""); try { await crmRequest(workspaceId, `conversations/${id}`, "PATCH", { version: thread.version, status: thread.status === "closed" ? "open" : "closed" }, timeout()); await refresh(); await onChanged(); } catch (error) { setFailure((error as Error).message); } finally { saving.current = false; setBusy(false); } }}>{thread.status === "closed" ? t("Reopen") : t("Resolve")}</Button> : null}</div></header>
    {loadFailure ? <p className={styles.error} role="alert">{loadFailure} <Button size="compact" variant="quiet" onPress={() => void refresh()}>{t("Retry")}</Button></p> : null}
    <MessageHistory workspaceId={workspaceId} thread={thread} />
    <form className={styles.composer} aria-busy={busy} onSubmit={async (event) => {
      event.preventDefault(); if (saving.current || blocked || !draft.trim()) return;
      const text = draft.trim(); if (attempt.current?.text !== text) attempt.current = { text, id: crypto.randomUUID() };
      saving.current = true; setBusy(true); setFailure(""); setNotice("");
      try {
        await crmRequest(workspaceId, `conversations/${id}/messages`, "POST", { direction: thread.channel === "internal" ? "internal" : "outbound", ...(thread.channel === "internal" ? {} : { purpose: "service" }), bodyText: text, clientMessageId: attempt.current.id }, timeout());
        onDraftChange(""); attempt.current = null; setNotice(t("Message queued"));
        await refresh(); await onChanged();
      } catch (error) { setFailure(error instanceof Error ? error.message : t("Message could not be sent. Your draft is saved.")); }
      finally { saving.current = false; setBusy(false); input.current?.focus(); }
    }}>
      {blocked ? <p className={styles.composerNotice}>{blocked}</p> : null}
      <div className={styles.composerInput}><label className="wd-visually-hidden" htmlFor={`message-${id}`}>{t("Message")}</label><textarea ref={input} rows={1} id={`message-${id}`} placeholder={t("Type a message")} value={draft} onChange={(e) => { onDraftChange(e.target.value); setNotice(""); }} onKeyDown={submitChatOnEnter} maxLength={4096} readOnly={busy || !thread.canSend} aria-describedby={`message-help-${id}`} /><Button className={styles.sendButton} aria-label={t("Send message")} variant="primary" type="submit" isDisabled={!draft.trim() || Boolean(blocked)} isLoading={busy}><Send size={19} /></Button></div>
      <div className={styles.composerFooter} id={`message-help-${id}`}><span role="status">{notice}</span><small>{t("Enter to send · Shift+Enter for a new line")}</small></div>
      {failure ? <p className={styles.error} role="alert">{failure}</p> : null}
    </form>
  </section>
    {detailsOpen ? <InspectorSheet isOpen title={t("Contact details")} onOpenChange={setDetailsOpen} size="sm"><ChatContactDetails thread={thread}/></InspectorSheet> : null}
  </div>;
}

function ChatContactDetails({ thread }: { thread: RecordData }) {
  const t = useT();
  const time = useCrmTime();
  const name = String(thread.partyName ?? t("Customer"));
  return <div className={styles.contactDetails}>
    <header><Avatar name={name} size="lg"/><h2>{name}</h2><span>{label(thread.channel)}</span></header>
    <dl>
      <div><dt>{t("Status")}</dt><dd><span className={styles.contactStatus} data-closed={thread.status === "closed"}>{thread.status === "closed" ? t("Resolved") : t("Open")}</span></dd></div>
      <div><dt>{t("Sales owner")}</dt><dd>{String(thread.ownerName ?? t("Unassigned"))}</dd></div>
      {thread.lastMessageAt ? <div><dt>{t("Last message")}</dt><dd>{time(thread.lastMessageAt)}</dd></div> : null}
    </dl>
    {thread.leadId ? <Link href={`/workspace/crm/leads?lead=${thread.leadId}`}>{t("View enquiry")} <span aria-hidden="true">↗</span></Link> : null}
  </div>;
}

function useLiveConversation(workspaceId: string, id: string) {
  const t = useT();
  const [thread, setThread] = useState<RecordData | null>(null), [failure, setFailure] = useState("");
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  const refresh = useCallback(async (background = false) => {
    if (background && pending.current) return;
    pending.current = true;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try { const data = await crmRequest(workspaceId, `conversations/${id}`, "GET", undefined, AbortSignal.any([request.signal, timeout()])); if (!request.signal.aborted) { setThread(data); setFailure(""); } }
    catch (error) { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : t("Chat could not be refreshed.")); }
    finally { if (controller.current === request) pending.current = false; }
  }, [workspaceId, id, t]);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 5_000); return () => { clearTimeout(initial); clearInterval(timer); controller.current?.abort(); }; }, [refresh]);
  return { thread, failure, refresh };
}

function NewChat({ workspaceId, onClose, onOpened }: { workspaceId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const t = useT();
  const [search, setSearch] = useState(""), [contacts, setContacts] = useState<RecordData[]>([]), [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"email" | "whatsapp" | "portal">("whatsapp");
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => {
      setLoading(true);
      void crmRequest<ChatPage>(workspaceId, `parties?limit=50&search=${encodeURIComponent(search.trim())}`, "GET", undefined, AbortSignal.any([controller.signal, timeout()]))
        .then((data) => { if (!controller.signal.aborted) { setContacts(rows(data).filter((contact) => contact.status === "active")); setFailure(""); } })
        .catch((error) => { if (!controller.signal.aborted) setFailure(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, search]);
  return <ControlledModalDialog title={t("New conversation")} description={t("Choose the customer and channel. An enquiry is not required.")} isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <div className={styles.newChat}>
      <SelectField label={t("Channel")} items={[{ id: "whatsapp", label: "WhatsApp" }, { id: "portal", label: t("Client portal") }, { id: "email", label: t("Email") }]} selectedKey={channel} onSelectionChange={(key) => key && setChannel(String(key) as "email" | "whatsapp" | "portal")} />
      {channel === "portal" ? <Callout title={t("Client portal")}><p>{t("Preview portal conversations in the sample Inbox. Starting a live portal chat is not available yet.")}</p><Link href="/workspace/settings/client-portal">{t("Open client portal settings")}</Link></Callout> : <>
      <TextInput label={t("Search customers")} value={search} onChange={setSearch} placeholder={channel === "whatsapp" ? t("Name or phone number") : t("Name or email")} />
      {failure ? <Callout title={t("Could not open conversation")} tone="warning">{failure}</Callout> : null}
      {loading ? <Skeleton lines={6} /> : !contacts.length ? <p>{t("No matching customers.")}</p> : <div className={styles.contacts}>{contacts.map((contact) => <Button className={styles.contactItem} key={contact.id} variant="quiet" isDisabled={busy} onPress={async () => { if (saving.current) return; saving.current = true; setBusy(true); setFailure(""); try { const result = await crmRequest(workspaceId, "conversations", "POST", { channel, partyId: contact.id }, timeout()); onOpened(result.id); } catch (error) { setFailure((error as Error).message); saving.current = false; setBusy(false); } }}><Avatar name={String(contact.displayName)} size="sm" /><span>{String(contact.displayName)}</span><MessageCircle size={16} /></Button>)}</div>}
      </>}
      <small>{t("Only connected channels can deliver outbound messages. Incoming provider messages appear automatically.")}</small>
    </div>
  </ControlledModalDialog>;
}

function MessageHistory({ workspaceId, thread }: { workspaceId: string; thread: RecordData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const dateOf = (value: unknown) => inboxDate(value, locale, timeZone, t("New"));
  const scroller = useRef<HTMLDivElement>(null), olderAnchor = useRef<{ height: number; top: number } | null>(null), stayAtBottom = useRef(true);
  const [olderMessages, setOlderMessages] = useState<RecordData[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const cursor = olderCursor ?? String(thread.nextMessagesCursor ?? '');
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const messages = useMemo(() => {
    const incoming = (thread.messages ?? []) as RecordData[];
    return [...olderMessages.filter(item => !incoming.some(next => next.id === item.id)), ...incoming].sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  }, [olderMessages, thread.messages]);
  useLayoutEffect(() => { const element = scroller.current; if (!element) return; const anchor = olderAnchor.current; if (anchor) element.scrollTop = anchor.top + element.scrollHeight - anchor.height; else if (stayAtBottom.current) element.scrollTop = element.scrollHeight; olderAnchor.current = null; }, [messages]);
  const visible = thread.channel === "whatsapp" ? messages.filter((message) => message.direction !== "internal") : messages;
  return <div className={styles.messages} ref={scroller} tabIndex={0} role="log" aria-label={t("Message history")} onScroll={() => { const el = scroller.current; if (el) stayAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
    {cursor ? <Button size="compact" isLoading={busy} onPress={async () => { setBusy(true); setFailure(""); try { const result = await crmRequest<ChatPage>(workspaceId, `conversations/${thread.id}/messages?limit=100&cursor=${encodeURIComponent(cursor)}`, "GET", undefined, timeout()); if (scroller.current) olderAnchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop }; setOlderMessages((old) => [...result.data.filter((item) => !old.some((value) => value.id === item.id)), ...old]); setOlderCursor(result.nextCursor ?? ""); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } }}>{t("Load earlier messages")}</Button> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    {visible.map((message, index) => <Fragment key={message.id}>{dateOf(message.createdAt) !== dateOf(visible[index - 1]?.createdAt) ? <div className={styles.dateDivider}><span>{dateOf(message.createdAt)}</span></div> : null}<article className={styles.message} data-direction={message.direction} aria-label={message.direction === "inbound" ? t("Contact message") : t("Your message")}><span className={styles.messageAvatar}><Avatar name={message.direction === "inbound" ? String(thread.partyName ?? t("Contact")) : t("You")} size="sm" /></span><strong className={styles.messageSender}>{message.direction === "inbound" ? String(thread.partyName ?? t("Contact")) : t("You")}</strong><MessageContent message={message} workspaceId={workspaceId} /><footer><time dateTime={String(message.createdAt)}>{inboxTime(message.createdAt, locale, timeZone)}</time>{message.direction === "outbound" ? <DeliveryState status={String(message.status)} /> : null}</footer>{message.failureCode ? <small className={styles.error}>{String(message.failureCode)}</small> : null}</article></Fragment>)}
    {!visible.length ? <div className={styles.empty}><MessageCircle size={30} /><p>{t("No messages yet.")}</p></div> : null}
  </div>;
}
function DeliveryState({ status, compact = false }: { status: string; compact?: boolean }) {
  const t = useT();
  return <span className={styles.delivery} data-status={status} aria-label={label(status)} title={label(status)}>{status === "read" || status === "delivered" ? <CheckCheck size={15} /> : status === "sent" ? <Check size={15} /> : status === "failed" ? <span>!</span> : <Clock3 size={13} />}{!compact && status === "failed" ? t("Failed") : null}</span>;
}
function MessageContent({ message, workspaceId }: { message: RecordData; workspaceId: string }) {
  const t = useT();
  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
  const kind = String(metadata.messageType ?? "");
  const connectionId = String(metadata.connectionId ?? "");
  const mediaId = String(metadata.mediaId ?? "");
  const mediaUrl = connectionId && mediaId ? `/api/workspace/integration-connections/${connectionId}/media/${mediaId}?workspaceId=${workspaceId}` : "";
  return <>{kind === "image" && mediaUrl ? <a className={styles.mediaPreview} href={mediaUrl} target="_blank" rel="noreferrer"><Image src={mediaUrl} alt={String(message.bodyText ?? t("WhatsApp image"))} width={360} height={260} unoptimized /><span><ImageIcon size={13} /> {t("Open image")}</span></a> : kind && kind !== "text" ? <a className={styles.mediaFile} href={mediaUrl || undefined} target={mediaUrl ? "_blank" : undefined} rel={mediaUrl ? "noreferrer" : undefined} aria-disabled={!mediaUrl}>{kind === "video" ? <Video size={16} /> : <FileText size={16} />}<span>{String(metadata.fileName ?? t("{kind} attachment", { kind: label(kind) }))}</span></a> : null}<p>{String(message.bodyText ?? t("This message has no plain-text preview."))}</p></>;
}

function inboxDate(value: unknown, locale: string, timeZone: string, empty: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : empty;
}
function inboxTime(value: unknown, locale: string, timeZone: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
}
