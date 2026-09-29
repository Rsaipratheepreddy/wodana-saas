"use client";

import { CrmDateTimeField } from "./crm-date-time-field";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Check, StickyNote } from "lucide-react";
import { Button, Callout, ComboboxField, ControlledModalDialog, InspectorSheet, SelectField, TextAreaField, TextInput, useConfirmationDialog, useDesignSystem, useRememberedChoice, useWorkingCalendar, useWorkspaceZoneLabel } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest, CrmRequestError, label, rows, type RecordData } from "@/lib/crm/client";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { localDateTime } from "@/lib/crm/calendar";
import { useCrmResource } from "./crm-workbench";
import styles from "./follow-up-editor.module.css";

export function suggestedFollowUpTime(text: string): string | null {
  const match = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return `${String(hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function EditorPage({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className={styles.document} aria-label={title}><Button size="compact" onPress={onClose}><ArrowLeft size={16} />{t("Back to follow-ups")}</Button><div className={styles.documentBody}><h2 ref={heading} tabIndex={-1}>{title}</h2>{children}</div></section>;
}

type Draft = { title: string; notes: string; date: string; time: string; duration: string };
function draftFor(record: RecordData): Draft {
  const local = localDateTime(record.dueAt);
  const appointment = record.appointment as Record<string, unknown> | undefined;
  const duration = appointment ? Math.round((Date.parse(String(appointment.endsAt)) - Date.parse(String(appointment.startsAt))) / 60000) : 0;
  return { duration: duration > 0 ? String(duration) : "", title: String(record.title ?? ""), notes: String(record.description ?? ""), date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function reminderTimestamp(date: string, time: string, required = false): string | null {
  if (!date && !time && !required) return null;
  if (!date || !time) throw new Error(tKey("Choose both a reminder date and a time."));
  const value = new Date(`${date}T${time}`);
  if (!Number.isFinite(value.getTime()) || localDateTime(value.toISOString()) !== `${date}T${time}`) throw new Error(tKey("Choose a valid date and time in your timezone."));
  return value.toISOString();
}

function DurationField({ draft, onChange }: { draft: Draft; onChange: (value: string) => void }) {
  const start = draft.date && draft.time ? new Date(`${draft.date}T${draft.time}`) : null;
  const end = start && draft.duration ? new Date(start.getTime() + Number(draft.duration) * 60000) : null;
  const t = useT();
  const { locale } = useDesignSystem();
  const time = (date: Date) => date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return <div className={styles.duration}><SelectField label={t("Duration")} selectedKey={draft.duration || "none"} items={[...(!draft.duration ? [{ id: "none", label: t("No end time") }] : []), ...[...new Set([15, 30, 45, 60, 90, 120, 180, 240, ...(draft.duration ? [Number(draft.duration)] : [])])].sort((a,b) => a-b).map(value => ({ id: String(value), label: t("{count} minutes", { count: value }) }))]} onSelectionChange={key => onChange(key === "none" ? "" : String(key))} />{start && end ? <strong>{end.getDate() !== start.getDate() ? t("{from} – {to} · next day", { from: time(start), to: time(end) }) : `${time(start)} – ${time(end)}`}</strong> : null}</div>;
}

function ScheduleFields({ date, time, onChange, required = false }: { date: string; time: string; onChange: (value: { date: string; time: string }) => void; required?: boolean }) {
  const t = useT();
  const zone = useWorkspaceZoneLabel();
  return <section className={styles.schedule} aria-label={t("Reminder schedule")}><h3><CalendarDays size={15} />{t("Reminder")}</h3><CrmDateTimeField label={t("Reminder")} isRequired={required} value={`${date}T${time}`} onChange={value => { const [date = "", time = ""] = value.split("T"); onChange({ date, time }); }} />
  <div className={styles.shortcuts} aria-label={t("Quick reminder dates")}>{[{ label: t("Today"), offset: 0 }, { label: t("Tomorrow"), offset: 1 }, { label: t("Next week"), offset: 7 }].map((item) => <button key={item.offset} type="button" onClick={() => { const next = new Date(); next.setDate(next.getDate() + item.offset); onChange({ date: localDateTime(next.toISOString()).slice(0, 10), time: time || "10:00" }); }}>{item.label}</button>)}</div><p className={styles.hint}>{zone ? t("Your local time · Workspace: {zone}", { zone }) : t("Your local time")}</p></section>;
}

export function FollowUpSheet({ workspaceId, recordId, summary, onClose, onSaved, inline = false, sample = false }: { sample?: boolean; inline?: boolean; workspaceId: string; recordId: string; summary?: RecordData; onClose: () => void; onSaved: (record: RecordData) => void }) {
  const t = useT();
  const resource = useCrmResource<RecordData>(workspaceId, sample ? null : `activities/${recordId}`);
  const [editing, setEditing] = useState({ dirty: false, busy: false });
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const editingChanged = useCallback((dirty: boolean, busy: boolean) => setEditing({ dirty, busy }), []);
  const close = () => {
    if (editing.busy) return;
    if (editing.dirty) { requestConfirmation({ title: t("Discard unsaved follow-up changes?"), body: t("Your saved follow-up remains unchanged. Notes and reminder edits will be lost."), confirmLabel: t("Discard changes"), onConfirm: onClose }); return; }
    onClose();
  };
  const data = sample ? summary : resource.data;
  const content = <>
    {sample ? <p className={styles.hint}>{t("Sample preview · Changes stay in this preview.")}</p> : null}
    {resource.loading ? <p role="status">{t("Loading follow-up…")}</p> : resource.failure ? <Callout title={t("Could not open follow-up")} tone="warning">{translateKnown(t, resource.failure)}<Button size="compact" onPress={resource.refresh}>{t("Retry")}</Button></Callout> : data ? <FollowUpForm sample={sample} key={`${recordId}:${data.version}`} workspaceId={workspaceId} initial={{ ...summary, ...data }} onSaved={onSaved} onEditingChange={editingChanged} onReload={resource.refresh} onClose={close} returnAfterSave={inline ? onClose : undefined} /> : null}</>;
  return <>{inline ? <EditorPage title={t("Follow-up")} onClose={close}>{content}</EditorPage> : <InspectorSheet isOpen title={t("Follow-up")} description={t("Your notes, next reminder, and progress.")} size="md" onOpenChange={(open) => { if (!open) close(); }}>{content}</InspectorSheet>}{confirmationDialog}</>;
}

function FollowUpForm({ workspaceId, initial, onSaved, onEditingChange, onReload, onClose, returnAfterSave, sample = false }: { sample?: boolean; returnAfterSave?: () => void; workspaceId: string; initial: RecordData; onSaved: (record: RecordData) => void; onEditingChange: (dirty: boolean, busy: boolean) => void; onReload: () => void; onClose: () => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(() => draftFor(initial));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFor(record));
  const pending = record.status === "pending";
  useEffect(() => onEditingChange(dirty, busy), [dirty, busy, onEditingChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  const change = (value: Partial<Draft>) => { setDraft((old) => ({ ...old, ...value })); setNotice(""); };
  const save = async (complete: boolean) => {
    if (saving.current || !pending) return;
    saving.current = true; setBusy(true); setFailure(""); setConflict(false); setNotice("");
    let savedChanges = false;
    try {
      if (!draft.title.trim()) throw new Error(t("Give this follow-up a short title."));
      let current = record;
      if (dirty) {
        const old = draftFor(record);
        const scheduleChanged = old.date !== draft.date || old.time !== draft.time;
        const changes = { ...(old.duration !== draft.duration && draft.duration ? { durationMinutes: Number(draft.duration) } : {}), version: record.version, title: draft.title.trim(), description: draft.notes.trim() || null, ...(scheduleChanged ? { dueAt: reminderTimestamp(draft.date, draft.time, Boolean(record.appointment || record.isNextAction)) } : {}) };
        const result = sample ? { ...changes, version: Number(record.version) + 1 } : await crmRequest<RecordData>(workspaceId, `activities/${record.id}`, "PATCH", changes);
        current = { ...record, ...result };
        if (sample && draft.duration && draft.date && draft.time) { const start = reminderTimestamp(draft.date, draft.time, true)!; current.appointment = { startsAt: start, endsAt: new Date(Date.parse(start) + Number(draft.duration) * 60000).toISOString() }; }
        setRecord(current); setDraft(draftFor(current)); onSaved(current); savedChanges = true;
      }
      if (complete) {
        const result = sample ? { status: "completed", version: Number(current.version) + 1 } : await crmRequest<RecordData>(workspaceId, `activities/${record.id}/complete`, "POST", { version: current.version });
        current = { ...current, ...result }; setRecord(current); onSaved(current);
      }
      setNotice(t(complete ? "Follow-up completed. Your notes are saved." : "Saved. Your reminder is updated in Today and Calendar."));
      returnAfterSave?.();
    } catch (error) {
      setConflict(error instanceof CrmRequestError && error.status === 409);
      const message = translateKnown(t, (error as Error).message);
      setFailure(savedChanges ? t("Notes and schedule were saved, but completion failed. {error}", { error: message }) : message);
    } finally { saving.current = false; setBusy(false); }
  };

  return <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void save(false); }}>
    <div className={styles.context}><span className={styles.contextIcon}><StickyNote size={19} /></span><div><strong>{String(record.partyName ?? record.leadTitle ?? record.title)}</strong><small>{translateKnown(t, label(record.type))} · {record.ownerName ? String(record.ownerName) : t("Unassigned")}</small></div>{record.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>{t("Open enquiry")}</Link> : null}</div>
    {!pending ? <p className={styles.status}><Check size={16} />{translateKnown(t, label(record.status))}{record.completedAt ? ` · ${new Date(String(record.completedAt)).toLocaleDateString(locale, { timeZone })}` : ""}</p> : null}
    {failure ? <Callout title={t("Could not save follow-up")} tone="danger">{failure}{conflict ? <Button size="compact" onPress={() => { const reload = () => { onEditingChange(false, false); onReload(); }; if (dirty) { requestConfirmation({ title: t("Load the latest follow-up?"), body: t("Your unsaved notes and reminder changes will be replaced by the latest saved version."), confirmLabel: t("Reload latest"), onConfirm: reload }); } else reload(); }}>{t("Reload latest")}</Button> : null}</Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {pending ? <fieldset disabled={busy} className={styles.fields}>
      <TextInput label={t("Follow-up title")} isRequired value={draft.title} maxLength={240} onChange={(title) => change({ title })} />
      {suggestedFollowUpTime(`${draft.title} ${draft.notes}`) && suggestedFollowUpTime(`${draft.title} ${draft.notes}`) !== draft.time ? <div className={styles.timeSuggestion}><span>{t("Suggested time: {time}", { time: suggestedFollowUpTime(`${draft.title} ${draft.notes}`) ?? "" })}</span><Button size="compact" onPress={() => change({ time: suggestedFollowUpTime(`${draft.title} ${draft.notes}`)! })}>{t("Apply time")}</Button></div> : null}
      <ScheduleFields date={draft.date} time={draft.time} onChange={change} /><DurationField draft={draft} onChange={duration => change({ duration })} />
      {record.appointment ? <p className={styles.hint}>{t("Times are saved in Wodana. Google events are not changed.")}</p> : null}
      <TextAreaField label={t("Notes")} description={t("Keep what the client said and what you need to do next.")} placeholder={t("Client asked me to call tomorrow about the quotation…")} value={draft.notes} maxLength={10000} onChange={(notes) => change({ notes })} />
    </fieldset> : <div className={styles.readOnly}><h3>{String(record.title)}</h3><p>{record.dueAt ? new Date(String(record.dueAt)).toLocaleString(locale, { timeZone }) : t("No reminder date")}</p><h3>{t("Notes")}</h3><p>{String(record.description || t("No notes were added."))}</p>{record.completionOutcome ? <><h3>{t("Outcome")}</h3><p>{String(record.completionOutcome)}</p></> : null}</div>}
    <div className={styles.actions}>{pending ? <><Button size="compact" isDisabled={busy || conflict} onPress={() => void save(true)}><Check size={15} />{t(dirty ? "Save & complete" : "Mark complete")}</Button><Button size="compact" variant="primary" type="submit" isDisabled={!dirty || conflict} isLoading={busy}>{t("Save changes")}</Button></> : <Button size="compact" onPress={onClose}>{t("Close")}</Button>}</div>
    {confirmationDialog}
  </form>;
}

// Fetch all pages only while the creation dialog is open, so existing clients do not vanish at row 101.
function useTargets(workspaceId: string, path: string) {
  const [result, setResult] = useState<{ key: string; items: RecordData[]; failure: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${workspaceId}/${path}/${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const items: RecordData[] = []; const cursors = new Set<string>(); let cursor = "";
      try {
        do {
          const payload = await crmRequest<{ data: RecordData[]; nextCursor?: string | null }>(workspaceId, `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal);
          items.push(...rows(payload)); cursor = payload.nextCursor ?? "";
          if (cursor && cursors.has(cursor)) throw new Error(tKey("The client list could not finish loading. Please retry."));
          cursors.add(cursor);
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) setResult({ key, items: Array.from(new Map(items.map((item) => [item.id, item])).values()), failure: "" });
      } catch (error) { if (!controller.signal.aborted) setResult({ key, items, failure: (error as Error).message }); }
    })();
    return () => controller.abort();
  }, [workspaceId, path, key]);
  const current = result?.key === key ? result : null;
  return { items: current?.items ?? [], loading: !current, failure: current?.failure ?? "", retry: () => setRevision((n) => n + 1) };
}

export function NewFollowUpDialog({ workspaceId, onClose, onCreated, inline = false, initialSchedule, initialType = "call", initialLead }: { initialLead?: RecordData; initialType?: "call" | "task"; inline?: boolean; initialSchedule?: { date: string; time: string }; workspaceId: string; onClose: () => void; onCreated: (record: RecordData) => void | Promise<void> }) {
  const t = useT();
  const leads = useTargets(workspaceId, "leads");
  const parties = useTargets(workspaceId, "parties");
  // The people who can own CRM work (the same list and rule the server checks), readable by Sales.
  const members = useCrmResource<unknown>(workspaceId, "sales-owners");
  const initialRelation = initialLead ? `lead:${initialLead.id}` : "";
  const [created, setCreated] = useState(false);
  const [relation, setRelation] = useState(initialRelation);
  const [targetSearch, setTargetSearch] = useState(initialLead ? `${String(initialLead.partyName ?? t("Customer"))} · ${String(initialLead.title ?? t("Enquiry"))}` : "");
  // Smart defaults: the next working day of the workspace's week, the enquiry's owner (else me), and the
  // length this person last used.
  const calendar = useWorkingCalendar();
  const lastDuration = useRememberedChoice("crm.follow-up.duration", (value) => /^\d{1,4}$/.test(value));
  const [type, setType] = useState<string>(initialType);
  const me = (members.data as { currentMembershipId?: string | null } | null)?.currentMembershipId ?? null;
  const [chosenOwner, setOwner] = useState<string | null>(initialLead?.ownerMembershipId ? String(initialLead.ownerMembershipId) : null);
  const initialOwner = String(initialLead?.ownerMembershipId ?? "unassigned");
  const owner = chosenOwner ?? (me && rows(members.data).some((item) => item.id === me) ? me : "unassigned");
  const [initial] = useState(() => ({ title: "", notes: "", date: initialSchedule?.date ?? calendar.nextWorkingDayFromToday().toString(), time: initialSchedule?.time ?? "10:00", duration: lastDuration.read() ?? "30" }));
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState("");
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const availableLeads = initialLead && !leads.items.some(item => item.id === initialLead.id) ? [initialLead, ...leads.items] : leads.items;
  const leadParties = new Set(availableLeads.map((item) => item.partyId));
  const targets = [...availableLeads.map((item) => ({ id: `lead:${item.id}`, label: `${String(item.partyName ?? t("Customer"))} · ${String(item.title ?? t("Enquiry"))}`, record: item })), ...parties.items.filter((item) => !leadParties.has(item.id)).map((item) => ({ id: `party:${item.id}`, label: String(item.displayName ?? t("Customer")), record: item }))];
  const dirty = Boolean(relation !== initialRelation || type !== initialType || (chosenOwner !== null && chosenOwner !== initialOwner) || JSON.stringify(draft) !== JSON.stringify(initial));
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  const close = () => { if (busy) return; if (created) { onClose(); return; } if (dirty) { requestConfirmation({ title: t("Discard this unsaved follow-up?"), body: t("The reminder has not been saved and will be lost."), confirmLabel: t("Discard follow-up"), onConfirm: onClose }); return; } onClose(); };
  const change = (value: Partial<Draft>) => setDraft((old) => ({ ...old, ...value }));
  const save = async () => {
    if (saving.current || created) return;
    saving.current = true; setBusy(true); setFailure("");
    try {
      const target = targets.find((item) => item.id === relation);
      if (!target) throw new Error(t("Choose an enquiry or customer from the list."));
      const [kind, id] = relation.split(":");
      const name = String(target.record.partyName ?? target.record.displayName ?? t("Client"));
      const title = draft.title.trim() || t("{type} follow-up · {name}", { type: translateKnown(t, label(type)), name });
      const body = { durationMinutes: Number(draft.duration), title, description: draft.notes.trim() || undefined, type, dueAt: reminderTimestamp(draft.date, draft.time, true), priority: "normal", customerVisible: false, ...(owner !== "unassigned" ? { ownerMembershipId: owner } : {}), ...(kind === "lead" ? { leadId: id, isNextAction: !target.record.isConverted && !["qualified", "disqualified", "paused"].includes(String(target.record.status)) } : { partyId: id, isNextAction: false }) };
      const record = await crmRequest<RecordData>(workspaceId, "activities", "POST", body);
      lastDuration.remember(draft.duration);
      setCreated(true);
      try { await onCreated({ ...body, status: "pending", partyName: name, ...(kind === "lead" ? { leadTitle: target.record.title } : {}), ownerName: rows(members.data).find((item) => item.id === owner)?.displayName, ...record }); } catch { setFailure(t("Follow-up saved. Close and refresh to see it. Do not create it again.")); }
    } catch (error) { setFailure(translateKnown(t, (error as Error).message)); }
    finally { saving.current = false; setBusy(false); }
  };
  const content = <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {failure ? <Callout title={t(created ? "Saved — refresh needed" : "Could not save follow-up")} tone={created ? "warning" : "danger"}>{failure}</Callout> : null}
      {leads.failure || parties.failure ? <Callout title={t("Some customers could not load")} tone="warning">{translateKnown(t, leads.failure || parties.failure)}<Button size="compact" onPress={() => { leads.retry(); parties.retry(); }}>{t("Retry")}</Button></Callout> : null}
      <fieldset className={styles.fields} disabled={busy || created}>
        <ComboboxField label={t("Enquiry or customer")} isRequired placeholder={t(leads.loading || parties.loading ? "Loading customers…" : "Search customers and enquiries…")} items={targets.filter((item) => item.label.toLocaleLowerCase().includes(targetSearch.toLocaleLowerCase()))} inputValue={targetSearch} onInputChange={setTargetSearch} selectedKey={relation || null} onSelectionChange={(key) => { const selected = targets.find(item => item.id === String(key)); setRelation(selected?.id ?? ""); if (selected) setTargetSearch(selected.label); }} isDisabled={!targets.length} />
        {!leads.loading && !parties.loading && !targets.length ? <p className={styles.hint}>{t("Add an enquiry before creating a follow-up.")} <Link href="/workspace/crm/leads">{t("Open enquiries")}</Link></p> : null}
        <TextInput label={t("Follow-up title")} placeholder={t("e.g. Call about the quotation")} value={draft.title} maxLength={240} onChange={(title) => change({ title })} />
        {suggestedFollowUpTime(`${draft.title} ${draft.notes}`) ? <div className={styles.timeSuggestion}><span>{t("Suggested time: {time}", { time: suggestedFollowUpTime(`${draft.title} ${draft.notes}`) ?? "" })}</span><Button size="compact" onPress={() => change({ time: suggestedFollowUpTime(`${draft.title} ${draft.notes}`)! })}>{t("Apply time")}</Button></div> : /\bat\s+\d/i.test(`${draft.title} ${draft.notes}`) ? <p className={styles.hint}>{t("Include AM or PM, or choose the exact time below.")}</p> : null}
        <ScheduleFields date={draft.date} time={draft.time} onChange={change} required /><DurationField draft={draft} onChange={duration => change({ duration })} />
        <TextAreaField label={t("Notes")} placeholder={t("Client asked me to call tomorrow…")} value={draft.notes} maxLength={10000} onChange={(notes) => change({ notes })} />
        <div className={styles.assignmentFields}><SelectField label={t("Type")} items={[{ id: "call", label: t("Call") }, { id: "task", label: t("Task") }, { id: "meeting", label: t("Meeting") }]} selectedKey={type} onSelectionChange={(key) => setType(String(key))} /><SelectField label={t("Assigned to")} items={[{ id: "unassigned", label: t("Unassigned") }, ...rows(members.data).map((item) => ({ id: item.id, label: String(item.displayName ?? item.name ?? t("Team member")) }))]} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))} />{members.failure ? <p className={styles.hint}>{t("Assignees are unavailable. You can still save an unassigned reminder.")}</p> : null}</div>
      </fieldset><div className={styles.actions}><Button size="compact" isDisabled={busy} onPress={close}>{t(created ? "Close" : "Cancel")}</Button><Button size="compact" type="submit" variant="primary" isLoading={busy} isDisabled={!relation || created}>{t("Save reminder")}</Button></div>
    </form>;
  return <>{inline ? <EditorPage title={t("New follow-up")} onClose={close}>{content}</EditorPage> : <ControlledModalDialog isOpen title={t("Add follow-up")} description={t("Choose a client, add a note, and set your next reminder.")} onOpenChange={(open) => { if (!open) close(); }} isDismissable={!busy}>{content}</ControlledModalDialog>}{confirmationDialog}</>;
}
