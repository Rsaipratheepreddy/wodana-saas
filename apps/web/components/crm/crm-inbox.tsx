"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, CheckCheck, Clock3, FileText, ImageIcon, Info, MessageCircle, Search, Plus, RefreshCw, Send, Video } from "lucide-react";
import { Avatar, Button, Callout, ControlledModalDialog, IconButton, InspectorSheet, TextInput } from "@/design-system";
import { crmRequest, label, rows, type RecordData } from "@/lib/crm/client";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { CrmProductShell, crmTime } from "./crm-product-shell";
import { submitChatOnEnter } from "./chat-composer";
import styles from "./crm-inbox.module.css";

type ChatPage = { data: RecordData[]; nextCursor: string | null };
const timeout = () => AbortSignal.timeout(20_000);
export function CrmInbox({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const [items, setItems] = useState(initialData.items.filter((item) => item.channel === "whatsapp"));
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [selected, setSelected] = useState<string | null>(initialRecordId ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const requestPending = useRef(false), controller = useRef<AbortController | null>(null), cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const query = new URLSearchParams({ channel: "whatsapp", limit: "100", ...(search.trim() ? { search: search.trim() } : {}), ...(filter === "unread" ? { unread: "true" } : filter === "closed" ? { status: "closed" } : {}) }).toString();
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
    } catch (error) { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : "Chats could not be loaded."); }
    finally { if (controller.current === request) requestPending.current = false; if (!request.signal.aborted) setBusy(false); }
  }, [initialData.workspaceId, query]);
  useEffect(() => {
    if (!initialData.canView) return;
    const timer = setTimeout(() => void reload(), 250);
    const poll = setInterval(() => { if (document.visibilityState === "visible" && !cursorRef.current) void reload(false, true); }, 8_000);
    return () => { clearTimeout(timer); clearInterval(poll); controller.current?.abort(); };
  }, [reload, initialData.canView]);
  return <CrmProductShell title="Inbox" description="WhatsApp conversations" canView={initialData.canView} compact useWorkspaceColors>
    <div className={styles.inbox} data-selected={Boolean(selected)}>
      <section aria-label="WhatsApp chats" className={styles.threadList}>
        <header className={styles.listHeading}><h1>Chats</h1><div className={styles.actions}><IconButton aria-label="Refresh chats" size="compact" isLoading={busy} onPress={() => void reload()}><RefreshCw size={16} /></IconButton><IconButton aria-label="New chat" className={styles.brandButton} variant="primary" size="compact" onPress={() => setCreating(true)}><Plus size={19} /></IconButton></div></header>
        <label className={styles.search}><Search size={17} /><input aria-label="Search chats" placeholder="Search chats" value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className={styles.filters} role="group" aria-label="Chat filters">{[["all", "All"], ["unread", "Unread"], ["closed", "Resolved"]].map(([id, name]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{name}</button>)}</div>
        {failure ? <p className={styles.error} role="alert">{failure} <button type="button" onClick={() => void reload()}>Retry</button></p> : null}
        <div aria-busy={busy} className={styles.threadItems}>{items.map((item) => <button key={item.id} type="button" className={styles.threadItem} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
          <Avatar name={String(item.partyName ?? "WhatsApp contact")} size="md" />
          <span className={styles.threadCopy}><span className={styles.threadTop}><strong>{String(item.partyName ?? "WhatsApp contact")}</strong><time dateTime={String(item.lastMessageAt ?? "")} title={item.lastMessageAt ? crmTime(item.lastMessageAt) : "New chat"}>{inboxDate(item.lastMessageAt)}</time></span><span className={styles.threadBottom}><span className={styles.preview}>{item.lastMessageDirection === "outbound" ? <DeliveryState status={String(item.lastMessageStatus)} compact /> : null}{String(item.lastMessageText ?? "No messages yet")}</span>{Number(item.unreadCount) > 0 ? <span className={styles.unread} aria-label={`${item.unreadCount} unread messages`}>{String(item.unreadCount)}</span> : null}</span></span>
        </button>)}{!items.length && !busy ? <div className={styles.empty}><MessageCircle size={28} /><p>{search || filter !== "all" ? "No matching chats." : "Incoming WhatsApp chats will appear here."}</p></div> : null}</div>
        {cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>Load more chats</Button> : null}
      </section>
      {selected ? <ConversationThread key={`${initialData.workspaceId}/${selected}`} workspaceId={initialData.workspaceId} id={selected} draft={drafts[selected] ?? ""} onDraftChange={(value) => setDrafts((old) => ({ ...old, [selected]: value }))} onBack={() => setSelected(null)} onChanged={() => reload(false, true)} /> : <section className={styles.empty} aria-label="Chat messages"><MessageCircle size={40} /><h2>Chats</h2><p>Select a chat to read and reply.</p></section>}
    </div>
    {creating ? <NewChat workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); setSelected(id); void reload(); }} /> : null}
  </CrmProductShell>;
}

function ConversationThread({ workspaceId, id, draft, onDraftChange, onBack, onChanged }: { workspaceId: string; id: string; draft: string; onDraftChange: (value: string) => void; onBack: () => void; onChanged: () => Promise<void> }) {
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
  const blocked = !thread?.canSend ? "You can view this chat. Ask an administrator for permission to reply." : !thread.whatsappConnected ? "Connect WhatsApp in Integrations to reply." : thread.status !== "open" ? "This chat is resolved. Reopen it to reply." : !windowOpen ? "Waiting for a message from this contact. WhatsApp allows replies within 24 hours of their last message." : "";
  if (!thread) return <section className={styles.empty}><IconButton aria-label="Back to chats" onPress={onBack}><ArrowLeft size={18} /></IconButton>{loadFailure ? <><p role="alert">{loadFailure}</p><Button onPress={() => void refresh()}>Retry</Button></> : <p role="status">Loading chat…</p>}</section>;
  if (thread.channel !== "whatsapp") return <section className={styles.empty}><p>This screen shows WhatsApp chats.</p><Button onPress={onBack}>Back to chats</Button></section>;
  return <div className={styles.conversation}><section aria-label="Chat messages" className={styles.thread}>
    <header className={styles.threadHeading}><IconButton aria-label="Back to chats" className={styles.mobileBack} size="compact" onPress={onBack}><ArrowLeft size={18} /></IconButton><Avatar name={String(thread.partyName ?? "WhatsApp contact")} size="md" /><div className={styles.headingIdentity}><h2>{String(thread.partyName ?? "WhatsApp contact")}</h2><span>{thread.leadId ? <Link href={`/workspace/crm/leads?lead=${thread.leadId}`}>View lead</Link> : "WhatsApp"}</span></div><div className={styles.actions}><IconButton aria-label="Contact details" className={styles.detailsToggle} size="compact" onPress={() => setDetailsOpen(true)}><Info size={16}/></IconButton><IconButton aria-label="Refresh chat" size="compact" onPress={() => void refresh()}><RefreshCw size={16} /></IconButton>{thread.canSend ? <Button size="compact" isDisabled={busy} onPress={async () => { if (saving.current) return; saving.current = true; setBusy(true); setFailure(""); try { await crmRequest(workspaceId, `conversations/${id}`, "PATCH", { version: thread.version, status: thread.status === "closed" ? "open" : "closed" }, timeout()); await refresh(); await onChanged(); } catch (error) { setFailure((error as Error).message); } finally { saving.current = false; setBusy(false); } }}>{thread.status === "closed" ? "Reopen" : "Resolve"}</Button> : null}</div></header>
    {loadFailure ? <p className={styles.error} role="alert">{loadFailure} <button type="button" onClick={() => void refresh()}>Retry</button></p> : null}
    <MessageHistory workspaceId={workspaceId} thread={thread} />
    <form className={styles.composer} aria-busy={busy} onSubmit={async (event) => {
      event.preventDefault(); if (saving.current || blocked || !draft.trim()) return;
      const text = draft.trim(); if (attempt.current?.text !== text) attempt.current = { text, id: crypto.randomUUID() };
      saving.current = true; setBusy(true); setFailure(""); setNotice("");
      try {
        await crmRequest(workspaceId, `conversations/${id}/messages`, "POST", { direction: "outbound", purpose: "service", bodyText: text, clientMessageId: attempt.current.id }, timeout());
        onDraftChange(""); attempt.current = null; setNotice("Message queued");
        await refresh(); await onChanged();
      } catch (error) { setFailure(error instanceof Error ? error.message : "Message could not be sent. Your draft is saved."); }
      finally { saving.current = false; setBusy(false); input.current?.focus(); }
    }}>
      {blocked ? <p className={styles.composerNotice}>{blocked}</p> : null}
      <div className={styles.composerInput}><label className="wd-visually-hidden" htmlFor={`message-${id}`}>Message</label><textarea ref={input} rows={1} id={`message-${id}`} placeholder="Type a message" value={draft} onChange={(e) => { onDraftChange(e.target.value); setNotice(""); }} onKeyDown={submitChatOnEnter} maxLength={4096} readOnly={busy || !thread.canSend} aria-describedby={`message-help-${id}`} /><Button className={styles.sendButton} aria-label="Send message" variant="primary" type="submit" isDisabled={!draft.trim() || Boolean(blocked)} isLoading={busy}><Send size={19} /></Button></div>
      <div className={styles.composerFooter} id={`message-help-${id}`}><span role="status">{notice}</span><small>Enter to send · Shift+Enter for a new line</small></div>
      {failure ? <p className={styles.error} role="alert">{failure}</p> : null}
    </form>
  </section>
    <aside className={styles.contactPanel} aria-label="Contact details"><ChatContactDetails thread={thread}/></aside>
    {detailsOpen ? <InspectorSheet isOpen title="Contact details" onOpenChange={setDetailsOpen} size="sm"><ChatContactDetails thread={thread}/></InspectorSheet> : null}
  </div>;
}

function ChatContactDetails({ thread }: { thread: RecordData }) {
  const name = String(thread.partyName ?? "WhatsApp contact");
  return <div className={styles.contactDetails}>
    <header><Avatar name={name} size="lg"/><h2>{name}</h2><span>WhatsApp</span></header>
    <dl>
      <div><dt>Status</dt><dd><span className={styles.contactStatus} data-closed={thread.status === "closed"}>{thread.status === "closed" ? "Resolved" : "Open"}</span></dd></div>
      <div><dt>Lead manager</dt><dd>{String(thread.ownerName ?? "Unassigned")}</dd></div>
      {thread.lastMessageAt ? <div><dt>Last message</dt><dd>{crmTime(thread.lastMessageAt)}</dd></div> : null}
    </dl>
    {thread.leadId ? <Link href={`/workspace/crm/leads?lead=${thread.leadId}`}>View lead <span aria-hidden="true">↗</span></Link> : null}
  </div>;
}

function useLiveConversation(workspaceId: string, id: string) {
  const [thread, setThread] = useState<RecordData | null>(null), [failure, setFailure] = useState("");
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  const refresh = useCallback(async (background = false) => {
    if (background && pending.current) return;
    pending.current = true;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try { const data = await crmRequest(workspaceId, `conversations/${id}`, "GET", undefined, AbortSignal.any([request.signal, timeout()])); if (!request.signal.aborted) { setThread(data); setFailure(""); } }
    catch (error) { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : "Chat could not be refreshed."); }
    finally { if (controller.current === request) pending.current = false; }
  }, [workspaceId, id]);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 5_000); return () => { clearTimeout(initial); clearInterval(timer); controller.current?.abort(); }; }, [refresh]);
  return { thread, failure, refresh };
}

function NewChat({ workspaceId, onClose, onOpened }: { workspaceId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const [search, setSearch] = useState(""), [contacts, setContacts] = useState<RecordData[]>([]), [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
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
  return <ControlledModalDialog title="New WhatsApp chat" description="Choose a contact. A lead is not required." isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <div className={styles.newChat}><TextInput label="Search contacts" value={search} onChange={setSearch} placeholder="Name or phone number" />{failure ? <Callout title="Could not open chat" tone="warning">{failure}</Callout> : null}{loading ? <p role="status">Loading contacts…</p> : !contacts.length ? <p>No matching contacts.</p> : <div className={styles.contacts}>{contacts.map((contact) => <button key={contact.id} type="button" disabled={busy} onClick={async () => { if (saving.current) return; saving.current = true; setBusy(true); setFailure(""); try { const result = await crmRequest(workspaceId, "conversations", "POST", { channel: "whatsapp", partyId: contact.id }, timeout()); onOpened(result.id); } catch (error) { setFailure((error as Error).message); saving.current = false; setBusy(false); } }}><Avatar name={String(contact.displayName)} size="sm" /><span>{String(contact.displayName)}</span><MessageCircle size={16} /></button>)}</div>}<small>Incoming messages from new numbers also appear here automatically.</small></div>
  </ControlledModalDialog>;
}

function MessageHistory({ workspaceId, thread }: { workspaceId: string; thread: RecordData }) {
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
  const visible = messages.filter((message) => message.direction !== "internal");
  return <div className={styles.messages} ref={scroller} tabIndex={0} role="log" aria-label="Message history" onScroll={() => { const el = scroller.current; if (el) stayAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
    {cursor ? <Button size="compact" isLoading={busy} onPress={async () => { setBusy(true); setFailure(""); try { const result = await crmRequest<ChatPage>(workspaceId, `conversations/${thread.id}/messages?limit=100&cursor=${encodeURIComponent(cursor)}`, "GET", undefined, timeout()); if (scroller.current) olderAnchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop }; setOlderMessages((old) => [...result.data.filter((item) => !old.some((value) => value.id === item.id)), ...old]); setOlderCursor(result.nextCursor ?? ""); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } }}>Load earlier messages</Button> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    {visible.map((message, index) => <Fragment key={message.id}>{inboxDate(message.createdAt) !== inboxDate(visible[index - 1]?.createdAt) ? <div className={styles.dateDivider}><span>{inboxDate(message.createdAt)}</span></div> : null}<article className={styles.message} data-direction={message.direction} aria-label={message.direction === "inbound" ? "Contact message" : "Your message"}><strong className={styles.messageSender}>{message.direction === "inbound" ? String(thread.partyName ?? "Contact") : "You"}</strong><MessageContent message={message} workspaceId={workspaceId} /><footer><time dateTime={String(message.createdAt)}>{inboxTime(message.createdAt)}</time>{message.direction === "outbound" ? <DeliveryState status={String(message.status)} /> : null}</footer>{message.failureCode ? <small className={styles.error}>{String(message.failureCode)}</small> : null}</article></Fragment>)}
    {!visible.length ? <div className={styles.empty}><MessageCircle size={30} /><p>No messages yet.</p></div> : null}
  </div>;
}
function DeliveryState({ status, compact = false }: { status: string; compact?: boolean }) {
  return <span className={styles.delivery} data-status={status} aria-label={label(status)} title={label(status)}>{status === "read" || status === "delivered" ? <CheckCheck size={15} /> : status === "sent" ? <Check size={15} /> : status === "failed" ? <span>!</span> : <Clock3 size={13} />}{!compact && status === "failed" ? "Failed" : null}</span>;
}
function MessageContent({ message, workspaceId }: { message: RecordData; workspaceId: string }) {
  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
  const kind = String(metadata.messageType ?? "");
  const connectionId = String(metadata.connectionId ?? "");
  const mediaId = String(metadata.mediaId ?? "");
  const mediaUrl = connectionId && mediaId ? `/api/workspace/integration-connections/${connectionId}/media/${mediaId}?workspaceId=${workspaceId}` : "";
  return <>{kind === "image" && mediaUrl ? <a className={styles.mediaPreview} href={mediaUrl} target="_blank" rel="noreferrer"><Image src={mediaUrl} alt={String(message.bodyText ?? "WhatsApp image")} width={360} height={260} unoptimized /><span><ImageIcon size={13} /> Open image</span></a> : kind && kind !== "text" ? <a className={styles.mediaFile} href={mediaUrl || undefined} target={mediaUrl ? "_blank" : undefined} rel={mediaUrl ? "noreferrer" : undefined} aria-disabled={!mediaUrl}>{kind === "video" ? <Video size={16} /> : <FileText size={16} />}<span>{String(metadata.fileName ?? `${label(kind)} attachment`)}</span></a> : null}<p>{String(message.bodyText ?? "This message has no plain-text preview.")}</p></>;
}

function inboxDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "New";
}
function inboxTime(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
}
