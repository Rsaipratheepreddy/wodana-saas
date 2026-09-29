"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, CalendarClock, Check, GitMerge, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { ActivityFeed, Badge, Button, Callout, DateField, EditableField, EditableFieldList, EmptyState, FieldCaption, FormDialog, MoneyField, MoreDetails, NumericInput, PhoneNumberField, SelectField, TextInput, TextAreaField, Checkbox, Tabs, Skeleton, useDesignSystem } from "@/design-system";
import { parseDate } from "@internationalized/date";
import { CrmRequestError, crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { clientTimelineItems } from "@/lib/crm/client-timeline";
import type { ClientTimelineEvent } from "@wodana/contracts";
import styles from "./crm-workbench.module.css";
import { useWoddyRecord } from "./woddy-chat";
import { CrmDateTimeField } from "./crm-date-time-field";
import { localDateTime } from "@/lib/crm/calendar";
import { useT } from "@/lib/i18n/i18n-provider";
import { activityTitle } from "@/lib/crm/contact";

export type FieldSpec = {
  key: string; label: string;
  /** "phone" keeps a full international number; "money" an exact decimal string; "date" YYYY-MM-DD. */
  type?: "text" | "email" | "tel" | "phone" | "number" | "money" | "date" | "datetime-local" | "textarea" | "checkbox" | "multi-select";
  required?: boolean; min?: number; max?: number; options?: { id: string; label: string }[]; value?: unknown;
  /** Folded under More details: the essentials come first. */
  more?: boolean;
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
  return <PhoneNumberField isRequired={field.required} label={field.label} onChange={onChange} value={value} />;
}

export function Fields({ fields, values, onChange, notice }: { fields: FieldSpec[]; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void; notice?: ActionSpec["notice"] }) {
  const t = useT();
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
  const [initialValues] = useState<Record<string, unknown>>(() => Object.fromEntries(action.fields.map((f) => { const value = action.initial?.[f.key] ?? f.value ?? (f.type === "multi-select" ? [] : ""); return [f.key, f.type === "datetime-local" ? localDateTime(value) : value]; })));
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
      body[field.key] = field.type === "number" ? Number(value) : field.type === "datetime-local" ? new Date(String(value)).toISOString() : typeof value === "string" ? value.trim() : value;
    }
    const path = typeof action.path === "function" ? action.path(body) : action.path;
    const result = await crmRequest(workspaceId, path, action.method ?? "POST", action.transform ? action.transform(body) : body);
    setSaved(true);
    try { await onSaved(result); onClose(); }
    catch { setFailure(t("Your change was saved, but the screen could not refresh. Close this dialog and refresh the page. Do not submit it again.")); }
  };
  return <FormDialog cancelLabel={saved ? t("Close") : undefined} description={action.description} error={failure || undefined} errorTitle={t("Saved — refresh needed")}
    hideSubmit={saved} isDirty={!saved && JSON.stringify(values) !== JSON.stringify(initialValues)} isSubmitDisabled={Boolean(action.blockedReason)}
    lead={<>{action.blockedReason ? <p role="status">{action.blockedReason}</p> : null}{action.lead?.(values, set)}</>}
    onClose={onClose} onSubmit={submit} size="lg" submitLabel={action.submit ?? t("Save")} submitVariant={action.submitVariant} title={action.title}>
    <fieldset disabled={saved} className={styles.plainFieldset}><Fields fields={action.fields} notice={action.notice} values={values} onChange={(key, value) => set({ [key]: value })} /></fieldset>
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

/** Activities and (for enquiries) assignments in one timeline, newest first (PLM-095). */
export function ActivityPanel({ workspaceId, leadId, partyId, opportunityId, ownerMembershipId, onChanged, assignments = [] }: { workspaceId: string; leadId?: string; partyId?: string; opportunityId?: string; ownerMembershipId?: string | null; onChanged?: () => Promise<void> | void; assignments?: AssignmentEntry[] }) {
  const t = useT();
  const query = new URLSearchParams({ limit: "100", ...(leadId ? { leadId } : opportunityId ? { opportunityId } : partyId ? { partyId } : {}) });
  const resource = useCrmResource<unknown>(workspaceId, `activities?${query}`);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [extra, setExtra] = useState<RecordData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const activities = [...rows(resource.data), ...extra];
  const nextCursor = cursor ?? (resource.data as { nextCursor?: string } | null)?.nextCursor;
  const target = { ...(leadId ? { leadId } : {}), ...(partyId ? { partyId } : {}), ...(opportunityId ? { opportunityId } : {}), ...(ownerMembershipId ? { ownerMembershipId } : {}) };
  return <div className={`${styles.workbench} ${styles.activityPanel}`}>
    <div className={styles.toolbar}><Button size="compact" className={styles.activityAddAction} onPress={() => setAction({ title: t("Add activity"), description: t("A saved note or scheduled call is an internal record. Complete an outbound call only after the customer interaction actually happened."), path: "activities", initial: { ...target, type: "task", isNextAction: true }, fields: [{ key: "type", label: t("Activity"), options: choice(["task", "call", "meeting", "note"]), required: true }, { key: "title", label: t("Title"), required: true }, { key: "dueAt", label: t("Due (your local time)"), type: "datetime-local" }, { key: "isNextAction", label: t("Make this the next action"), type: "checkbox" }, { key: "description", label: t("Notes"), type: "textarea" }], transform: (v) => { if (v.type === "note") { v.isNextAction = false; v.interactionDirection = "internal"; } if (v.type === "call") v.interactionDirection = "outbound"; if (v.isNextAction && !v.dueAt) throw new Error(t("Choose a due date for the next action.")); return v; } })}><Plus aria-hidden="true" size={14} />{t("Add activity")}</Button></div>
    <ResourceState {...resource} retry={resource.refresh} />
    {!resource.loading && !resource.failure && !activities.length && !assignments.length ? <p className={styles.empty}>{t("No activities yet. Schedule a follow-up or record a note.")}</p> : null}
    {timelineOf(activities, assignments).map((entry) => entry.kind === "assignment" ? <div className={styles.timelineAssignment} key={`assignment-${entry.item.id}`}>
      <UserRound aria-hidden="true" size={14} />
      <div><strong>{entry.item.ownerName ? t("Assigned to {name}", { name: entry.item.ownerName }) : t("Returned to the queue")}</strong><small>{label(entry.item.method)} · {dateText(entry.item.at)}</small>{entry.item.reason ? <p>{entry.item.reason}</p> : null}</div>
    </div> : (activity => <div className={styles.row} key={activity.id}><div><strong>{activityTitle(activity, t)}</strong><small>{label(activity.type)}{activity.interactionDirection ? ` · ${label(activity.interactionDirection)}` : ""} · {label(activity.status)} · {dateText(activity.dueAt)}{activity.isNextAction ? ` · ${t("Next action")}` : ""}</small>{activity.description ? <p>{String(activity.description)}</p> : null}</div>{activity.status === "pending" ? <div className={`${styles.actions} ${styles.activityActions}`}><Button size="compact" onPress={() => setAction({ title: t("Reschedule activity"), path: `activities/${activity.id}`, method: "PATCH", initial: { version: activity.version }, fields: [{ key: "dueAt", label: t("New due date"), type: "datetime-local", required: true }] })}><CalendarClock aria-hidden="true" size={14} />{t("Reschedule")}</Button><Button size="compact" variant="primary" onPress={() => setAction({ title: activity.type === "call" ? t("Confirm completed call") : t("Complete activity"), description: activity.type === "call" ? t("Confirm only after a real outbound customer call. This becomes first-response evidence.") : undefined, path: `activities/${activity.id}/complete`, initial: { version: activity.version }, fields: [{ key: "outcome", label: t("Outcome"), required: true }], submit: t("Complete") })}><Check aria-hidden="true" size={14} />{t("Complete")}</Button></div> : <Badge tone="neutral">{label(activity.status)}</Badge>}</div>)(entry.item))}
    {nextCursor && cursor !== "done" ? <Button size="compact" onPress={async () => { try { const result = await crmRequest<{ data: RecordData[]; nextCursor: string | null }>(workspaceId, `activities?${query}&cursor=${encodeURIComponent(nextCursor)}`); setExtra((old) => [...old, ...result.data.filter((row) => !activities.some((a) => a.id === row.id))]); setCursor(result.nextCursor ?? "done"); } catch (error) { setPageError((error as Error).message); } }}>{t("Load more activities")}</Button> : null}
    {pageError ? <p role="alert">{pageError}</p> : null}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={async () => { setExtra([]); setCursor(null); resource.refresh(); await onChanged?.(); }} /> : null}
  </div>;
}

function timelineOf(activities: RecordData[], assignments: AssignmentEntry[]) {
  const when = (activity: RecordData) => Date.parse(String(activity.completedAt ?? activity.createdAt ?? activity.dueAt ?? "")) || 0;
  return [
    ...activities.map((item) => ({ kind: "activity" as const, at: when(item), item })),
    ...assignments.map((item) => ({ kind: "assignment" as const, at: Date.parse(item.at) || 0, item })),
  ].sort((a, b) => b.at - a.at);
}

function RelatedRecords({ workspaceId, partyId, collection }: { workspaceId: string; partyId: string; collection: "opportunities" | "conversations" }) {
  const t = useT();
  const [cursor, setCursor] = useState("");
  const path = `${collection}?partyId=${partyId}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const resource = useCrmResource<{ data: RecordData[]; nextCursor?: string }>(workspaceId, path);
  return <div className={styles.stack}><ResourceState {...resource} retry={resource.refresh} />{resource.data?.data.map((item) => <div className={styles.row} key={item.id}><div><strong>{String(item.title ?? item.subject ?? label(item.channel))}</strong><small>{label(item.status)}</small></div><a className={styles.link} href={`/workspace/crm/${collection}?record=${item.id}`}>{collection === "opportunities" ? t("Open opportunity") : t("Open conversation")}</a></div>)}{resource.data && !resource.data.data.length ? <p>{collection === "opportunities" ? t("No linked opportunities yet.") : t("No linked conversations yet.")}</p> : null}<div className={styles.actions}>{cursor ? <Button size="compact" onPress={() => setCursor("")}>{t("Back to first page")}</Button> : null}{resource.data?.nextCursor ? <Button size="compact" onPress={() => setCursor(resource.data?.nextCursor ?? "")}>{t("Next page")}</Button> : null}</div></div>;
}

/** Every time zone, with one already chosen kept even if the runtime doesn't list it. */
function timeZoneItems(current: string) {
  const zones = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return [...new Set([...(current ? [current] : []), ...zones])].map((id) => ({ id, label: id.replaceAll("_", " ") }));
}

export function CustomerPanel({ workspaceId, partyId, onChanged }: { workspaceId: string; partyId: string; onChanged?: () => Promise<void> | void }) {
  const t = useT();
  useWoddyRecord("customer", partyId, t("Customer profile"));
  const resource = useCrmResource<RecordData>(workspaceId, `parties/${partyId}`);
  const enquiries = useCrmResource<unknown>(workspaceId, `enquiries?partyId=${partyId}&limit=100`);
  const relatedParties = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  const [action, setAction] = useState<ActionSpec | null>(null);
  const party = resource.data;
  const contacts = (party?.contacts ?? []) as RecordData[];
  const addresses = (party?.addresses ?? []) as RecordData[];
  const timeline = clientTimelineItems((party?.clientTimeline ?? []) as ClientTimelineEvent[], String(party?.displayName ?? t("Client")));
  const timelineAccess = party?.clientTimelineAccess as { communications?: boolean; activities?: boolean } | undefined;
  const saved = async () => { resource.refresh(); enquiries.refresh(); relatedParties.refresh(); await onChanged?.(); };
  // In-place edits go through the party's own update with its version (the newest this view saw); a contact through its own.
  const [savedVersion, setSavedVersion] = useState(0);
  const editable = party?.status === "active";
  const update = async (path: string, body: Record<string, unknown>, remember = false) => {
    try {
      const result = await crmRequest<RecordData>(workspaceId, path, "PATCH", body);
      if (remember && result?.version) setSavedVersion(Number(result.version));
      await saved();
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.status === 409) resource.refresh();
      throw cause;
    }
  };
  const updateParty = (body: Record<string, unknown>) => update(`parties/${partyId}`, { version: Math.max(Number(party?.version ?? 0), savedVersion), ...body }, true);
  const primary = (type: string) => contacts.find((contact) => contact.type === type && contact.isPrimary && contact.status !== "archived") ?? contacts.find((contact) => contact.type === type && contact.status !== "archived");
  const email = primary("email");
  const phone = primary("phone");
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const profile = !party ? null : <EditableFieldList className={styles.customerFacts}>
    <EditableField canEdit={editable} display={label(party.lifecycle)} items={["prospect", "customer", "partner", "vendor", "other"].map((id) => ({ id, label: label(id) }))} kind="select" label={t("Lifecycle")}
      onReload={resource.refresh} onSave={(lifecycle) => updateParty({ lifecycle })} value={text(party.lifecycle)} />
    {party.type === "person" ? <>
      <EditableField canEdit={editable} label={t("Given name")} maxLength={120} onReload={resource.refresh} onSave={(givenName) => updateParty({ givenName: givenName || null })} value={text(party.givenName)} />
      <EditableField canEdit={editable} label={t("Family name")} maxLength={120} onReload={resource.refresh} onSave={(familyName) => updateParty({ familyName: familyName || null })} value={text(party.familyName)} />
      <EditableField canEdit={editable} label={t("Job title")} maxLength={160} onReload={resource.refresh} onSave={(jobTitle) => updateParty({ jobTitle: jobTitle || null })} value={text(party.jobTitle)} />
    </> : <>
      <EditableField canEdit={editable} label={t("Legal name")} maxLength={240} onReload={resource.refresh} onSave={(legalName) => updateParty({ legalName: legalName || null })} value={text(party.legalName)} />
      <EditableField canEdit={editable} label={t("Website domain")} maxLength={255} onReload={resource.refresh} onSave={(websiteDomain) => updateParty({ websiteDomain: websiteDomain || null })} value={text(party.websiteDomain)} />
      <EditableField canEdit={editable} label={t("Industry")} maxLength={120} onReload={resource.refresh} onSave={(industry) => updateParty({ industry: industry || null })} value={text(party.industry)} />
    </>}
    {phone ? <EditableField canEdit={editable} countryCode={text(phone.countryCode)} display={text(phone.rawValue ?? phone.value)} isRequired kind="phone" label={t("Phone")} onReload={resource.refresh}
      onSave={(value, { countryCode }) => update(`parties/${partyId}/contact-points/${phone.id}`, { version: phone.version, value, ...(countryCode ? { countryCode } : {}) })} value={text(phone.rawValue ?? phone.value)} /> : null}
    {email ? <EditableField canEdit={editable} isRequired kind="email" label={t("Email")} onReload={resource.refresh}
      onSave={(value) => update(`parties/${partyId}/contact-points/${email.id}`, { version: email.version, value })} value={text(email.rawValue ?? email.value)} /> : null}
    <EditableField canEdit={editable} label={t("Preferred language / locale")} maxLength={35} onReload={resource.refresh} onSave={(preferredLocale) => updateParty({ preferredLocale: preferredLocale || null })} value={text(party.preferredLocale)} />
    <EditableField canEdit={editable} items={timeZoneItems(text(party.preferredTimezone))} kind="select" label={t("Preferred timezone")} onReload={resource.refresh} onSave={(preferredTimezone) => updateParty({ preferredTimezone: preferredTimezone || null })} value={text(party.preferredTimezone)} />
  </EditableFieldList>;
  return <div className={`${styles.workbench} ${styles.customerDetail}`}><ResourceState {...resource} retry={resource.refresh} />{party ? <>
    <div className={styles.toolbar}><div><EditableField canEdit={editable} heading="h3" isRequired label={t("Display name")} maxLength={240} onReload={resource.refresh} onSave={(displayName) => updateParty({ displayName })} value={String(party.displayName)} /><small>{label(party.type)} · {label(party.lifecycle)} · {label(party.status)}</small></div></div>
    {profile}
    <Tabs defaultSelectedKey="timeline" items={[
      { id: "timeline", label: t("Timeline"), panel: <div className={styles.stack}>{timelineAccess && (!timelineAccess.communications || !timelineAccess.activities) ? <Callout title={t("Timeline access is limited")} tone="warning">{t("Some communication or activity records are hidden by your role.")}</Callout> : null}{timeline.length ? <ActivityFeed items={timeline} /> : <EmptyState description={t("Messages, portal decisions and completed client interactions will appear here.")} title={t("No client communication yet")} />}</div> },
      { id: "activity", label: t("Activity"), panel: <ActivityPanel workspaceId={workspaceId} partyId={partyId} /> },
      { id: "opportunities", label: t("Opportunities"), panel: <RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="opportunities" /> },
      { id: "conversations", label: t("Conversations"), panel: <RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="conversations" /> },
      { id: "relationships", label: t("Relationships"), panel: <div className={styles.stack}><p>{t("Connect this person to their organization, consultant, or referring customer.")}</p>{((party.relationships ?? []) as RecordData[]).map((relationship) => <div className={styles.row} key={relationship.id}><div><strong>{String(relationship.fromPartyName)} → {String(relationship.toPartyName)}</strong><small>{label(relationship.type)}{relationship.endedAt ? ` · ${t("Ended")}` : ""}</small></div><div className={styles.actions}><a className={styles.link} href={`/workspace/crm/customers?record=${relationship.fromPartyId === partyId ? relationship.toPartyId : relationship.fromPartyId}`}>{t("Open profile")}</a><Button size="compact" onPress={() => setAction({ title: t("Edit relationship"), path: `relationships/${relationship.id}`, method: "PATCH", initial: { version: relationship.version, label: relationship.label, isPrimary: relationship.isPrimary, endedAt: relationship.endedAt }, fields: [{ key: "label", label: t("Notes") }, { key: "isPrimary", label: t("Primary relationship"), type: "checkbox" }, { key: "endedAt", label: relationship.endedAt ? t("Ended at") : t("End relationship at"), type: "datetime-local" }] })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div></div>)}<ResourceState {...relatedParties} retry={relatedParties.refresh} /><Button size="compact" isDisabled={relatedParties.loading || Boolean(relatedParties.failure)} onPress={() => setAction({ title: t("Add relationship"), path: "relationships", initial: { fromPartyId: partyId }, fields: [{ key: "toPartyId", label: t("Related customer or organization"), options: options(rows(relatedParties.data).filter((item) => item.id !== partyId && item.status === "active"), "displayName"), required: true }, { key: "type", label: t("Relationship"), options: choice(["works_for", "referred_by", "consultant_for", "partner_of"]), required: true }, { key: "label", label: t("Notes") }, { key: "isPrimary", label: t("Primary relationship"), type: "checkbox" }] })}><Plus aria-hidden="true" size={14} />{t("Add relationship")}</Button></div> },
      { id: "contact", label: t("Contact"), panel: <div className={styles.stack}>{contacts.map((contact) => <div className={styles.row} key={contact.id}><div><strong>{String(contact.rawValue ?? contact.value ?? "")}</strong><small>{label(contact.type)}{contact.isPrimary ? ` · ${t("Primary")}` : ""}</small></div><Button size="compact" onPress={() => setAction({ title: t("Edit contact"), path: `parties/${partyId}/contact-points/${contact.id}`, method: "PATCH", initial: { version: contact.version, value: contact.rawValue, isPrimary: contact.isPrimary }, fields: [{ key: "value", label: label(contact.type), type: contact.type === "email" ? "email" : "text", required: true }, { key: "isPrimary", label: t("Primary contact"), type: "checkbox" }] })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div>)}<Button size="compact" onPress={() => setAction({ title: t("Add contact"), path: `parties/${partyId}/contact-points`, fields: [{ key: "type", label: t("Type"), options: choice(["email", "phone"]), required: true }, { key: "value", label: t("Contact details"), required: true }, { key: "isPrimary", label: t("Primary"), type: "checkbox" }] })}><Plus aria-hidden="true" size={14} />{t("Add contact")}</Button></div> },
      { id: "addresses", label: t("Addresses"), panel: <div className={styles.stack}>{addresses.map((address) => <div className={styles.row} key={address.id}><div><strong>{String(address.label ?? t("Address"))}</strong><p>{[address.line1, address.line2, address.locality, address.region, address.postalCode, address.countryCode].filter(Boolean).join(", ")}</p></div><Button size="compact" onPress={() => setAction({ title: t("Edit address"), path: `parties/${partyId}/addresses/${address.id}`, method: "PATCH", initial: { version: address.version, label: address.label, line1: address.line1, line2: address.line2, locality: address.locality, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode, isPrimary: address.isPrimary }, fields: [{ key: "label", label: t("Label") }, { key: "line1", label: t("Street") }, { key: "line2", label: t("Building / suite") }, { key: "locality", label: t("City") }, { key: "region", label: t("State / region") }, { key: "postalCode", label: t("Postal code") }, { key: "countryCode", label: t("Country code (two letters)"), required: true }, { key: "isPrimary", label: t("Primary address"), type: "checkbox" }], transform: (values) => ({ ...values, countryCode: String(values.countryCode).toUpperCase() }) })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div>)}<Button size="compact" onPress={() => setAction({ title: t("Add address"), path: `parties/${partyId}/addresses`, fields: [{ key: "label", label: t("Label") }, { key: "line1", label: t("Street") }, { key: "line2", label: t("Building / suite") }, { key: "locality", label: t("City"), required: true }, { key: "region", label: t("State / region") }, { key: "postalCode", label: t("Postal code") }, { key: "countryCode", label: t("Country code (two letters)"), required: true }, { key: "isPrimary", label: t("Primary address"), type: "checkbox" }], transform: (v) => ({ ...v, countryCode: String(v.countryCode).toUpperCase() }) })}><Plus aria-hidden="true" size={14} />{t("Add address")}</Button></div> },
      { id: "enquiries", label: t("Enquiries"), panel: <div><ResourceState {...enquiries} retry={enquiries.refresh} />{rows(enquiries.data).map((enquiry) => <div className={styles.row} key={enquiry.id}><div><strong>{String(enquiry.title)}</strong><small>{label(enquiry.leadStatus ?? enquiry.status)} · {dateText(enquiry.receivedAt)}</small></div>{enquiry.leadId ? <a className={styles.link} href={`/workspace/crm/leads?lead=${enquiry.leadId}`}>{t("Open enquiry")}</a> : null}</div>)}</div> },
      { id: "consent", label: t("Consent"), panel: <div className={styles.stack}><p>{t("Record the customer’s communication preferences and the evidence they supplied.")}</p>{((party.consents ?? []) as RecordData[]).map((c) => <div className={styles.row} key={c.id}><strong>{label(c.channel)} · {String(c.purpose)}</strong><Badge tone="neutral">{label(c.status)}</Badge></div>)}<Button size="compact" onPress={() => setAction({ title: t("Record consent"), path: `parties/${partyId}/consents`, fields: [{ key: "channel", label: t("Channel"), options: choice(["email", "phone", "whatsapp"]), required: true }, { key: "purpose", label: t("Purpose"), options: choice(["service", "marketing"]), required: true }, { key: "status", label: t("Customer decision"), options: choice(["granted", "denied", "withdrawn"]), required: true }, { key: "evidenceNote", label: t("How and when was this received?"), required: true }], transform: ({ evidenceNote, ...v }) => ({ ...v, evidence: { note: evidenceNote, method: "manual_record" } }) })}><ShieldCheck aria-hidden="true" size={14} />{t("Record consent")}</Button></div> },
      { id: "data", label: t("Record controls"), panel: <div className={styles.stack}>
        <p>{t("Merge duplicates or close records while retaining the CRM audit trail.")}</p>
        <Button size="compact" isDisabled={party.status !== "active" || relatedParties.loading} onPress={() => setAction({ title: t("Merge a duplicate into this record"), description: t("The selected duplicate will be marked as merged and its CRM history will move to this surviving record."), path: "parties/merge", initial: { survivorPartyId: partyId, fieldDecisions: { displayName: "survivor" } }, fields: [{ key: "mergedPartyId", label: t("Duplicate record"), options: options(rows(relatedParties.data).filter((item) => item.id !== partyId && item.status === "active"), "displayName"), required: true }, { key: "reason", label: t("Reason"), required: true }], submit: t("Merge duplicate") })}><GitMerge aria-hidden="true" size={14} />{t("Merge duplicate")}</Button>
        <Button size="compact" isDisabled={party.status !== "active"} onPress={() => setAction({ title: t("Archive customer record"), description: t("Archived records remain available in CRM history and can be included in search and exports."), path: `parties/${partyId}/archive`, initial: { version: party.version }, fields: [{ key: "reason", label: t("Reason"), required: true }], submit: t("Archive record") })}><Archive aria-hidden="true" size={14} />{t("Archive record")}</Button>
        <Button size="compact" variant="danger" isDisabled={party.status !== "active"} onPress={() => setAction({ title: t("Erase private customer data"), description: t("This removes contact details and personal profile data while retaining the anonymous audit record."), path: `parties/${partyId}/privacy-erasure`, initial: { version: party.version }, fields: [{ key: "reason", label: t("Erasure reason"), required: true }, { key: "confirmation", label: t("Type ERASE to confirm"), required: true }], transform: ({ confirmation, ...values }) => { if (confirmation !== "ERASE") throw new Error(t("Type ERASE exactly to confirm privacy erasure.")); return values; }, submit: t("Erase private data") })}><Trash2 aria-hidden="true" size={14} />{t("Privacy erasure")}</Button>
      </div> },
    ]} />
  </> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}</div>;
}
