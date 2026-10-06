"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Filter, FolderInput, MessageCircle, Plus, X } from "lucide-react";
import { MessagingMark } from "@/components/brand/messaging-mark";
import { Avatar, Button, Callout, Checkbox, ControlledModalDialog, EmptyState, FormDialog, IconButton, IconMenuButton, ListTabs, MenuButton, SelectField, Skeleton, TextAreaField, TextInput, SearchInput, ToggleButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { chipQuery, chipsFor, ENQUIRY_STAGE_LABELS, nextChatId, snoozePresets, type ConversationJob, type InboxChip, type InboxLabel, type InboxOwner, type InboxSummary } from "@/lib/crm/inbox";
import type { CrmScreenPageData } from "@/lib/crm/screens";
import { pollEvery, useLiveInvalidate } from "@/lib/workspace/live-events";
import { playFeedback } from "@/lib/feedback/sounds";
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
 * The front door (plan §5b): one title, the chips Unassigned · Mine · Team · Closed with their counts (only the
 * ones the person's inbox level can fill), a search that opens on demand, filters as removable chips, dense rows
 * that say which job a chat is filed into, the longest-waiting client first, bulk actions and keyboard moves
 * (j/k to move, e to resolve). What a person may see is decided by the server (own · team · manage · their jobs).
 */
export function CrmInbox({ initialData, initialRecordId }: { initialData: CrmScreenPageData; initialRecordId?: string }) {
  const t = useT();
  const time = useCrmTime();
  const now = useNow();
  const { locale, timeZone } = useDesignSystem();
  const workspaceId = initialData.workspaceId;
  const lookups = useInboxLookups(workspaceId);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [chip, setChip] = useState<InboxChip>("mine");
  const chipChosen = useRef(false);
  const { view, status } = chipQuery(chip, summary?.scope);
  const [labelId, setLabelId] = useState("");
  const [team, setTeam] = useState<InboxOwner[]>([]);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [stageOptions, setStageOptions] = useState<Array<{ id: string; label: string }>>([]);
  const stageParam = [...stages].sort().join(",");
  // With two or more WhatsApp numbers: one number's chats (the number the client last wrote to).
  const [numberFilter, setNumberFilter] = useState("");
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
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [bulkBusy, setBulkBusy] = useState(false);
  const requestPending = useRef(false), controller = useRef<AbortController | null>(null), cursorRef = useRef(cursor);
  // Unread counts last seen, so a chat that gets a new message while the list refreshes itself plays a soft sound.
  const unreadSeen = useRef<Map<string, number> | null>(null);
  const threadActions = useRef<{ resolve: () => void } | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const query = new URLSearchParams({ limit: "100", status, ...(stageParam ? { stage: stageParam } : {}), ...(view === "team" && ownerFilter ? { ownerMembershipId: ownerFilter } : view !== "all" ? { view } : {}), ...(labelId ? { labelId } : {}), ...(numberFilter ? { connectionId: numberFilter } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString();
  const loadSummary = useCallback(async () => {
    const [next, people] = await Promise.all([
      crmRequest<InboxSummary>(workspaceId, `inbox/summary${stageParam ? `?stage=${encodeURIComponent(stageParam)}` : ""}`, "GET", undefined, timeout()).catch(() => null),
      view === "team" ? crmRequest<InboxOwner[]>(workspaceId, "inbox/owners", "GET", undefined, timeout()).catch(() => null) : Promise.resolve(null),
    ]);
    if (Array.isArray(people)) setTeam(people);
    if (!next) return;
    setSummary(next);
    // Start on Mine; with nothing of one's own, the queue waiting for someone (or, with no queue, the job's chats).
    if (!chipChosen.current) {
      chipChosen.current = true;
      const offered = chipsFor(next.scope);
      if (!offered.includes("mine")) setChip(offered[0]);
      else if (!next.mine && next.unassigned && offered.includes("unassigned")) setChip("unassigned");
    }
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
      if (!more) {
        const unread = new Map(result.data.map((row) => [String(row.id), Number(row.unreadCount) || 0]));
        if (background && unreadSeen.current && [...unread].some(([id, count]) => count > (unreadSeen.current!.get(id) ?? 0))) playFeedback("notice");
        unreadSeen.current = unread;
      }
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

  const chooseChip = (next: InboxChip) => { chipChosen.current = true; setChip(next); setOwnerFilter(""); };
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
  const numbers = summary?.numbers ?? [];
  const numberName = (number: (typeof numbers)[number]) => [number.number, number.accountName].filter(Boolean).join(" · ") || t("WhatsApp number");
  const filtering = Boolean(stageParam) || Boolean(labelId) || Boolean(numberFilter);
  const filtered = filtering || Boolean(search.trim()) || chip !== "mine";
  const noConversations = loaded && !items.length && !busy && !filtered;
  const canSend = summary?.scope !== "job";
  const emptyState = <EmptyState icon={<MessagingMark size={36} />} title={noConversations ? t("No conversations yet") : t("Choose a conversation")}
    action={canSend ? <Button size="compact" variant="primary" className={styles.brandButton} onPress={() => setCreating(true)}><Plus aria-hidden="true" size={16} />{t("New conversation")}</Button> : undefined} />;

  // The chips (plan §5b): only the ones the person's level can fill; Snoozed only while something is snoozed.
  const counts: Record<InboxChip, number | undefined> = { unassigned: summary?.unassigned, mine: summary?.mine, team: summary?.team ?? undefined, snoozed: summary?.snoozed, closed: undefined };
  const chipLabels: Record<InboxChip, string> = { unassigned: t("Unassigned"), mine: t("Mine"), team: t("Team"), snoozed: t("Snoozed"), closed: t("Closed") };
  const chipItems = chipsFor(summary?.scope).filter((item) => item !== "snoozed" || Boolean(summary?.snoozed) || chip === "snoozed").map((item) => ({ id: item, label: chipLabels[item], count: counts[item] }));

  // Filters (label, number, stage) are added from one menu and shown as removable chips.
  const filterItems = [
    ...activeLabels.filter((item) => item.id !== labelId).map((item) => ({ id: `label:${item.id}`, label: t("Label: {name}", { name: item.name }) })),
    ...(numbers.length > 1 ? numbers.filter((number) => number.connectionId !== numberFilter).map((number) => ({ id: `number:${number.connectionId}`, label: t("Number: {name}", { name: numberName(number) }) })) : []),
    ...stageOptions.filter((item) => !stages.has(item.id)).map((item) => ({ id: `stage:${item.id}`, label: t("Stage: {name}", { name: item.label }) })),
  ];
  const addFilter = (key: string) => {
    const [kind, ...rest] = key.split(":"); const value = rest.join(":");
    if (kind === "label") setLabelId(value);
    else if (kind === "number") setNumberFilter(value);
    else if (kind === "stage") setStages((current) => new Set([...current, value]));
  };
  const filterChips = [
    ...(labelId ? [{ id: "label", label: t("Label: {name}", { name: activeLabels.find((item) => item.id === labelId)?.name ?? "" }), clear: () => setLabelId("") }] : []),
    ...(numberFilter ? [{ id: "number", label: t("Number: {name}", { name: (() => { const number = numbers.find((entry) => entry.connectionId === numberFilter); return number ? numberName(number) : ""; })() }), clear: () => setNumberFilter("") }] : []),
    ...[...stages].map((id) => ({ id: `stage:${id}`, label: t("Stage: {name}", { name: stageOptions.find((item) => item.id === id)?.label ?? id }), clear: () => setStages((current) => { const next = new Set(current); next.delete(id); return next; }) })),
  ];
  const options = [
    ...(canSend ? [{ id: "select", label: selecting ? t("Stop selecting") : t("Select chats") }] : []),
    { id: "refresh", label: t("Refresh inbox") },
    ...(lookups.settings?.canManage ? [{ id: "simulate", label: t("Simulate a client message (demo)") }, { id: "settings", label: t("Inbox settings") }] : []),
  ];
  const onOption = (key: string) => {
    if (key === "select") { setSelecting((value) => !value); setPicked(new Set()); }
    else if (key === "refresh") void reload();
    else if (key === "simulate") setSimulating(true);
    else if (key === "settings") window.location.assign("/workspace/settings/inbox");
  };
  // The list column carries the Inbox's controls (views, search, filter, ⋯, New), so the conversation gets the full height.
  const listHeader = <header className={styles.listHeader}>
    <div className={styles.listHeaderTop}>
      <ListTabs label={t("Inbox views")} items={chipItems} value={chip} onChange={chooseChip} />
    </div>
    <div className={styles.listSearch}>
      <SearchInput label={t("Search inbox")} placeholder={t("Search chats")} value={search} onChange={setSearch} />
      {filterItems.length ? <IconMenuButton ariaLabel={t("Filter")} icon={<Filter aria-hidden="true" size={15} />} items={filterItems} onAction={addFilter} /> : null}
      <IconMenuButton ariaLabel={t("Inbox options")} items={options} onAction={onOption} />
      {canSend ? <IconButton aria-label={t("New conversation")} className={styles.newChat} onPress={() => setCreating(true)} variant="primary"><Plus aria-hidden="true" size={16} /></IconButton> : null}
    </div>
    {filterChips.length ? <div aria-label={t("Filters in use")} className="wd-filter-chips" role="group">{filterChips.map((item) => <span className="wd-filter-chip" key={item.id}>
      <span>{item.label}</span><IconButton aria-label={t("Remove filter {name}", { name: item.label })} onPress={item.clear} size="compact"><X size={12} /></IconButton></span>)}</div> : null}
  </header>;

  return <CrmProductShell title={t("Inbox")} canView={initialData.canView} bare useWorkspaceColors>
    <div className={styles.inbox} data-selected={Boolean(selected)} onKeyDown={onKeyDown}>
      <section aria-label={t("Customer conversations")} className={styles.threadList}>
        {listHeader}
        {chip === "team" && team.length ? <div className={styles.teamLoad} role="group" aria-label={t("Open chats per person")}>
          {team.map((person) => <button key={person.id} type="button" aria-pressed={ownerFilter === person.id} onClick={() => setOwnerFilter((current) => current === person.id ? "" : person.id)}>
            <Avatar name={person.displayName} size="sm" /><span>{person.displayName}</span><span className="wd-count-chip">{person.openChats}</span>{person.away ? <small>{t("Away")}</small> : null}
          </button>)}
        </div> : null}
        {picked.size ? <div className={`wd-bulk-bar ${styles.bulkBar}`} role="toolbar" aria-label={t("Bulk actions")}>
          <strong>{t("{count} selected", { count: picked.size })}</strong>
          <div>
            <MenuButton size="compact" label={t("Assign")} items={[...(summary?.membershipId ? [{ id: summary.membershipId, label: t("Assign to me") }] : []), ...lookups.owners.filter((owner) => owner.id !== summary?.membershipId).map((owner) => ({ id: owner.id, label: owner.away ? t("{name} · away", { name: owner.displayName }) : owner.displayName })), { id: "unassign", label: t("Unassign") }]}
              onAction={(key) => void bulk({ action: "assign", ownerMembershipId: key === "unassign" ? null : key })} />
            {activeLabels.length ? <MenuButton size="compact" label={t("Label")} items={activeLabels.flatMap((item: InboxLabel) => [{ id: `add:${item.id}`, label: item.name }, { id: `remove:${item.id}`, label: t("Remove {label}", { label: item.name }) }])}
              onAction={(key) => { const [action, id] = key.split(":"); void bulk({ action: action === "add" ? "label" : "unlabel", labelId: id }); }} /> : null}
            {status !== "closed" ? <MenuButton size="compact" label={t("Snooze")} items={presets.map((preset) => ({ id: preset.id, label: t(preset.label) }))} onAction={(key) => { const preset = presets.find((item) => item.id === key); if (preset) void bulk({ action: "snooze", snoozedUntil: preset.until }); }} /> : null}
            <Button size="compact" variant="primary" isLoading={bulkBusy} onPress={() => void bulk({ action: status === "closed" ? "reopen" : "resolve" })}>{status === "closed" ? t("Reopen") : t("Resolve")}</Button>
          </div>
          <Button size="compact" variant="quiet" onPress={() => setPicked(new Set())}>{t("Clear")}</Button>
        </div> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {failure ? <p className={styles.error} role="alert">{failure} <Button size="compact" variant="quiet" onPress={() => void reload()}>{t("Retry")}</Button></p> : null}
        <div aria-busy={busy} className={styles.threadItems}>
          {!loaded && busy ? <Skeleton lines={6} /> : null}
          {items.map((item) => {
            const name = String(item.partyName ?? t("Customer"));
            const rowLabels = (item.labels ?? []) as InboxLabel[];
            const job = (item.job ?? null) as ConversationJob | null;
            const unread = Number(item.unreadCount) || 0;
            return <div className={styles.threadRow} key={item.id} data-picked={picked.has(item.id) || undefined}>
              {selecting || picked.size ? <Checkbox aria-label={t("Select {name}", { name })} isSelected={picked.has(item.id)} onChange={(value) => togglePick(item.id, value)} /> : null}
              <ToggleButton id={`chat-${item.id}`} className={styles.threadItem} isSelected={selected === item.id} onPress={() => { setNotice(""); setSelected(item.id); }} variant="quiet" data-unread={unread > 0 || undefined}>
                <Avatar name={name} size="sm" />
                <span className={styles.threadCopy}>
                  <span className={styles.threadTop}><strong>{name}</strong><time dateTime={String(item.lastMessageAt ?? "")} title={item.lastMessageAt ? time(item.lastMessageAt) : t("New conversation")}>{inboxDate(item.lastMessageAt, locale, timeZone, t("New"))}</time></span>
                  <span className={styles.threadBottom}>
                    <span className={styles.preview}>{item.lastMessageDirection === "outbound" ? <DeliveryState status={String(item.lastMessageStatus)} compact /> : null}<span className={styles.previewText}>{String(item.lastMessageText ?? item.subject ?? t("No messages yet"))}</span></span>
                    {unread > 0 ? <span className={styles.unread} role="img" aria-label={t("{count} unread messages", { count: unread })} /> : null}
                  </span>
                  <span className={styles.threadMeta}>
                    {item.status === "open" && item.waitingSince ? <WaitChip since={item.waitingSince} now={now} /> : null}
                    {item.status === "snoozed" && item.snoozedUntil ? <span className={styles.metaText}>{t("Until {time}", { time: time(item.snoozedUntil) })}</span> : null}
                    {job ? <span className={styles.jobChip} title={job.title}><FolderInput aria-hidden="true" size={10} />{job.reference ?? job.title}</span> : null}
                    {rowLabels.slice(0, 1).map((label) => <LabelChip key={label.id} label={label} />)}{rowLabels.length > 1 ? <span className={styles.metaText}>+{rowLabels.length - 1}</span> : null}
                    {numbers.length > 1 && !numberFilter && item.connectionId ? (() => { const number = numbers.find((entry) => entry.connectionId === item.connectionId); return number ? <span className={styles.metaText}>{numberName(number)}</span> : null; })() : null}
                  </span>
                </span>
                {view !== "mine" ? <span className={styles.ownerAvatar}>{item.ownerName ? <Avatar name={String(item.ownerName)} size="sm" /> : <span className={styles.noOwner} role="img" aria-label={t("Unassigned")} />}</span> : null}
              </ToggleButton>
            </div>;
          })}
          {!items.length && loaded && !busy && filtered ? <div className={styles.empty}><p>{chip === "mine" && !search.trim() && !filtering ? t("Nothing waiting for you.") : t("No matching conversations.")}</p></div> : null}
          {noConversations ? <div className={styles.listEmpty}>{emptyState}</div> : null}
        </div>
        {cursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more chats")}</Button> : null}
      </section>
      {selected ? <ConversationThread key={`${workspaceId}/${selected}`} workspaceId={workspaceId} id={selected} draft={drafts[selected] ?? ""}
        onDraftChange={(value) => setDrafts((old) => ({ ...old, [selected]: value }))} onBack={() => setSelected(null)} onChanged={() => reload(false, true)} onDone={openNext}
        onLeft={(message) => { setNotice(message); setSelected(null); void reload(); }}
        registerActions={registerActions} lookups={{ ...lookups, membershipId: summary?.membershipId ?? null }} />
        : <section className={styles.empty} aria-label={t("Conversation messages")}>{emptyState}</section>}
    </div>
    {creating ? <NewChat workspaceId={workspaceId} onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); setSelected(id); void reload(); }} /> : null}
    {simulating ? <SimulateMessage workspaceId={workspaceId} onClose={() => setSimulating(false)} onOpened={(id) => { setSimulating(false); setSelected(id); void reload(); }} /> : null}
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

/**
 * A demonstration: a client's WhatsApp message as if it had just arrived. It goes through the real intake
 * (client matched or created, owner chosen and told, greeting or away message); its chat is marked Demo, and
 * replies in it show as sent without reaching WhatsApp. Managers only.
 */
function SimulateMessage({ workspaceId, onClose, onOpened }: { workspaceId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <FormDialog title={t("Simulate a client message (demo)")} description={t("For demonstrations: it arrives like a real WhatsApp message, and replies in this chat are not sent to WhatsApp.")}
    onClose={onClose} isSubmitting={busy} error={error || undefined} isSubmitDisabled={!phone.trim() || !text.trim()} submitLabel={t("Simulate message")}
    onSubmit={async () => {
      setBusy(true); setError("");
      try {
        const result = await crmRequest<{ conversationId: string }>(workspaceId, "conversations/demo-whatsapp", "POST", { name: name.trim(), phone: phone.trim(), text: text.trim() });
        onOpened(result.conversationId);
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("The message couldn't be simulated.")); }
      finally { setBusy(false); }
    }}>
    <TextInput label={t("Client name")} value={name} onChange={setName} maxLength={120} autoFocus />
    <TextInput label={t("Mobile number")} value={phone} onChange={setPhone} maxLength={40} inputMode="tel" description={t("With the country code, e.g. +971 50 123 4567")} isRequired />
    <TextAreaField label={t("Message")} value={text} onChange={setText} maxLength={4000} isRequired />
  </FormDialog>;
}
