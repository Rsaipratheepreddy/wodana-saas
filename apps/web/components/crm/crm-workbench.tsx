"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Check, Plus, UserRound } from "lucide-react";
import { Badge, Button, Callout, DateField, EmptyState, InlineNotice, FieldCaption, FormDialog, MoneyField, MoreDetails, NumericInput, PersonNameField, PhoneNumberField, SelectField, TextInput, TextAreaField, Checkbox, Skeleton, useDesignSystem } from "@/design-system";
import { parseDate } from "@internationalized/date";
import { crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import styles from "./crm-workbench.module.css";
import { CrmDateTimeField } from "./crm-date-time-field";
import { zonedDateTime, zonedDateTimeToIso } from "@/lib/crm/zoned-time";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { activityTitle } from "@/lib/crm/contact";
import { SideSection } from "./record/record-layout";

export type FieldSpec = {
  key: string; label: string;
  /** "phone" keeps a full international number; "money" an exact decimal string; "date" YYYY-MM-DD. */
  type?: "text" | "email" | "tel" | "phone" | "number" | "money" | "date" | "datetime-local" | "textarea" | "checkbox" | "multi-select";
  required?: boolean; min?: number; max?: number; options?: { id: string; label: string }[]; value?: unknown;
  /** Folded under More details: the essentials come first. */
  more?: boolean;
  /** A person's name typed by staff (letters and spaces); a function decides from the other values (a person, not a company). */
  personName?: boolean | ((values: Record<string, unknown>) => boolean);
  /** A phone field that must be a mobile of the chosen country. */
  mobile?: boolean;
};
export type ActionSpec = {
  title: string; description?: string; blockedReason?: string; path: string | ((values: Record<string, unknown>) => string); method?: string; fields: FieldSpec[];
  initial?: Record<string, unknown>; transform?: (values: Record<string, unknown>) => Record<string, unknown>; submit?: string; submitVariant?: "primary" | "danger";
  /** Above the fields: an assistant that fills them (Fill with Woddy). */
  lead?: (values: Record<string, unknown>, set: (patch: Record<string, unknown>) => void) => ReactNode;
  /** Under a field: a warning that doesn't block the save (someone already has this phone). */
  notice?: (key: string, values: Record<string, unknown>) => ReactNode;
};

function PhoneSpecField({ field, value, onChange }: { field: FieldSpec; value: string; onChange: (value: string) => void }) {
  return <PhoneNumberField isRequired={field.required} kind={field.mobile ? "mobile" : "any"} label={field.label} onChange={onChange} value={value} />;
}

export function Fields({ fields, values, onChange, notice, savedValues }: { fields: FieldSpec[]; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void; notice?: ActionSpec["notice"];
  /** What the record held when the form opened: a name kept as it came is not checked. */
  savedValues?: Record<string, unknown> }) {
  const t = useT();
  const personName = (field: FieldSpec) => typeof field.personName === "function" ? field.personName(values) : Boolean(field.personName);
  const field = (field: FieldSpec) => <div className={styles.field} key={field.key}>
    {field.type === "multi-select" ? <div aria-label={field.label} className={styles.multiSelect} role="group"><FieldCaption isRequired={field.required}>{field.label}</FieldCaption>{field.options?.map((option) => {
      const selected = Array.isArray(values[field.key]) ? values[field.key] as string[] : [];
      return <Checkbox key={option.id} isSelected={selected.includes(option.id)} onChange={(checked) => onChange(field.key, checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))}>{option.label}</Checkbox>;
    })}</div>
      : field.options ? <SelectField label={field.label} isRequired={field.required} selectedKey={String(values[field.key] ?? "") || null} onSelectionChange={(key) => onChange(field.key, key === "__none__" ? "" : String(key ?? ""))} items={field.required ? field.options : [{ id: "__none__", label: t("None") }, ...field.options]} />
      : field.type === "textarea" ? <TextAreaField label={field.label} maxLength={10000} isRequired={field.required} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : field.type === "checkbox" ? <Checkbox isSelected={Boolean(values[field.key])} onChange={(value) => onChange(field.key, value)}>{field.label}</Checkbox>
      : field.type === "number" ? <NumericInput label={field.label} isRequired={field.required} minValue={field.min} maxValue={field.max} value={values[field.key] === "" || values[field.key] === undefined ? undefined : Number(values[field.key])} onChange={(value) => onChange(field.key, value)} />
      : field.type === "money" ? <MoneyField label={field.label} isRequired={field.required} min={field.min === undefined ? undefined : String(field.min)} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : field.type === "date" ? <DateField label={field.label} isRequired={field.required} value={safeDay(values[field.key])} onChange={(value) => onChange(field.key, value?.toString() ?? "")} />
      : field.type === "datetime-local" ? <CrmDateTimeField label={field.label} isRequired={field.required} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : field.type === "phone" ? <PhoneSpecField field={field} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : personName(field) ? <PersonNameField label={field.label} maxLength={240} isRequired={field.required} savedValue={typeof savedValues?.[field.key] === "string" && savedValues[field.key] ? String(savedValues[field.key]) : undefined} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : <TextInput label={field.label} inputType={field.type ?? "text"} maxLength={500} isRequired={field.required} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />}
    {notice?.(field.key, values)}
  </div>;
  const first = fields.filter((item) => !item.more);
  const later = fields.filter((item) => item.more);
  return <div className={styles.fields}>{first.map(field)}{later.length ? <MoreDetails filled={later.filter((item) => values[item.key] !== "" && values[item.key] !== undefined && !(Array.isArray(values[item.key]) && !(values[item.key] as unknown[]).length)).length}>{later.map(field)}</MoreDetails> : null}</div>;
}

function safeDay(value: unknown) {
  try { return typeof value === "string" && value ? parseDate(value.slice(0, 10)) : null; } catch { return null; }
}

/**
 * The CRM's generic create and edit dialog, on the shared form: Cancel then the action at the end, the
 * essentials first, a blocked save names its fields, Esc asks before losing changes. A save that worked but
 * whose screen couldn't refresh leaves only Close, so nothing is sent twice.
 */
export function ActionDialog({ action, workspaceId, onClose, onSaved }: { action: ActionSpec; workspaceId: string; onClose: () => void; onSaved: (result: RecordData) => Promise<void> | void }) {
  const t = useT();
  // Date-and-time fields read and write the workspace's wall clock (its region's zone), like the calendar.
  const { timeZone } = useDesignSystem();
  const [initialValues] = useState<Record<string, unknown>>(() => Object.fromEntries(action.fields.map((f) => { const value = action.initial?.[f.key] ?? f.value ?? (f.type === "multi-select" ? [] : ""); return [f.key, f.type === "datetime-local" ? zonedDateTime(value, timeZone) : value]; })));
  const [values, setValues] = useState(initialValues);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const set = (patch: Record<string, unknown>) => setValues((current) => ({ ...current, ...patch }));
  const submit = async () => {
    if (saved || action.blockedReason) return;
    setFailure("");
    const body = { ...action.initial };
    for (const field of action.fields) {
      const value = values[field.key];
      if (field.required && (value === "" || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length))) throw new Error(t("Enter {field}.", { field: field.label.toLowerCase() }));
      if (value === "" || value === undefined) { delete body[field.key]; continue; }
      if (field.type === "datetime-local") {
        const instant = zonedDateTimeToIso(String(value), timeZone);
        if (!instant) throw new Error(t("Choose a valid date and time for {field}.", { field: field.label.toLowerCase() }));
        body[field.key] = instant;
        continue;
      }
      body[field.key] = field.type === "number" ? Number(value) : typeof value === "string" ? value.trim() : value;
    }
    const path = typeof action.path === "function" ? action.path(body) : action.path;
    const result = await crmRequest(workspaceId, path, action.method ?? "POST", action.transform ? action.transform(body) : body);
    setSaved(true);
    try { await onSaved(result); onClose(); }
    catch { setFailure(t("Your change was saved, but the screen could not refresh. Close this dialog and refresh the page. Do not submit it again.")); }
  };
  return <FormDialog cancelLabel={saved ? t("Close") : undefined} description={action.description} error={failure || undefined} errorTitle={t("Saved. Refresh needed.")}
    hideSubmit={saved} isDirty={!saved && JSON.stringify(values) !== JSON.stringify(initialValues)} isSubmitDisabled={Boolean(action.blockedReason)}
    lead={<>{action.blockedReason ? <p role="status">{action.blockedReason}</p> : null}{action.lead?.(values, set)}</>}
    onClose={onClose} onSubmit={submit} submitLabel={action.submit ?? t("Save")} submitVariant={action.submitVariant} title={action.title}>
    <fieldset disabled={saved} className={styles.plainFieldset}><Fields fields={action.fields} notice={action.notice} savedValues={initialValues} values={values} onChange={(key, value) => set({ [key]: value })} /></fieldset>
  </FormDialog>;
}

export function useCrmResource<T>(workspaceId: string, path: string | null) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; revision: number; data: T | null; failure: string } | null>(null);
  const key = `${workspaceId}/${path}`;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    crmRequest<T>(workspaceId, path, "GET", undefined, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ key, revision, data, failure: "" }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, revision, data: null, failure: error.message }); });
    return () => controller.abort();
  }, [workspaceId, path, key, revision]);
  const current = result?.key === key && result.revision === revision ? result : null;
  // A refresh keeps showing what was there (an in-place edit doesn't blank the record while it reloads).
  const previous = result?.key === key && result.data ? result.data : null;
  return { data: current?.data ?? (current?.failure ? null : previous), failure: current?.failure ?? "", loading: Boolean(path && !current && !previous), refresh };
}

export function ResourceState({ loading, failure, retry }: { loading: boolean; failure: string; retry: () => void }) {
  const t = useT();
  return failure ? <Callout title={t("Could not load this section")} tone="warning">{failure} <Button size="compact" onPress={retry}>{t("Retry")}</Button></Callout> : loading ? <Skeleton lines={6} shape="rows" /> : null;
}

export function FactList({ facts }: { facts: Array<[string, ReactNode]> }) {
  const t = useT();
  return <dl aria-label={t("Record details")} className={styles.properties}>{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>;
}

export const choice = (values: string[]) => values.map((id) => ({ id, label: label(id) }));
export const options = (items: RecordData[], name = "name") => items.map((row) => ({ id: row.id, label: String(row[name] ?? row.title ?? row.displayName ?? row.id) }));

export type AssignmentEntry = { id: string; at: string; ownerName: string | null; method: string; reason?: string | null };

/** Add an activity (task, call, meeting or note) to a record; the same dialog everywhere activities are listed. */
export function addActivityAction(t: Translate, target: Record<string, string>): ActionSpec {
  return { title: t("Add activity"), description: t("A saved note or scheduled call is an internal record. Complete an outbound call only after the customer interaction actually happened."), path: "activities", initial: { ...target, type: "task", isNextAction: true }, fields: [{ key: "type", label: t("Activity"), options: choice(["task", "call", "meeting", "note"]), required: true }, { key: "title", label: t("Title"), required: true }, { key: "dueAt", label: t("Due"), type: "datetime-local" }, { key: "isNextAction", label: t("Make this the next action"), type: "checkbox" }, { key: "description", label: t("Notes"), type: "textarea" }], transform: (v) => { if (v.type === "note") { v.isNextAction = false; v.interactionDirection = "internal"; } if (v.type === "call") v.interactionDirection = "outbound"; if (v.isNextAction && !v.dueAt) throw new Error(t("Choose a due date for the next action.")); return v; } };
}

/** Move a pending activity to a new due date. */
export function rescheduleActivityAction(t: Translate, activity: RecordData): ActionSpec {
  return { title: t("Reschedule activity"), path: `activities/${activity.id}`, method: "PATCH", initial: { version: activity.version }, fields: [{ key: "dueAt", label: t("New due date"), type: "datetime-local", required: true }] };
}

/** Complete a pending activity with its outcome; a call is confirmed only after it really happened. */
export function completeActivityAction(t: Translate, activity: RecordData): ActionSpec {
  return { title: activity.type === "call" ? t("Confirm completed call") : t("Complete activity"), description: activity.type === "call" ? t("Confirm only after a real outbound customer call. This becomes first-response evidence.") : undefined, path: `activities/${activity.id}/complete`, initial: { version: activity.version }, fields: [{ key: "outcome", label: t("Outcome"), required: true }], submit: t("Complete") };
}

/** Activities and (for enquiries) assignments in one timeline, newest first (PLM-095). */
export function ActivityPanel({ workspaceId, leadId, partyId, opportunityId, ownerMembershipId, onChanged, assignments = [], activities: shared, title }: {
  workspaceId: string; leadId?: string; partyId?: string; opportunityId?: string; ownerMembershipId?: string | null; onChanged?: () => Promise<void> | void; assignments?: AssignmentEntry[];
  /** On a record's main column: the section's title, with Add activity beside it. */
  title?: string;
  /** The record already loads its activities (for its next step): the panel shows those instead of loading them again. */
  activities?: ReturnType<typeof useCrmResource<unknown>>;
}) {
  const t = useT();
  const zoned = useDesignSystem();
  const query = activityQuery({ leadId, partyId, opportunityId });
  const own = useCrmResource<unknown>(workspaceId, shared ? null : `activities?${query}`);
  const resource = shared ?? own;
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [extra, setExtra] = useState<RecordData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const activities = [...rows(resource.data), ...extra];
  const nextCursor = cursor ?? (resource.data as { nextCursor?: string } | null)?.nextCursor;
  const target = { ...(leadId ? { leadId } : {}), ...(partyId ? { partyId } : {}), ...(opportunityId ? { opportunityId } : {}), ...(ownerMembershipId ? { ownerMembershipId } : {}) };
  const add = <Button size="compact" variant={title ? "quiet" : "secondary"} className={styles.activityAddAction} onPress={() => setAction(addActivityAction(t, target))}><Plus aria-hidden="true" size={14} />{t("Add activity")}</Button>;
  const panel = <div className={`${styles.workbench} ${styles.activityPanel}`}>
    {title ? null : <div className={styles.toolbar}>{add}</div>}
    <ResourceState {...resource} retry={resource.refresh} />
    {!resource.loading && !resource.failure && !activities.length && !assignments.length ? <EmptyState illustration={null} title={t("No activities yet. Schedule a follow-up or record a note.")} /> : null}
    {timelineOf(activities, assignments).map((entry) => entry.kind === "assignment" ? <div className={styles.timelineAssignment} key={`assignment-${entry.item.id}`}>
      <UserRound aria-hidden="true" size={14} />
      <div><strong>{entry.item.ownerName ? t("Assigned to {name}", { name: entry.item.ownerName }) : t("Returned to the queue")}</strong><small>{label(entry.item.method)} · {dateText(entry.item.at)}</small>{entry.item.reason ? <p>{entry.item.reason}</p> : null}</div>
    </div> : (activity => <div className={styles.row} key={activity.id}><div><strong>{activityTitle(activity, t)}</strong><small>{label(activity.type)}{activity.interactionDirection ? ` · ${label(activity.interactionDirection)}` : ""} · {label(activity.status)} · {dateText(activity.dueAt, zoned)}{activity.isNextAction ? ` · ${t("Next action")}` : ""}</small>{activity.description ? <p>{String(activity.description)}</p> : null}</div>{activity.status === "pending" ? <div className={`${styles.actions} ${styles.activityActions}`}><Button size="compact" onPress={() => setAction(rescheduleActivityAction(t, activity))}><CalendarClock aria-hidden="true" size={14} />{t("Reschedule")}</Button><Button size="compact" variant="primary" onPress={() => setAction(completeActivityAction(t, activity))}><Check aria-hidden="true" size={14} />{t("Complete")}</Button></div> : <Badge tone="neutral">{label(activity.status)}</Badge>}</div>)(entry.item))}
    {nextCursor && cursor !== "done" ? <Button size="compact" onPress={async () => { try { const result = await crmRequest<{ data: RecordData[]; nextCursor: string | null }>(workspaceId, `activities?${query}&cursor=${encodeURIComponent(nextCursor)}`); setExtra((old) => [...old, ...result.data.filter((row) => !activities.some((a) => a.id === row.id))]); setCursor(result.nextCursor ?? "done"); } catch (error) { setPageError((error as Error).message); } }}>{t("Load more activities")}</Button> : null}
    {pageError ? <InlineNotice message={pageError} tone="error" /> : null}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={async () => { setExtra([]); setCursor(null); resource.refresh(); await onChanged?.(); }} /> : null}
  </div>;
  return title ? <SideSection title={title} action={add}>{panel}</SideSection> : panel;
}

/** The activities of one record: an enquiry's, else an opportunity's, else a client's. */
export function activityQuery({ leadId, partyId, opportunityId }: { leadId?: string; partyId?: string; opportunityId?: string }) {
  return new URLSearchParams({ limit: "100", ...(leadId ? { leadId } : opportunityId ? { opportunityId } : partyId ? { partyId } : {}) });
}

function timelineOf(activities: RecordData[], assignments: AssignmentEntry[]) {
  const when = (activity: RecordData) => Date.parse(String(activity.completedAt ?? activity.createdAt ?? activity.dueAt ?? "")) || 0;
  return [
    ...activities.map((item) => ({ kind: "activity" as const, at: when(item), item })),
    ...assignments.map((item) => ({ kind: "assignment" as const, at: Date.parse(item.at) || 0, item })),
  ].sort((a, b) => b.at - a.at);
}


