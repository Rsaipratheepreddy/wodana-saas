"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { CheckSquare, MessageCircle, Plus, RefreshCw, Settings2 } from "lucide-react";
import { MessagingMark } from "@/components/brand/messaging-mark";
import { ProviderMark } from "@/components/brand/provider-mark";
import { Avatar, Button, Callout, Checkbox, ControlledModalDialog, EmptyState, IconButton, ListTabs, MenuButton, MultiSelectField, SearchInput, SegmentedControl, SelectField, Skeleton, TextInput, ToggleButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { ENQUIRY_STAGE_LABELS, nextChatId, snoozePresets, type ChatState, type InboxLabel, type InboxOwner, type InboxSummary, type InboxView } from "@/lib/crm/inbox";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { pollEvery, useLiveInvalidate } from "@/lib/workspace/live-events";
import { CrmProductShell, useCrmTime } from "./crm-product-shell";
import { ConversationThread, DeliveryState, inboxDate } from "./inbox/chat-thread";
import { useWoddySelection } from "./woddy-chat";
import { LabelChip, useInboxLookups, useNow, WaitChip } from "./inbox/inbox-parts";
import styles from "./crm-inbox.module.css";

type ChatPage = { data: RecordData[]; nextCursor: string | null };
const LIST_SCOPES = ["conversations"] as const;
const timeout = () => AbortSignal.timeout(20_000);
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The team inbox: views (Mine, Unassigned, Team, All) with counts, Open · Snoozed · Resolved, labels, the
 * longest-waiting client first, bulk actions and keyboard moves (j/k to move, e to resolve).
 */
export function CrmInbox({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const t = useT();
  const time = useCrmTime();
  const now = useNow();
  const { locale, timeZone } = useDesignSystem();
  const workspaceId = initialData.workspaceId;
  const lookups = useInboxLookups(workspaceId);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [view, setView] = useState<InboxView>("mine");
  const viewChosen = useRef(false);
  const [state, setState] = useState<ChatState>("open");
  const [labelId, setLabelId] = useState("");
  const [team, setTeam] = useState<InboxOwner[]>([]);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [stageOptions, setStageOptions] = useState<Array<{ id: string; label: string }>>([]);
  const stageParam = [...stages].sort().join(",");
  const [channelFilter, setChannelFilter] = useState("all");
  const [items, setItems] = useState<RecordData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRecordId ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Chats picked in the list are what "these chats" means to Woddy.
  useWoddySelection("conversation", [...picked]);
  const [selecting, setSelecting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [bulkBusy, setBulkBusy] = useState(false);
  const requestPending = useRef(false), controller = useRef<AbortController | null>(null), cursorRef = useRef(cursor);
  const threadActions = useRef<{ resolve: () => void } | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const query = new URLSearchParams({ limit: "100", status: state, ...(stageParam ? { stage: stageParam } : {}), ...(view === "team" && ownerFilter ? { ownerMembershipId: ownerFilter } : view !== "all" ? { view } : {}), ...(labelId ? { labelId } : {}), ...(channelFilter !== "all" ? { channel: channelFilter } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString();
  const loadSummary = useCallback(async () => {
    const [next, people] = await Promise.all([
      crmRequest<InboxSummary>(workspaceId, `inbox/summary${stageParam ? `?stage=${encodeURIComponent(stageParam)}` : ""}`, "GET", undefined, timeout()).catch(() => null),
      view === "team" ? crmRequest<InboxOwner[]>(workspaceId, "inbox/owners", "GET", undefined, timeout()).catch(() => null) : Promise.resolve(null),
    ]);
    if (Array.isArray(people)) setTeam(people);
    if (!next) return;
    setSummary(next);
    // Sales starts on Mine; with nothing of their own and chats waiting for someone, Unassigned.
    if (!viewChosen.current) { viewChosen.current = true; if (!next.mine && next.unassigned) setView("unassigned"); }
  }, [workspaceId, view, stageParam]);
  const reload = useCallback(async (more = false, background = false) => {
    if (background && requestPending.current) return;
    requestPending.current = true;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    if (!background) setBusy(true);
    try {
      const [result] = await Promise.all([
        crmRequest<ChatPage>(workspaceId, `conversations?${query}${more && cursorRef.current ? `&cursor=${encodeURIComponent(cursorRef.current)}` : ""}`, "GET", undefined, AbortSignal.any([request.signal, timeout()])),
        more ? Promise.resolve() : loadSummary(),
      ]);
      if (request.signal.aborted) return;
      setItems((old) => more ? [...old, ...result.data.filter((row) => !old.some((item) => item.id === row.id))] : result.data);
      setCursor(result.nextCursor); setFailure(""); setLoaded(true);
    } catch (error) { if (!request.signal.aborted) setFailure(error instanceof Error ? error.message : t("Chats could not be loaded.")); }
    finally { if (controller.current === request) requestPending.current = false; if (!request.signal.aborted) setBusy(false); }
  }, [workspaceId, query, loadSummary, t]);
  // A new message or reply re-reads the list at once; polling is the fallback (a minute while live).
  const live = useLiveInvalidate(initialData.canView ? workspaceId : "", LIST_SCOPES, () => { if (!cursorRef.current) void reload(false, true); });
  useEffect(() => {
    if (!initialData.canView) return;
    const timer = setTimeout(() => void reload(), 0);
    const poll = setInterval(() => { if (document.visibilityState === "visible" && !cursorRef.current) void reload(false, true); }, pollEvery(live, 8_000));
    return () => { clearTimeout(timer); clearInterval(poll); controller.current?.abort(); };
  }, [reload, initialData.canView, live]);
  useEffect(() => { setPicked(new Set()); }, [query]);
  // What a chat can be filtered by: its enquiry, opportunity or project stage, or no record at all.
  useEffect(() => {
    void crmRequest<{ enquiry: Array<{ id: string; status: string }>; opportunity: Array<{ id: string; name: string; pipeline: string }>; project: Array<{ id: string; name: string }> }>(workspaceId, "inbox/stages").then((options) => setStageOptions([
      ...options.enquiry.map((item) => ({ id: item.id, label: t("Enquiry · {stage}", { stage: t(ENQUIRY_STAGE_LABELS[item.status] ?? "Open") }) })),
      ...options.opportunity.map((item) => ({ id: item.id, label: t("Sales · {stage}", { stage: item.name }) })),
      ...options.project.map((item) => ({ id: item.id, label: t("Project · {stage}", { stage: item.name }) })),
      { id: "none", label: t("No record") },
    ])).catch(() => setStageOptions([]));
  }, [workspaceId, t]);

  const chooseView = (next: InboxView) => { viewChosen.current = true; setView(next); setOwnerFilter(""); };
  const ids = items.map((item) => item.id);
  // After Resolve or Snooze the next chat in the list opens; the last one stays open to show its new state.
  const idsKey = ids.join(",");
  const openNext = useCallback(() => setSelected((current) => current ? nextChatId(idsKey.split(","), current) ?? current : null), [idsKey]);
  const registerActions = useCallback((actions: { resolve: () => void } | null) => { threadActions.current = actions; }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = selected ? ids.indexOf(selected) : -1;
    if (event.key === "j" || event.key === "k") {
      const next = ids[event.key === "j" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1)];
      if (next) { event.preventDefault(); setSelected(next); document.getElementById(`chat-${next}`)?.focus(); }
    } else if (event.key === "e" && threadActions.current) { event.preventDefault(); threadActions.current.resolve(); }
  };

  const bulk = async (body: Record<string, unknown>) => {
    if (!picked.size) return;
    setBulkBusy(true); setFailure("");
    try { await crmRequest(workspaceId, "inbox/bulk", "POST", { conversationIds: [...picked], ...body }, timeout()); setPicked(new Set()); await reload(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The chats could not be updated.")); }
    finally { setBulkBusy(false); }
  };
  const togglePick = (id: string, value: boolean) => setPicked((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });
  const activeLabels = lookups.labels.filter((item) => item.status !== "archived");
  const presets = snoozePresets({ now: new Date(now), timeZone, dayStart: lookups.settings?.workday.start, workingDays: lookups.settings?.workday.days });
  const filtered = Boolean(stageParam) || Boolean(search.trim()) || state !== "open" || view !== "all" || Boolean(labelId) || channelFilter !== "all";
  const noConversations = loaded && !items.length && !busy && !filtered;
  const emptyState = <EmptyState icon={<MessagingMark size={36} />} title={noConversations ? t("No conversations yet") : t("Choose a conversation")}
    action={<Button size="compact" variant="primary" className={styles.brandButton} onPress={() => setCreating(true)}><Plus aria-hidden="true" size={16} />{t("New conversation")}</Button>} />;
  const viewItems = [
    { id: "mine" as const, label: t("Mine"), count: summary?.mine },
    { id: "unassigned" as const, label: t("Unassigned"), count: summary?.unassigned },
    ...(summary?.team === null ? [] : [{ id: "team" as const, label: t("Team"), count: summary?.team ?? undefined }]),
    { id: "all" as const, label: t("All"), count: summary?.all },
  ];

  return <CrmProductShell title={t("Inbox")} description={t("Customer conversations")} canView={initialData.canView} compact useWorkspaceColors>
    <div className={styles.inbox} data-selected={Boolean(selected)} onKeyDown={onKeyDown}>
      <section aria-label={t("Customer conversations")} className={styles.threadList}>
        <header className={styles.listHeading}><h1>{t("Inbox")}</h1><div className={styles.actions}>
          <IconButton aria-label={selecting ? t("Stop selecting") : t("Select chats")} size="compact" onPress={() => { setSelecting((value) => !value); setPicked(new Set()); }}><CheckSquare size={16} /></IconButton>
          <IconButton aria-label={t("Refresh inbox")} size="compact" isLoading={busy} onPress={() => void reload()}><RefreshCw size={16} /></IconButton>
          {lookups.settings?.canManage ? <Link aria-label={t("Inbox settings")} className={styles.iconLink} href="/workspace/settings/inbox"><Settings2 aria-hidden="true" size={16} /></Link> : null}
          <IconButton aria-label={t("New conversation")} className={styles.brandButton} variant="primary" size="compact" onPress={() => setCreating(true)}><Plus size={19} /></IconButton>
        </div></header>
        <div className={styles.views}><ListTabs label={t("Inbox views")} items={viewItems} value={view} onChange={chooseView} /></div>
        {view === "team" && team.length ? <div className={styles.teamLoad} role="group" aria-label={t("Open chats per person")}>
          {team.map((person) => <button key={person.id} type="button" aria-pressed={ownerFilter === person.id} onClick={() => setOwnerFilter((current) => current === person.id ? "" : person.id)}>
            <Avatar name={person.displayName} size="sm" /><span>{person.displayName}</span><span className="wd-count-chip">{person.openChats}</span>{person.away ? <small>{t("Away")}</small> : null}
          </button>)}
        </div> : null}
        <div className={styles.searchArea}><SearchInput label={t("Search inbox")} placeholder={t("Search conversations")} value={search} maxLength={200} onChange={setSearch} /></div>
        <div className={styles.filters}>
          <SegmentedControl label={t("Chat state")} value={state} onChange={(value) => setState(value as ChatState)} options={[{ id: "open", label: t("Open") }, { id: "snoozed", label: t("Snoozed"), count: summary?.snoozed || undefined }, { id: "closed", label: t("Resolved") }]} />
          {activeLabels.length ? <SelectField accent="neutral" aria-label={t("Label")} label={null} items={[{ id: "", label: t("All labels") }, ...activeLabels.map((item) => ({ id: item.id, label: item.name }))]} selectedKey={labelId} onSelectionChange={(key) => setLabelId(key ? String(key) : "")} /> : null}
        </div>
        {stageOptions.length ? <div className={styles.stageFilter}><MultiSelectField label={t("Stage")} items={stageOptions} selectedKeys={stages} onSelectionChange={(keys) => setStages(new Set([...keys].map(String)))} /></div> : null}
        <div className={styles.channels} aria-label={t("Conversation channels")}>{["all", "whatsapp"].map((channel) => <button key={channel} type="button" aria-pressed={channelFilter === channel} onClick={() => setChannelFilter(channel)}>{channel === "whatsapp" ? <span className={styles.channelMark}><ProviderMark provider="whatsapp" /></span> : null}{channel === "all" ? t("All") : "WhatsApp"}</button>)}</div>
        {picked.size ? <div className={`wd-bulk-bar ${styles.bulkBar}`} role="toolbar" aria-label={t("Bulk actions")}>
          <strong>{t("{count} selected", { count: picked.size })}</strong>
          <div>
            <MenuButton size="compact" label={t("Assign")} items={[...(summary?.membershipId ? [{ id: summary.membershipId, label: t("Assign to me") }] : []), ...lookups.owners.filter((owner) => owner.id !== summary?.membershipId).map((owner) => ({ id: owner.id, label: owner.away ? t("{name} · away", { name: owner.displayName }) : owner.displayName })), { id: "unassign", label: t("Unassign") }]}
              onAction={(key) => void bulk({ action: "assign", ownerMembershipId: key === "unassign" ? null : key })} />
            {activeLabels.length ? <MenuButton size="compact" label={t("Label")} items={activeLabels.flatMap((item: InboxLabel) => [{ id: `add:${item.id}`, label: item.name }, { id: `remove:${item.id}`, label: t("Remove {label}", { label: item.name }) }])}
              onAction={(key) => { const [action, id] = key.split(":"); void bulk({ action: action === "add" ? "label" : "unlabel", labelId: id }); }} /> : null}
            {state !== "closed" ? <MenuButton size="compact" label={t("Snooze")} items={presets.map((preset) => ({ id: preset.id, label: t(preset.label) }))} onAction={(key) => { const preset = presets.find((item) => item.id === key); if (preset) void bulk({ action: "snooze", snoozedUntil: preset.until }); }} /> : null}
            <Button size="compact" variant="primary" isLoading={bulkBusy} onPress={() => void bulk({ action: state === "closed" ? "reopen" : "resolve" })}>{state === "closed" ? t("Reopen") : t("Resolve")}</Button>
          </div>
          <Button size="compact" variant="quiet" onPress={() => setPicked(new Set())}>{t("Clear")}</Button>
        </div> : null}
        {failure ? <p className={styles.error} role="alert">{failure} <Button size="compact" variant="quiet" onPress={() => void reload()}>{t("Retry")}</Button></p> : null}
        <div aria-busy={busy} className={styles.threadItems}>
          {!loaded && busy ? <Skeleton lines={6} /> : null}
          {items.map((item) => {
            const name = String(item.partyName ?? t("Customer"));
            const chipLabels = (item.labels ?? []) as InboxLabel[];
            return <div className={styles.threadRow} key={item.id} data-picked={picked.has(item.id) || undefined}>
              {selecting || picked.size ? <Checkbox aria-label={t("Select {name}", { name })} isSelected={picked.has(item.id)} onChange={(value) => togglePick(item.id, value)} /> : null}
              <ToggleButton id={`chat-${item.id}`} className={styles.threadItem} isSelected={selected === item.id} onPress={() => setSelected(item.id)} variant="quiet">
                <Avatar name={name} size="md" />
                <span className={styles.threadCopy}>
                  <span className={styles.threadTop}><strong>{name}</strong><time dateTime={String(item.lastMessageAt ?? "")} title={item.lastMessageAt ? time(item.lastMessageAt) : t("New conversation")}>{inboxDate(item.lastMessageAt, locale, timeZone, t("New"))}</time></span>
                  <span className={styles.threadBottom}><span className={styles.preview}>{item.lastMessageDirection === "outbound" ? <DeliveryState status={String(item.lastMessageStatus)} compact /> : null}{String(item.lastMessageText ?? item.subject ?? t("No messages yet"))}</span>{Number(item.unreadCount) > 0 ? <span className={styles.unread} aria-label={t("{count} unread messages", { count: Number(item.unreadCount) })}>{String(item.unreadCount)}</span> : null}</span>
                  <span className={styles.threadMeta}>
                    {item.status === "open" && item.waitingSince ? <WaitChip since={item.waitingSince} now={now} /> : null}
                    {item.status === "snoozed" && item.snoozedUntil ? <span className={styles.metaText}>{t("Until {time}", { time: time(item.snoozedUntil) })}</span> : null}
                    {chipLabels.slice(0, 2).map((chip) => <LabelChip key={chip.id} label={chip} />)}{chipLabels.length > 2 ? <span className={styles.metaText}>+{chipLabels.length - 2}</span> : null}
                    {view !== "mine" ? <span className={styles.metaText}>{item.ownerName ? String(item.ownerName) : t("Unassigned")}</span> : null}
                  </span>
                </span>
              </ToggleButton>
            </div>;
          })}
          {!items.length && loaded && !busy && filtered ? <div className={styles.empty}><p>{state === "open" && view === "mine" && !search.trim() ? t("Nothing waiting for you.") : t("No matching conversations.")}</p></div> : null}
          {noConversations ? <div className={styles.listEmpty}>{emptyState}</div> : null}
        </div>
        {cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more chats")}</Button> : null}
      </section>
      {selected ? <ConversationThread key={`${workspaceId}/${selected}`} workspaceId={workspaceId} id={selected} draft={drafts[selected] ?? ""}
        onDraftChange={(value) => setDrafts((old) => ({ ...old, [selected]: value }))} onBack={() => setSelected(null)} onChanged={() => reload(false, true)} onDone={openNext}
        registerActions={registerActions} lookups={{ ...lookups, membershipId: summary?.membershipId ?? null }} />
        : <section className={styles.empty} aria-label={t("Conversation messages")}>{emptyState}</section>}
    </div>
    {creating ? <NewChat workspaceId={workspaceId} onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); setSelected(id); void reload(); }} /> : null}
  </CrmProductShell>;
}

function NewChat({ workspaceId, onClose, onOpened }: { workspaceId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const t = useT();
  const [search, setSearch] = useState(""), [contacts, setContacts] = useState<RecordData[]>([]), [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"email" | "whatsapp">("whatsapp");
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => {
      setLoading(true);
      void crmRequest<ChatPage>(workspaceId, `parties?limit=50&search=${encodeURIComponent(search.trim())}`, "GET", undefined, AbortSignal.any([controller.signal, timeout()]))
        .then((data) => { if (!controller.signal.aborted) { setContacts(rows(data).filter((contact) => contact.status === "active")); setFailure(""); } })
        .catch((error) => { if (!controller.signal.aborted) setFailure(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250); return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, search]);
  return <ControlledModalDialog title={t("New conversation")} description={t("Choose the customer and channel. An enquiry is not required.")} isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <div className={styles.newChat}>
      <SelectField label={t("Channel")} items={[{ id: "whatsapp", label: "WhatsApp" }, { id: "email", label: t("Email") }]} selectedKey={channel} onSelectionChange={(key) => key && setChannel(String(key) as "email" | "whatsapp")} />
      <TextInput label={t("Search customers")} value={search} onChange={setSearch} placeholder={channel === "whatsapp" ? t("Name or phone number") : t("Name or email")} />
      {failure ? <Callout title={t("Could not open conversation")} tone="warning">{failure}</Callout> : null}
      {loading ? <Skeleton lines={6} /> : !contacts.length ? <p>{t("No matching customers.")}</p> : <div className={styles.contacts}>{contacts.map((contact) => <Button className={styles.contactItem} key={contact.id} variant="quiet" isDisabled={busy} onPress={async () => { if (saving.current) return; saving.current = true; setBusy(true); setFailure(""); try { const result = await crmRequest(workspaceId, "conversations", "POST", { channel, partyId: contact.id }, timeout()); onOpened(result.id); } catch (error) { setFailure((error as Error).message); saving.current = false; setBusy(false); } }}><Avatar name={String(contact.displayName)} size="sm" /><span>{String(contact.displayName)}</span><MessageCircle size={16} /></Button>)}</div>}
      <small>{t("Only connected channels can deliver outbound messages. Incoming provider messages appear automatically.")}</small>
    </div>
  </ControlledModalDialog>;
}

