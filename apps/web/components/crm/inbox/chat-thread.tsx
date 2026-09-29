"use client";

import Image from "next/image";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Ban, Check, CheckCheck, Clock3, EyeOff, FileText, FileX, ImageIcon, Info, MessageCircle, RefreshCw, Tag, Video } from "lucide-react";
import { Avatar, Badge, Button, FormDialog, IconButton, IconMenuButton, InspectorSheet, MenuButton, useConfirmationDialog, useDesignSystem } from "@/design-system";
import { crmRequest, label, type RecordData } from "@/lib/crm/client";
import { attachmentUrl, CLIENT_EVENT_LABELS, channelName, eventLine, fileSizeText, snoozePresets, type ChatAttachment, type ChatContext, type ChatEvent, type InboxLabel, type InboxOwner, type InboxSettings, type InboxTemplate, type QuickReply } from "@/lib/crm/inbox";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { useT } from "@/lib/i18n/i18n-provider";
import { pollEvery, useLiveInvalidate } from "@/lib/workspace/live-events";
import { CrmDateTimeField } from "../crm-date-time-field";
import { ChatContextPanel } from "./chat-context";
import { InboxComposer } from "./inbox-composer";
import { ScheduledMessages, type ScheduledMessage } from "./scheduled-messages";
import { useWoddy, useWoddyComposer, useWoddyRecord } from "../woddy-chat";
import { useWoddyPrivateAsk, WoddyPrivateReplies } from "@/components/woddy/woddy-private-replies";
import { LabelChip, useNow } from "./inbox-parts";
import styles from "../crm-inbox.module.css";
import { SaveToProject } from "./save-to-project";

type ChatPage = { data: RecordData[]; nextCursor: string | null };
const timeout = () => AbortSignal.timeout(20_000);

export type ThreadLookups = { labels: InboxLabel[]; owners: InboxOwner[]; quickReplies: QuickReply[]; templates: InboxTemplate[]; settings: InboxSettings | null; membershipId: string | null };

/**
 * One chat: who owns it, its state (Open, Snoozed, Resolved) and labels in the header, the messages with the
 * chat's own history between them, and the composer. `onDone` opens the next chat after Resolve or Snooze.
 */
export function ConversationThread({ workspaceId, id, draft, onDraftChange, onBack, onChanged, onDone, lookups, registerActions }: {
  workspaceId: string; id: string; draft: string; onDraftChange: (value: string) => void; onBack: () => void;
  onChanged: () => Promise<void>; onDone: () => void; lookups: ThreadLookups;
  /** The list's keyboard shortcuts act on the open chat through these. */
  registerActions?: (actions: { resolve: () => void } | null) => void;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const now = useNow(15_000);
  const { thread, failure: loadFailure, refresh } = useLiveConversation(workspaceId, id);
  // Woddy: this chat is its context, the chats picked in the list are "these", and a reply it drafts goes
  // into this reply box (W-3). "@Woddy …" in the reply box is answered here, privately.
  useWoddyRecord("conversation", id, String(thread?.partyName ?? t("Chat")));
  useWoddyComposer(id, onDraftChange);
  const picked = useWoddy()?.selection ?? null;
  const woddy = useWoddyPrivateAsk(workspaceId, { surface: "inbox", context: { type: "conversation", id }, selection: picked?.type === "conversation" ? picked : null }, onDraftChange);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customSnooze, setCustomSnooze] = useState(false);
  const saving = useRef(false), readVersion = useRef<string | null>(null);
  const loadContext = useCallback(async () => {
    try { setContext(await crmRequest<ChatContext>(workspaceId, `conversations/${id}/context`, "GET", undefined, timeout())); } catch { setContext((current) => current ?? { conversationId: id, leadId: null, party: null, enquiries: null, opportunities: null, projects: null, variables: {} }); }
  }, [workspaceId, id]);
  useEffect(() => { const timer = setTimeout(() => void loadContext(), 0); return () => clearTimeout(timer); }, [loadContext]);
  useEffect(() => {
    if (!thread || !Number(thread.unreadCount) || document.visibilityState !== "visible") return;
    const key = `${thread.version}/${thread.unreadCount}`;
    if (readVersion.current === key) return;
    readVersion.current = key;
    void crmRequest(workspaceId, `conversations/${id}/read`, "POST", {}, timeout()).then(() => { void refresh(); void onChanged(); }).catch(() => { readVersion.current = null; });
  }, [thread, workspaceId, id, refresh, onChanged]);

  const change = useCallback(async (body: Record<string, unknown>, done = false) => {
    if (saving.current || !thread) return;
    saving.current = true; setBusy(true); setFailure("");
    try { await crmRequest(workspaceId, `conversations/${id}`, "PATCH", { version: thread.version, ...body }, timeout()); await refresh(); await onChanged(); if (done) onDone(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The chat could not be updated.")); }
    finally { saving.current = false; setBusy(false); }
  }, [thread, workspaceId, id, refresh, onChanged, onDone, t]);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const command = useCallback(async (path: string, body: Record<string, unknown>, fallback: string) => {
    setBusy(true); setFailure("");
    try { await crmRequest(workspaceId, path, "PUT", body, timeout()); await refresh(); await onChanged(); }
    catch (error) { setFailure(error instanceof Error ? error.message : fallback); }
    finally { setBusy(false); }
  }, [workspaceId, refresh, onChanged]);
  const block = (blocked: boolean, spam = false) => blocked
    ? requestConfirmation({ title: spam ? t("Mark as spam and block?") : t("Block this number?"), confirmLabel: spam ? t("Mark as spam") : t("Block number"),
      body: t("Their messages are still kept here, but nobody is told and they get no automatic messages."), onConfirm: () => void command(`conversations/${id}/block`, { blocked, spam }, t("The number could not be blocked.")) })
    : void command(`conversations/${id}/block`, { blocked: false }, t("The number could not be unblocked."));
  const hide = (messageId: string, hidden: boolean) => hidden
    ? requestConfirmation({ title: t("Hide this message?"), confirmLabel: t("Hide message"), body: t("It's hidden in Wodana only. It stays on the client's phone, and an administrator can show it again."),
      onConfirm: () => void command(`conversations/${id}/messages/${messageId}/hidden`, { hidden: true }, t("The message could not be hidden.")) })
    : void command(`conversations/${id}/messages/${messageId}/hidden`, { hidden: false }, t("The message could not be shown again."));
  const setLabels = async (labelIds: string[]) => {
    setBusy(true); setFailure("");
    try { await crmRequest(workspaceId, `conversations/${id}/labels`, "PUT", { labelIds }, timeout()); await refresh(); await onChanged(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("Labels could not be saved.")); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    registerActions?.(thread?.canSend ? { resolve: () => void change({ status: thread.status === "closed" ? "open" : "closed" }, thread.status !== "closed") } : null);
    return () => registerActions?.(null);
  }, [registerActions, thread?.canSend, thread?.status, change]);

  if (!thread) return <section className={styles.empty}><IconButton aria-label={t("Back to chats")} onPress={onBack}><ArrowLeft size={18} /></IconButton>{loadFailure ? <><p role="alert">{loadFailure}</p><Button onPress={() => void refresh()}>{t("Retry")}</Button></> : <p role="status">{t("Loading chat…")}</p>}</section>;
  const isWhatsApp = thread.channel === "whatsapp";
  const status = String(thread.status);
  const chatLabels = (thread.labels ?? []) as InboxLabel[];
  const replyingAs = thread.replyingAs as { businessName: string | null; number: string | null } | undefined;
  const blocked = !thread.canSend ? t("You can view this conversation. Ask an administrator for permission to reply.")
    : status === "closed" ? t("This conversation is resolved. Reopen it to reply.")
    : isWhatsApp && !thread.whatsappConnected ? t("Connect WhatsApp in Connections to reply.")
    : isWhatsApp && thread.numberHealth === "blocked" ? t("Meta has stopped sending from this number. Check it in Connections.") : "";
  const workday = lookups.settings?.workday;
  const presets = snoozePresets({ now: new Date(now), timeZone, dayStart: workday?.start, workingDays: workday?.days });
  const owners = lookups.owners;
  const ownerItems = [
    ...(lookups.membershipId && thread.ownerMembershipId !== lookups.membershipId ? [{ id: lookups.membershipId, label: t("Assign to me") }] : []),
    ...owners.filter((owner) => owner.id !== thread.ownerMembershipId && owner.id !== lookups.membershipId).map((owner) => ({ id: owner.id, label: owner.away ? t("{name} · away", { name: owner.displayName }) : t("{name} · {count} open", { name: owner.displayName, count: owner.openChats }) })),
    ...(thread.ownerMembershipId ? [{ id: "unassign", label: t("Unassign") }] : []),
  ];
  const activeLabels = lookups.labels.filter((item) => item.status !== "archived");
  const applied = new Set(chatLabels.map((item) => item.id));
  return <div className={styles.conversation}><section aria-label={t("Chat messages")} className={styles.thread}>
    <header className={styles.threadHeading}>
      <IconButton aria-label={t("Back to inbox")} className={styles.mobileBack} size="compact" onPress={onBack}><ArrowLeft size={18} /></IconButton>
      <Avatar name={String(thread.partyName ?? t("Customer"))} size="md" />
      <div className={styles.headingIdentity}>
        <h2>{String(thread.partyName ?? t("Customer"))}</h2>
        <span>{isWhatsApp && replyingAs?.number ? t("Replying as {business} · {number}", { business: replyingAs.businessName ?? "", number: replyingAs.number }) : channelName(thread.channel, t)}{isWhatsApp && (thread.numberHealth === "limited" || thread.numberHealth === "blocked") ? <> <Badge tone={thread.numberHealth === "blocked" ? "danger" : "warning"}>{thread.numberHealth === "blocked" ? t("Blocked by Meta") : t("Limited by Meta")}</Badge></> : null}</span>
        {chatLabels.length ? <span className={styles.headingLabels}>{chatLabels.map((item) => <LabelChip key={item.id} label={item} />)}</span> : null}
      </div>
      <div className={styles.actions}>
        {thread.canSend ? <MenuButton size="compact" label={String(thread.ownerName ?? t("Unassigned"))} items={ownerItems} onAction={(key) => void change({ ownerMembershipId: key === "unassign" ? null : key })} /> : null}
        {thread.canSend && activeLabels.length ? <IconMenuButton ariaLabel={t("Labels")} icon={<Tag aria-hidden="true" size={15} />} items={activeLabels.map((item) => ({ id: item.id, label: applied.has(item.id) ? t("Remove {label}", { label: item.name }) : item.name }))}
          onAction={(key) => void setLabels(applied.has(key) ? [...applied].filter((labelId) => labelId !== key) : [...applied, key])} /> : null}
        {thread.canSend && status !== "closed" ? <MenuButton size="compact" label={status === "snoozed" ? t("Snoozed") : t("Snooze")} items={[...presets.map((preset) => ({ id: preset.id, label: t(preset.label) })), { id: "custom", label: t("Pick a date and time…") }, ...(status === "snoozed" ? [{ id: "wake", label: t("Wake now") }] : [])]}
          onAction={(key) => { if (key === "custom") setCustomSnooze(true); else if (key === "wake") void change({ status: "open" }); else { const preset = presets.find((item) => item.id === key); if (preset) void change({ status: "snoozed", snoozedUntil: preset.until }, true); } }} /> : null}
        {thread.canSend ? <Button size="compact" variant={status === "closed" ? "secondary" : "primary"} isDisabled={busy} onPress={() => void change({ status: status === "closed" ? "open" : "closed" }, status !== "closed")}>{status === "closed" ? t("Reopen") : t("Resolve")}</Button> : null}
        <IconButton aria-label={t("Contact details")} className={styles.detailsToggle} size="compact" onPress={() => setDetailsOpen(true)}><Info size={16} /></IconButton>
        <IconButton aria-label={t("Refresh conversation")} size="compact" onPress={() => void refresh()}><RefreshCw size={16} /></IconButton>
        {thread.canSend && thread.partyId ? <IconMenuButton ariaLabel={t("More chat actions")} items={thread.blockedAt ? [{ id: "unblock", label: t("Unblock number") }]
          : [{ id: "block", label: t("Block number"), tone: "danger" }, { id: "spam", label: t("Mark as spam"), tone: "danger" }]}
          onAction={(key) => key === "unblock" ? block(false) : block(true, key === "spam")} /> : null}
      </div>
    </header>
    {loadFailure || failure ? <p className={styles.error} role="alert">{failure || loadFailure} {loadFailure ? <Button size="compact" variant="quiet" onPress={() => void refresh()}>{t("Retry")}</Button> : null}</p> : null}
    {thread.blockedAt ? <p className={styles.stateBar} data-tone="danger"><Ban aria-hidden="true" size={14} />{thread.spamAt ? t("Blocked as spam: messages are kept, nobody is told.") : t("Blocked: messages are kept, nobody is told.")}</p> : null}
    {status === "snoozed" && thread.snoozedUntil ? <p className={styles.stateBar}><Clock3 aria-hidden="true" size={14} />{t("Snoozed until {time}", { time: new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(String(thread.snoozedUntil))) })}</p> : null}
    <MessageHistory workspaceId={workspaceId} thread={thread} onHide={thread.canSend ? hide : undefined} canShowHidden={Boolean(thread.canManage)}
      revision={woddy.turns.map((turn) => `${turn.id}:${turn.state}`).join(",")}
      after={<><ScheduledMessages workspaceId={workspaceId} conversationId={id} items={(thread.scheduledMessages ?? []) as ScheduledMessage[]} canSend={Boolean(thread.canSend)}
        windowClosesAt={(thread.windowClosesAt as string | null) ?? null} onChanged={async () => { await refresh(); await onChanged(); }} />
        <WoddyPrivateReplies workspaceId={workspaceId} turns={woddy.turns} onDismiss={woddy.dismiss} draftPlaced /></>} />
    <InboxComposer workspaceId={workspaceId} thread={thread} now={now} blocked={blocked} draft={draft} onDraftChange={onDraftChange} variables={context?.variables ?? {}}
      lookups={{ quickReplies: lookups.quickReplies, templates: lookups.templates, owners, canManage: Boolean(lookups.settings?.canManage) }}
      onSent={async () => { await refresh(); await onChanged(); }} onAskWoddy={woddy.ask} woddyBusy={woddy.asking} />
  </section>
    {detailsOpen ? <InspectorSheet isOpen title={t("Contact details")} onOpenChange={setDetailsOpen} size="sm"><ChatContextPanel workspaceId={workspaceId} thread={thread} context={context} owners={owners} membershipId={lookups.membershipId} onLinked={async () => { await refresh(); await loadContext(); await onChanged(); }} /></InspectorSheet> : null}
    {customSnooze ? <CustomSnooze timeZone={timeZone} onClose={() => setCustomSnooze(false)} onSnooze={async (until) => { setCustomSnooze(false); await change({ status: "snoozed", snoozedUntil: until }, true); }} /> : null}
    {confirmationDialog}
  </div>;
}

function CustomSnooze({ timeZone, onClose, onSnooze }: { timeZone: string; onClose: () => void; onSnooze: (until: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState("");
  const submit = async () => {
    const [date, time] = value.split("T");
    const until = date && time ? zonedToUtc(date, time, timeZone) : null;
    if (!until || Date.parse(until) <= Date.now() + 60_000) throw new Error(t("Choose a time in the future"));
    await onSnooze(until);
  };
  return <FormDialog isDirty={Boolean(value)} onClose={onClose} onSubmit={submit} submitLabel={t("Snooze")} title={t("Snooze until")}>
    <CrmDateTimeField label={t("Snooze until")} value={value} onChange={setValue} isRequired />
  </FormDialog>;
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
  // A new message, receipt or change to this chat re-reads it at once; polling is the fallback.
  const live = useLiveInvalidate(workspaceId, [`conversation:${id}`], () => void refresh(true), 500);
  useEffect(() => { const initial = setTimeout(() => void refresh(), 0); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, pollEvery(live, 5_000)); return () => { clearTimeout(initial); clearInterval(timer); controller.current?.abort(); }; }, [refresh, live]);
  return { thread, failure, refresh };
}

type Entry = { kind: "message"; at: string; message: RecordData } | { kind: "event"; at: string; event: ChatEvent } | { kind: "album"; at: string; messages: RecordData[] };

const isPhoto = (message: RecordData) => message.direction === "inbound" && (message.metadata as Record<string, unknown> | null)?.messageType === "image";
/** A client's photos sent within two minutes of each other read as one album. */
function groupPhotos(entries: Entry[]): Entry[] {
  const grouped: Entry[] = [];
  for (const entry of entries) {
    const previous = grouped.at(-1);
    if (entry.kind === "message" && isPhoto(entry.message) && previous && (previous.kind === "album" || (previous.kind === "message" && isPhoto(previous.message)))) {
      const photos = previous.kind === "album" ? previous.messages : [previous.message];
      if (Date.parse(entry.at) - Date.parse(String(photos.at(-1)!.createdAt)) <= 120_000) {
        grouped[grouped.length - 1] = { kind: "album", at: previous.at, messages: [...photos, entry.message] };
        continue;
      }
    }
    grouped.push(entry);
  }
  return grouped;
}

/** Messages and the chat's own history (who resolved, snoozed, assigned or labelled it) in one timeline. */
function MessageHistory({ workspaceId, thread, onHide, canShowHidden, after, revision = "" }: {
  workspaceId: string; thread: RecordData; onHide?: (messageId: string, hidden: boolean) => void; canShowHidden: boolean;
  /** Shown after the last message (Woddy's private replies); `revision` changes when it does. */
  after?: ReactNode; revision?: string;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const dateOf = (value: unknown) => inboxDate(value, locale, timeZone, t("New"));
  const scroller = useRef<HTMLDivElement>(null), olderAnchor = useRef<{ height: number; top: number } | null>(null), stayAtBottom = useRef(true);
  const [olderMessages, setOlderMessages] = useState<RecordData[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const cursor = olderCursor ?? String(thread.nextMessagesCursor ?? "");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const entries = useMemo(() => {
    const incoming = (thread.messages ?? []) as RecordData[];
    const messages = [...olderMessages.filter((item) => !incoming.some((next) => next.id === item.id)), ...incoming];
    const events = (thread.events ?? []) as ChatEvent[];
    return groupPhotos([...messages.map((message): Entry => ({ kind: "message", at: String(message.createdAt), message })), ...events.map((event): Entry => ({ kind: "event", at: event.createdAt, event }))]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
  }, [olderMessages, thread.messages, thread.events]);
  useLayoutEffect(() => { const element = scroller.current; if (!element) return; const anchor = olderAnchor.current; if (anchor) element.scrollTop = anchor.top + element.scrollHeight - anchor.height; else if (stayAtBottom.current) element.scrollTop = element.scrollHeight; olderAnchor.current = null; }, [entries]);
  useLayoutEffect(() => { const element = scroller.current; if (element && revision) element.scrollTop = element.scrollHeight; }, [revision]);
  const partyName = String(thread.partyName ?? t("Contact"));
  return <div className={styles.messages} ref={scroller} tabIndex={0} role="log" aria-label={t("Message history")} onScroll={() => { const element = scroller.current; if (element) stayAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
    {cursor ? <Button size="compact" isLoading={busy} onPress={async () => { setBusy(true); setFailure(""); try { const result = await crmRequest<ChatPage>(workspaceId, `conversations/${thread.id}/messages?limit=100&cursor=${encodeURIComponent(cursor)}`, "GET", undefined, timeout()); if (scroller.current) olderAnchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop }; setOlderMessages((old) => [...result.data.filter((item) => !old.some((value) => value.id === item.id)), ...old]); setOlderCursor(result.nextCursor ?? ""); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } }}>{t("Load earlier messages")}</Button> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    {entries.map((entry, index) => <Fragment key={`${entry.kind}:${entry.kind === "message" ? entry.message.id : entry.kind === "album" ? entry.messages[0].id : entry.event.id}`}>
      {dateOf(entry.at) !== dateOf(entries[index - 1]?.at) ? <div className={styles.dateDivider}><span>{dateOf(entry.at)}</span></div> : null}
      {entry.kind === "event" ? <EventLine event={entry.event} time={inboxTime(entry.at, locale, timeZone)} />
        : entry.kind === "album" ? <PhotoAlbum messages={entry.messages} partyName={partyName} workspaceId={workspaceId} conversationId={String(thread.id)} time={inboxTime(entry.at, locale, timeZone)} />
        : <MessageBubble message={entry.message} partyName={partyName} workspaceId={workspaceId} conversationId={String(thread.id)} time={inboxTime(entry.at, locale, timeZone)} onHide={onHide} canShowHidden={canShowHidden} />}
    </Fragment>)}
    {!entries.length ? <div className={styles.empty}><MessageCircle size={30} /><p>{t("No messages yet.")}</p></div> : null}
    {after}
  </div>;
}

function EventLine({ event, time }: { event: ChatEvent; time: string }) {
  const t = useT();
  const line = eventLine(event);
  return <p className={styles.systemLine}><span>{t(line.key, { ...line.values, actor: line.values.actor || t("Someone") })}</span><time dateTime={event.createdAt}>{time}</time></p>;
}

function MessageBubble({ message, partyName, workspaceId, conversationId, time, onHide, canShowHidden = false }: { message: RecordData; partyName: string; workspaceId: string; conversationId: string; time: string; onHide?: (messageId: string, hidden: boolean) => void; canShowHidden?: boolean }) {
  const t = useT();
  const direction = String(message.direction);
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {};
  const automatic = typeof metadata.automatic === "string" ? metadata.automatic : null;
  const autoReply = automatic === "auto_reply";
  const sender = direction === "inbound" ? partyName : automatic ? t("Automatic") : metadata.sentFromPhone ? t("Sent from phone") : message.authorship === "automation" || message.senderType === "system" ? t("Automation") : String(message.senderName ?? t("Team"));
  return <article className={styles.message} data-direction={direction} data-automatic={automatic ? true : undefined} aria-label={direction === "inbound" ? t("Contact message") : direction === "internal" ? t("Team note") : t("Your message")}>
    <span className={styles.messageAvatar}><Avatar name={sender} size="sm" /></span>
    <strong className={styles.messageSender}>{sender}{direction === "internal" ? <span className={styles.noteTag}>{t("Note")}</span> : null}{automatic ? <span className={styles.automaticTag}>{autoReply ? t("Auto reply") : t(CLIENT_EVENT_LABELS[automatic] ?? "Client message")}</span> : null}</strong>
    {message.hiddenAt ? <p className={styles.hiddenText}>{t("Hidden by {name}", { name: String(message.hiddenByName ?? t("Someone")) })}{canShowHidden && onHide ? <> <Button size="compact" variant="quiet" onPress={() => onHide(message.id, false)}>{t("Show again")}</Button></> : null}</p>
      : <MessageContent message={message} workspaceId={workspaceId} conversationId={conversationId} />}
    {onHide && !message.hiddenAt ? <IconButton aria-label={t("Hide message")} className={styles.hideButton} size="compact" variant="quiet" onPress={() => onHide(message.id, true)}><EyeOff size={13} /></IconButton> : null}
    <footer><time dateTime={String(message.createdAt)}>{time}</time>{direction === "outbound" ? <DeliveryState status={String(message.status)} /> : null}</footer>
    {message.failureCode ? <small className={styles.error}>{t("Not delivered: {reason}", { reason: String(message.failureCode) })}</small> : null}
  </article>;
}

function PhotoAlbum({ messages, partyName, workspaceId, conversationId, time }: { messages: RecordData[]; partyName: string; workspaceId: string; conversationId: string; time: string }) {
  const t = useT();
  return <article className={styles.message} data-direction="inbound" aria-label={t("Contact message")}>
    <span className={styles.messageAvatar}><Avatar name={partyName} size="sm" /></span>
    <strong className={styles.messageSender}>{partyName}</strong>
    <p>{t("{count} photos", { count: messages.length })}</p>
    <div className={styles.album}>{messages.map((message) => {
      const file = attachmentOf(message);
      const url = file?.status === "stored" ? attachmentUrl(workspaceId, conversationId, file.id) : "";
      return url ? <a key={message.id} href={url} target="_blank" rel="noreferrer" aria-label={t("Open image")}><Image src={url} alt={String(message.bodyText ?? t("WhatsApp image"))} width={160} height={160} unoptimized /></a>
        : <span key={message.id} className={styles.mediaFile} data-state={file?.status ?? "missing"} role={file?.status === "pending" ? "status" : undefined} aria-label={file?.status === "pending" ? t("Getting the file…") : t("This file isn't available.")}>{file?.status === "pending" ? <Clock3 aria-hidden="true" size={16} /> : <ImageIcon aria-hidden="true" size={16} />}</span>;
    })}</div>
    <footer><time>{time}</time></footer>
  </article>;
}

const attachmentOf = (message: RecordData) => message.attachment && typeof message.attachment === "object" ? message.attachment as ChatAttachment : null;
/** What the provider writes when a file has no caption ("Image received") is not repeated under the file. */
const isFilePlaceholder = (text: string, fileName: string | null) => !text || text === fileName || /^(Image|Video|Document|Audio|Sticker) received$/.test(text);

/**
 * A chat file: a photo as a thumbnail that opens full size, a voice note or audio with a player, a video with its
 * player, anything else as a file chip to download. One still being fetched says so; one that is lost says why.
 */
function ChatFile({ file, url, fallbackName }: { file: ChatAttachment; url: string; fallbackName: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const name = file.fileName ?? fallbackName;
  if (file.status === "pending") return <span className={styles.mediaFile} role="status"><Clock3 aria-hidden="true" size={16} /><span>{t("Getting the file…")}</span></span>;
  if (file.status === "failed") return <span className={styles.mediaFile} data-state="failed"><FileX aria-hidden="true" size={16} /><span>{file.failureCode === "media_expired" || file.failureCode === "media_unavailable" ? t("WhatsApp no longer has this file.") : t("This file couldn't be kept.")}</span></span>;
  if (file.kind === "image" || file.kind === "sticker") return <a className={styles.mediaPreview} href={url} target="_blank" rel="noreferrer"><Image src={url} alt={name} width={360} height={260} unoptimized /><span><ImageIcon aria-hidden="true" size={13} /> {t("Open image")}</span></a>;
  if (file.kind === "audio") return <audio className={styles.mediaPlayer} controls preload="none" src={url} aria-label={name} />;
  if (file.kind === "video") return <video className={styles.mediaPlayer} data-kind="video" controls preload="metadata" src={url} aria-label={name} />;
  return <a className={styles.mediaFile} href={url} download={name}><FileText aria-hidden="true" size={16} /><span>{name}</span>{file.byteSize ? <small>{fileSizeText(file.byteSize, locale)}</small> : null}</a>;
}

/** ✓ sent (the provider accepted it), ✓✓ delivered, blue ✓✓ read; only the provider's receipts move it past sent. */
export function DeliveryState({ status, compact = false }: { status: string; compact?: boolean }) {
  const t = useT();
  const text = status === "read" ? t("Read") : status === "delivered" ? t("Delivered") : status === "sent" ? t("Sent") : status === "failed" ? t("Failed") : t("Sending");
  return <span className={styles.delivery} data-status={status} aria-label={text} title={text}>{status === "read" || status === "delivered" ? <CheckCheck size={15} /> : status === "sent" ? <Check size={15} /> : status === "failed" ? <span aria-hidden="true">!</span> : <Clock3 size={13} />}{!compact && status === "failed" ? text : null}</span>;
}

function MessageContent({ message, workspaceId, conversationId }: { message: RecordData; workspaceId: string; conversationId: string }) {
  const t = useT();
  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
  const kind = String(metadata.messageType ?? "");
  const file = attachmentOf(message);
  const media = Boolean(file) || (kind !== "" && kind !== "text");
  const fileName = typeof metadata.fileName === "string" ? metadata.fileName : null;
  const text = typeof message.bodyText === "string" ? message.bodyText : "";
  const template = metadata.template && typeof metadata.template === "object" ? metadata.template as { code?: string } : null;
  const fallbackName = t("{kind} attachment", { kind: label(file?.kind ?? kind) });
  // A client's photo or PDF can be filed into one of their projects (IN-18).
  const saveable = file && file.status === "stored" && String(message.direction) === "inbound" && ["image", "document"].includes(file.kind);
  return <>{file ? <ChatFile file={file} url={attachmentUrl(workspaceId, conversationId, file.id)} fallbackName={fallbackName} />
    : media ? <span className={styles.mediaFile} aria-disabled="true">{kind === "video" ? <Video aria-hidden="true" size={16} /> : <FileText aria-hidden="true" size={16} />}<span>{fileName ?? fallbackName}</span></span> : null}
    {!media ? <p>{text || t("This message has no plain-text preview.")}</p> : !isFilePlaceholder(text, file?.fileName ?? fileName) ? <p>{text}</p> : null}
    {template?.code ? <small className={styles.templateTag}><FileText aria-hidden="true" size={12} />{template.code}</small> : null}
    {saveable ? <SaveToProject workspaceId={workspaceId} conversationId={conversationId} attachmentId={file.id} name={file.fileName ?? fallbackName} /> : null}</>;
}

export function inboxDate(value: unknown, locale: string, timeZone: string, empty: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : empty;
}
function inboxTime(value: unknown, locale: string, timeZone: string) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";
}
