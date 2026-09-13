"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, StickyNote } from "lucide-react";
import { Button, Callout, ComboboxField, ControlledModalDialog, InspectorSheet, SelectField, TextAreaField, TextInput } from "@/design-system";
import { crmRequest, CrmRequestError, label, rows, type RecordData } from "@/lib/crm/client";
import { localDateTime } from "@/lib/crm/calendar";
import { useCrmResource } from "./crm-workbench";
import styles from "./follow-up-editor.module.css";

type Draft = { title: string; notes: string; date: string; time: string };
function draftFor(record: RecordData): Draft {
  const local = localDateTime(record.dueAt);
  return { title: String(record.title ?? ""), notes: String(record.description ?? ""), date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function reminderTimestamp(date: string, time: string, required = false): string | null {
  if (!date && !time && !required) return null;
  if (!date || !time) throw new Error("Choose both a reminder date and a time.");
  const value = new Date(`${date}T${time}`);
  if (!Number.isFinite(value.getTime()) || localDateTime(value.toISOString()) !== `${date}T${time}`) throw new Error("Choose a valid date and time in your timezone.");
  return value.toISOString();
}

function ScheduleFields({ date, time, onChange, required = false }: { date: string; time: string; onChange: (value: { date: string; time: string }) => void; required?: boolean }) {
  return <section className={styles.schedule} aria-label="Reminder schedule"><h3><CalendarDays size={15} />Reminder</h3><div className={styles.dateFields}>
    <label>Date<input type="date" aria-label="Reminder date" required={required} value={date} onChange={(event) => onChange({ date: event.target.value, time })} /></label>
    <label>Time<input type="time" aria-label="Reminder time" required={required} value={time} onChange={(event) => onChange({ date, time: event.target.value })} /></label>
  </div><div className={styles.shortcuts} aria-label="Quick reminder dates">{[{ label: "Today", offset: 0 }, { label: "Tomorrow", offset: 1 }, { label: "Next week", offset: 7 }].map((item) => <button key={item.label} type="button" onClick={() => { const next = new Date(); next.setDate(next.getDate() + item.offset); onChange({ date: localDateTime(next.toISOString()).slice(0, 10), time: time || "10:00" }); }}>{item.label}</button>)}</div><p className={styles.hint}>Your local time · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></section>;
}

export function FollowUpSheet({ workspaceId, recordId, summary, onClose, onSaved }: { workspaceId: string; recordId: string; summary?: RecordData; onClose: () => void; onSaved: (record: RecordData) => void }) {
  const resource = useCrmResource<RecordData>(workspaceId, `activities/${recordId}`);
  const [editing, setEditing] = useState({ dirty: false, busy: false });
  const editingChanged = useCallback((dirty: boolean, busy: boolean) => setEditing({ dirty, busy }), []);
  const close = () => { if (!editing.busy && (!editing.dirty || window.confirm("Discard unsaved changes?"))) onClose(); };
  return <InspectorSheet isOpen title="Follow-up" description="Your notes, next reminder, and progress." size="md" onOpenChange={(open) => { if (!open) close(); }}>
    {resource.loading ? <p role="status">Loading follow-up…</p> : resource.failure ? <Callout title="Could not open follow-up" tone="warning">{resource.failure}<Button size="compact" onPress={resource.refresh}>Retry</Button></Callout> : resource.data ? <FollowUpForm key={`${recordId}:${resource.data.version}`} workspaceId={workspaceId} initial={{ ...summary, ...resource.data }} onSaved={onSaved} onEditingChange={editingChanged} onReload={resource.refresh} onClose={close} /> : null}
  </InspectorSheet>;
}

function FollowUpForm({ workspaceId, initial, onSaved, onEditingChange, onReload, onClose }: { workspaceId: string; initial: RecordData; onSaved: (record: RecordData) => void; onEditingChange: (dirty: boolean, busy: boolean) => void; onReload: () => void; onClose: () => void }) {
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(() => draftFor(initial));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
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
      if (!draft.title.trim()) throw new Error("Give this follow-up a short title.");
      let current = record;
      if (dirty) {
        const old = draftFor(record);
        const scheduleChanged = old.date !== draft.date || old.time !== draft.time;
        const result = await crmRequest<RecordData>(workspaceId, `activities/${record.id}`, "PATCH", { version: record.version, title: draft.title.trim(), description: draft.notes.trim() || null, ...(scheduleChanged ? { dueAt: reminderTimestamp(draft.date, draft.time, Boolean(record.appointment || record.isNextAction)) } : {}) });
        current = { ...record, ...result };
        setRecord(current); setDraft(draftFor(current)); onSaved(current); savedChanges = true;
      }
      if (complete) {
        const result = await crmRequest<RecordData>(workspaceId, `activities/${record.id}/complete`, "POST", { version: current.version });
        current = { ...current, ...result }; setRecord(current); onSaved(current);
      }
      setNotice(complete ? "Follow-up completed. Your notes are saved." : "Saved. Your reminder is updated in Overview and Calendar.");
    } catch (error) {
      setConflict(error instanceof CrmRequestError && error.status === 409);
      setFailure(`${savedChanges ? "Notes and schedule were saved, but completion failed. " : ""}${(error as Error).message}`);
    } finally { saving.current = false; setBusy(false); }
  };

  return <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void save(false); }}>
    <div className={styles.context}><span className={styles.contextIcon}><StickyNote size={19} /></span><div><strong>{String(record.partyName ?? record.leadTitle ?? record.title)}</strong><small>{label(record.type)}{record.ownerName ? ` · ${String(record.ownerName)}` : " · Unassigned"}</small></div>{record.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>Open lead</Link> : null}</div>
    {!pending ? <p className={styles.status}><Check size={16} />{label(record.status)}{record.completedAt ? ` · ${new Date(String(record.completedAt)).toLocaleDateString()}` : ""}</p> : null}
    {failure ? <Callout title="Could not save follow-up" tone="danger">{failure}{conflict ? <Button size="compact" onPress={() => { if (!dirty || window.confirm("Load the latest follow-up and discard your unsaved changes?")) { onEditingChange(false, false); onReload(); } }}>Reload latest</Button> : null}</Callout> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {pending ? <fieldset disabled={busy} className={styles.fields}>
      <TextInput label="Follow-up title" isRequired value={draft.title} maxLength={240} onChange={(title) => change({ title })} />
      <ScheduleFields date={draft.date} time={draft.time} onChange={change} />
      {record.appointment ? <p className={styles.hint}>Rescheduling keeps the meeting’s duration. Google events are not changed.</p> : null}
      <TextAreaField label="Notes" description="Keep what the client said and what you need to do next." placeholder="Client asked me to call tomorrow about the quotation…" value={draft.notes} maxLength={10000} onChange={(notes) => change({ notes })} />
    </fieldset> : <div className={styles.readOnly}><h3>{String(record.title)}</h3><p>{record.dueAt ? new Date(String(record.dueAt)).toLocaleString() : "No reminder date"}</p><h3>Notes</h3><p>{String(record.description || "No notes were added.")}</p>{record.completionOutcome ? <><h3>Outcome</h3><p>{String(record.completionOutcome)}</p></> : null}</div>}
    <div className={styles.actions}>{pending ? <><Button size="compact" isDisabled={busy || conflict} onPress={() => void save(true)}><Check size={15} />{dirty ? "Save & complete" : "Mark complete"}</Button><Button size="compact" variant="primary" type="submit" isDisabled={!dirty || conflict} isLoading={busy}>Save changes</Button></> : <Button size="compact" onPress={onClose}>Close</Button>}</div>
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
          if (cursor && cursors.has(cursor)) throw new Error("The client list could not finish loading. Please retry.");
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

export function NewFollowUpDialog({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (record: RecordData) => void }) {
  const leads = useTargets(workspaceId, "leads");
  const parties = useTargets(workspaceId, "parties");
  const members = useCrmResource<unknown>(workspaceId, "members");
  const [relation, setRelation] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [type, setType] = useState("call");
  const [owner, setOwner] = useState("unassigned");
  const [initial] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 1); return { title: "", notes: "", date: localDateTime(date.toISOString()).slice(0, 10), time: "10:00" }; });
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState("");
  const leadParties = new Set(leads.items.map((item) => item.partyId));
  const targets = [...leads.items.map((item) => ({ id: `lead:${item.id}`, label: `${String(item.partyName ?? "Lead")} · ${String(item.title ?? "Enquiry")}`, record: item })), ...parties.items.filter((item) => !leadParties.has(item.id)).map((item) => ({ id: `party:${item.id}`, label: String(item.displayName ?? "Client"), record: item }))];
  const dirty = Boolean(relation || type !== "call" || owner !== "unassigned" || JSON.stringify(draft) !== JSON.stringify(initial));
  const close = () => { if (!busy && (!dirty || window.confirm("Discard this unsaved follow-up?"))) onClose(); };
  const change = (value: Partial<Draft>) => setDraft((old) => ({ ...old, ...value }));
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setFailure("");
    try {
      const target = targets.find((item) => item.id === relation);
      if (!target) throw new Error("Choose a lead or client from the list.");
      const [kind, id] = relation.split(":");
      const name = String(target.record.partyName ?? target.record.displayName ?? "Client");
      const title = draft.title.trim() || `${label(type)} follow-up · ${name}`;
      const body = { title, description: draft.notes.trim() || undefined, type, dueAt: reminderTimestamp(draft.date, draft.time, true), priority: "normal", customerVisible: false, ...(owner !== "unassigned" ? { ownerMembershipId: owner } : {}), ...(kind === "lead" ? { leadId: id, isNextAction: !target.record.isConverted && !["qualified", "disqualified", "paused"].includes(String(target.record.status)) } : { partyId: id, isNextAction: false }) };
      const record = await crmRequest<RecordData>(workspaceId, "activities", "POST", body);
      onCreated({ ...body, status: "pending", partyName: name, ...(kind === "lead" ? { leadTitle: target.record.title } : {}), ownerName: rows(members.data).find((item) => item.id === owner)?.displayName, ...record });
    } catch (error) { setFailure((error as Error).message); }
    finally { saving.current = false; setBusy(false); }
  };
  return <ControlledModalDialog isOpen title="Add follow-up" description="Choose a client, add a note, and set your next reminder." onOpenChange={(open) => { if (!open) close(); }} isDismissable={!busy}>
    <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {failure ? <Callout title="Could not save follow-up" tone="danger">{failure}</Callout> : null}
      {leads.failure || parties.failure ? <Callout title="Some clients could not load" tone="warning">{leads.failure || parties.failure}<Button size="compact" onPress={() => { leads.retry(); parties.retry(); }}>Retry</Button></Callout> : null}
      <fieldset className={styles.fields} disabled={busy}>
        <ComboboxField label="Lead or client" isRequired placeholder={leads.loading || parties.loading ? "Loading clients…" : "Search clients and leads…"} items={targets.filter((item) => item.label.toLocaleLowerCase().includes(targetSearch.toLocaleLowerCase()))} inputValue={targetSearch} onInputChange={setTargetSearch} selectedKey={relation || null} onSelectionChange={(key) => setRelation(String(key ?? ""))} isDisabled={!targets.length} />
        {!leads.loading && !parties.loading && !targets.length ? <p className={styles.hint}>Add a lead before creating a follow-up. <Link href="/workspace/crm/leads">Open leads</Link></p> : null}
        <TextInput label="Follow-up title" placeholder="e.g. Call about the quotation" value={draft.title} maxLength={240} onChange={(title) => change({ title })} />
        <ScheduleFields date={draft.date} time={draft.time} onChange={change} required />
        <TextAreaField label="Notes" placeholder="Client asked me to call tomorrow…" value={draft.notes} maxLength={10000} onChange={(notes) => change({ notes })} />
        <details className={styles.options}><summary>Type & assignee</summary><div><SelectField label="Type" items={[{ id: "call", label: "Call" }, { id: "task", label: "Task" }, { id: "meeting", label: "Meeting" }]} selectedKey={type} onSelectionChange={(key) => setType(String(key))} /><SelectField label="Assigned to" items={[{ id: "unassigned", label: "Unassigned" }, ...rows(members.data).map((item) => ({ id: item.id, label: String(item.displayName ?? item.name ?? "Team member") }))]} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))} />{members.failure ? <p className={styles.hint}>Assignees are unavailable. You can still save an unassigned reminder.</p> : null}</div></details>
      </fieldset><div className={styles.actions}><Button size="compact" isDisabled={busy} onPress={close}>Cancel</Button><Button size="compact" type="submit" variant="primary" isLoading={busy} isDisabled={!relation}>Save reminder</Button></div>
    </form>
  </ControlledModalDialog>;
}
