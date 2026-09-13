"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Callout, ControlledModalDialog, SelectField, TextInput, TextAreaField, Checkbox, Tabs } from "@/design-system";
import { crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import styles from "./crm-workbench.module.css";
import { useWoddyRecord } from "./woddy-chat";
import { localDateTime } from "@/lib/crm/calendar";

export type FieldSpec = { key: string; label: string; type?: "text" | "email" | "tel" | "number" | "datetime-local" | "textarea" | "checkbox"; required?: boolean; min?: number; max?: number; options?: { id: string; label: string }[]; value?: unknown };
export type ActionSpec = { title: string; description?: string; blockedReason?: string; path: string | ((values: Record<string, unknown>) => string); method?: string; fields: FieldSpec[]; initial?: Record<string, unknown>; transform?: (values: Record<string, unknown>) => Record<string, unknown>; submit?: string };

export function Fields({ fields, values, onChange }: { fields: FieldSpec[]; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
  return <div className={styles.fields}>{fields.map((field) => <div className={styles.field} key={field.key}>
    {field.options ? <SelectField label={field.label} isRequired={field.required} selectedKey={String(values[field.key] ?? "") || null} onSelectionChange={(key) => onChange(field.key, key === "__none__" ? "" : String(key ?? ""))} items={field.required ? field.options : [{ id: "__none__", label: "None" }, ...field.options]} />
      : field.type === "textarea" ? <TextAreaField label={field.label} maxLength={10000} isRequired={field.required} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />
      : field.type === "checkbox" ? <Checkbox isSelected={Boolean(values[field.key])} onChange={(value) => onChange(field.key, value)}>{field.label}</Checkbox>
      : field.type === "number" || field.type === "datetime-local" ? <label className={styles.nativeField}><span>{field.label}{field.required ? " *" : ""}</span><input type={field.type} required={field.required} min={field.min} max={field.max} step={field.type === "number" ? "any" : undefined} value={String(values[field.key] ?? "")} onChange={(event) => onChange(field.key, event.target.value)} /></label>
      : <TextInput label={field.label} inputType={field.type ?? "text"} maxLength={500} isRequired={field.required} value={String(values[field.key] ?? "")} onChange={(value) => onChange(field.key, value)} />}
  </div>)}</div>;
}

export function ActionDialog({ action, workspaceId, onClose, onSaved }: { action: ActionSpec; workspaceId: string; onClose: () => void; onSaved: (result: RecordData) => Promise<void> | void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(action.fields.map((f) => { const value = action.initial?.[f.key] ?? f.value ?? ""; return [f.key, f.type === "datetime-local" ? localDateTime(value) : value]; })));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const id = useId();
  return <ControlledModalDialog title={action.title} description={action.description} isOpen isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }} size="lg" footer={<div className={styles.actions}><Button isDisabled={busy} onPress={onClose}>{saved ? "Close" : "Cancel"}</Button>{!saved ? <Button form={id} type="submit" variant="primary" isDisabled={Boolean(action.blockedReason)} isLoading={busy}>{action.submit ?? "Save"}</Button> : null}</div>}>
    <form className={styles.form} id={id} onSubmit={async (event) => {
      event.preventDefault(); if (saving.current || saved || action.blockedReason) return; saving.current = true; setBusy(true); setFailure("");
      try {
        const body = { ...action.initial };
        for (const field of action.fields) {
          const value = values[field.key];
          if (field.required && (value === "" || value === undefined || (typeof value === "string" && !value.trim()))) throw new Error(`Enter ${field.label.toLowerCase()}.`);
          if (value === "" || value === undefined) { delete body[field.key]; continue; }
          body[field.key] = field.type === "number" ? Number(value) : field.type === "datetime-local" ? new Date(String(value)).toISOString() : typeof value === "string" ? value.trim() : value;
        }
        const path = typeof action.path === "function" ? action.path(body) : action.path;
        const result = await crmRequest(workspaceId, path, action.method ?? "POST", action.transform ? action.transform(body) : body);
        setSaved(true);
        try { await onSaved(result); onClose(); }
        catch { setFailure("Your change was saved, but the screen could not refresh. Close this dialog and refresh the page. Do not submit it again."); }
      } catch (error) { setFailure(error instanceof Error ? error.message : "The change could not be saved."); }
      finally { saving.current = false; setBusy(false); }
    }}>
      {action.blockedReason ? <p role="status">{action.blockedReason}</p> : null}
      {failure ? <Callout title={saved ? "Saved — refresh needed" : "Could not save"} tone={saved ? "warning" : "danger"}>{failure}</Callout> : null}
      <fieldset disabled={busy || saved} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><Fields fields={action.fields} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} /></fieldset>
    </form>
  </ControlledModalDialog>;
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
  return { data: current?.data ?? null, failure: current?.failure ?? "", loading: Boolean(path && !current), refresh };
}

export function ResourceState({ loading, failure, retry }: { loading: boolean; failure: string; retry: () => void }) {
  return failure ? <Callout title="Could not load this section" tone="warning">{failure} <Button size="compact" onPress={retry}>Retry</Button></Callout> : loading ? <p role="status" className={styles.empty}>Loading…</p> : null;
}

export function FactList({ facts }: { facts: Array<[string, ReactNode]> }) { return <dl className={styles.facts}>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>; }
export const choice = (values: string[]) => values.map((id) => ({ id, label: label(id) }));
export const options = (items: RecordData[], name = "name") => items.map((row) => ({ id: row.id, label: String(row[name] ?? row.title ?? row.displayName ?? row.id) }));

export function ActivityPanel({ workspaceId, leadId, partyId, opportunityId, ownerMembershipId, onChanged }: { workspaceId: string; leadId?: string; partyId?: string; opportunityId?: string; ownerMembershipId?: string | null; onChanged?: () => Promise<void> | void }) {
  const query = new URLSearchParams({ limit: "100", ...(leadId ? { leadId } : opportunityId ? { opportunityId } : partyId ? { partyId } : {}) });
  const resource = useCrmResource<unknown>(workspaceId, `activities?${query}`);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [extra, setExtra] = useState<RecordData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const activities = [...rows(resource.data), ...extra];
  const nextCursor = cursor ?? (resource.data as { nextCursor?: string } | null)?.nextCursor;
  const target = { ...(leadId ? { leadId } : {}), ...(partyId ? { partyId } : {}), ...(opportunityId ? { opportunityId } : {}), ...(ownerMembershipId ? { ownerMembershipId } : {}) };
  return <div className={styles.workbench}>
    <div className={styles.toolbar}><h3>Activities & follow-ups</h3><Button size="compact" onPress={() => setAction({ title: "Add activity", path: "activities", initial: { ...target, type: "task", isNextAction: true }, fields: [{ key: "type", label: "Activity", options: choice(["task", "call", "meeting", "note"]), required: true }, { key: "title", label: "Title", required: true }, { key: "dueAt", label: "Due (your local time)", type: "datetime-local" }, { key: "isNextAction", label: "Make this the next action", type: "checkbox" }, { key: "description", label: "Notes", type: "textarea" }], transform: (v) => { if (v.type === "note") v.isNextAction = false; if (v.isNextAction && !v.dueAt) throw new Error("Choose a due date for the next action."); return v; } })}>Add activity</Button></div>
    <ResourceState {...resource} retry={resource.refresh} />
    {!resource.loading && !resource.failure && !activities.length ? <p className={styles.empty}>No activities yet. Schedule a follow-up or record a note.</p> : null}
    {activities.map((activity) => <div className={styles.row} key={activity.id}><div><strong>{String(activity.title)}</strong><small>{label(activity.type)} · {label(activity.status)} · {dateText(activity.dueAt)}{activity.isNextAction ? " · Next action" : ""}</small>{activity.description ? <p>{String(activity.description)}</p> : null}</div>{activity.status === "pending" ? <div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: "Reschedule activity", path: `activities/${activity.id}`, method: "PATCH", initial: { version: activity.version }, fields: [{ key: "dueAt", label: "New due date", type: "datetime-local", required: true }] })}>Reschedule</Button><Button size="compact" onPress={() => setAction({ title: "Complete activity", path: `activities/${activity.id}/complete`, initial: { version: activity.version }, fields: [{ key: "outcome", label: "Outcome", required: true }], submit: "Complete" })}>Complete</Button></div> : <Badge tone="neutral">{label(activity.status)}</Badge>}</div>)}
    {nextCursor && cursor !== "done" ? <Button size="compact" onPress={async () => { try { const result = await crmRequest<{ data: RecordData[]; nextCursor: string | null }>(workspaceId, `activities?${query}&cursor=${encodeURIComponent(nextCursor)}`); setExtra((old) => [...old, ...result.data.filter((row) => !activities.some((a) => a.id === row.id))]); setCursor(result.nextCursor ?? "done"); } catch (error) { setPageError((error as Error).message); } }}>Load more activities</Button> : null}
    {pageError ? <p role="alert">{pageError}</p> : null}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={async () => { setExtra([]); setCursor(null); resource.refresh(); await onChanged?.(); }} /> : null}
  </div>;
}

function RelatedRecords({ workspaceId, partyId, collection }: { workspaceId: string; partyId: string; collection: "opportunities" | "conversations" }) {
  const [cursor, setCursor] = useState("");
  const path = `${collection}?partyId=${partyId}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const resource = useCrmResource<{ data: RecordData[]; nextCursor?: string }>(workspaceId, path);
  return <div className={styles.stack}><ResourceState {...resource} retry={resource.refresh} />{resource.data?.data.map((item) => <div className={styles.row} key={item.id}><div><strong>{String(item.title ?? item.subject ?? label(item.channel))}</strong><small>{label(item.status)}</small></div><a className={styles.link} href={`/workspace/crm/${collection}?record=${item.id}`}>Open {collection === "opportunities" ? "opportunity" : "conversation"}</a></div>)}{resource.data && !resource.data.data.length ? <p>No linked {collection} yet.</p> : null}<div className={styles.actions}>{cursor ? <Button size="compact" onPress={() => setCursor("")}>Back to first page</Button> : null}{resource.data?.nextCursor ? <Button size="compact" onPress={() => setCursor(resource.data?.nextCursor ?? "")}>Next page</Button> : null}</div></div>;
}

export function CustomerPanel({ workspaceId, partyId, onChanged }: { workspaceId: string; partyId: string; onChanged?: () => Promise<void> | void }) {
  useWoddyRecord("customer", partyId, "Customer profile");
  const resource = useCrmResource<RecordData>(workspaceId, `parties/${partyId}`);
  const enquiries = useCrmResource<unknown>(workspaceId, `enquiries?partyId=${partyId}&limit=100`);
  const relatedParties = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  const [action, setAction] = useState<ActionSpec | null>(null);
  const party = resource.data;
  const contacts = (party?.contacts ?? []) as RecordData[];
  const addresses = (party?.addresses ?? []) as RecordData[];
  const saved = async () => { resource.refresh(); enquiries.refresh(); relatedParties.refresh(); await onChanged?.(); };
  return <div className={styles.workbench}><ResourceState {...resource} retry={resource.refresh} />{party ? <>
    <div className={styles.toolbar}><div><h3>{String(party.displayName)}</h3><small>{label(party.type)} · {label(party.lifecycle)} · {label(party.status)}</small></div><Button size="compact" onPress={() => setAction({ title: "Edit customer profile", path: `parties/${partyId}`, method: "PATCH", initial: { version: party.version, displayName: party.displayName, lifecycle: party.lifecycle, preferredLocale: party.preferredLocale, preferredTimezone: party.preferredTimezone, ...(party.type === "person" ? { givenName: party.givenName, familyName: party.familyName, jobTitle: party.jobTitle } : { legalName: party.legalName, websiteDomain: party.websiteDomain, industry: party.industry }) }, fields: [{ key: "displayName", label: "Display name", required: true }, { key: "lifecycle", label: "Lifecycle", options: choice(["prospect", "customer", "partner", "vendor", "other"]), required: true }, ...(party.type === "person" ? [{ key: "givenName", label: "Given name" }, { key: "familyName", label: "Family name" }, { key: "jobTitle", label: "Job title" }] as FieldSpec[] : [{ key: "legalName", label: "Legal name" }, { key: "websiteDomain", label: "Website domain" }, { key: "industry", label: "Industry" }] as FieldSpec[]), { key: "preferredLocale", label: "Preferred language / locale" }, { key: "preferredTimezone", label: "Preferred timezone" }] })}>Edit profile</Button></div>
    <Tabs defaultSelectedKey="contact" items={[
      { id: "activity", label: "Activity", panel: <ActivityPanel workspaceId={workspaceId} partyId={partyId} /> },
      { id: "opportunities", label: "Opportunities", panel: <RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="opportunities" /> },
      { id: "conversations", label: "Conversations", panel: <RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="conversations" /> },
      { id: "relationships", label: "Relationships", panel: <div className={styles.stack}><p>Connect this person to their organization, consultant, or referring customer.</p>{((party.relationships ?? []) as RecordData[]).map((relationship) => <div className={styles.row} key={relationship.id}><div><strong>{String(relationship.fromPartyName)} → {String(relationship.toPartyName)}</strong><small>{label(relationship.type)}{relationship.endedAt ? " · Ended" : ""}</small></div><div className={styles.actions}><a className={styles.link} href={`/workspace/crm/customers?record=${relationship.fromPartyId === partyId ? relationship.toPartyId : relationship.fromPartyId}`}>Open profile</a><Button size="compact" onPress={() => setAction({ title: "Edit relationship", path: `relationships/${relationship.id}`, method: "PATCH", initial: { version: relationship.version, label: relationship.label, isPrimary: relationship.isPrimary, endedAt: relationship.endedAt }, fields: [{ key: "label", label: "Notes" }, { key: "isPrimary", label: "Primary relationship", type: "checkbox" }, { key: "endedAt", label: relationship.endedAt ? "Ended at" : "End relationship at", type: "datetime-local" }] })}>Edit</Button></div></div>)}<ResourceState {...relatedParties} retry={relatedParties.refresh} /><Button size="compact" isDisabled={relatedParties.loading || Boolean(relatedParties.failure)} onPress={() => setAction({ title: "Add relationship", path: "relationships", initial: { fromPartyId: partyId }, fields: [{ key: "toPartyId", label: "Related customer or organization", options: options(rows(relatedParties.data).filter((item) => item.id !== partyId && item.status === "active"), "displayName"), required: true }, { key: "type", label: "Relationship", options: choice(["works_for", "referred_by", "consultant_for", "partner_of"]), required: true }, { key: "label", label: "Notes" }, { key: "isPrimary", label: "Primary relationship", type: "checkbox" }] })}>Add relationship</Button></div> },
      { id: "contact", label: "Contact", panel: <div className={styles.stack}>{contacts.map((contact) => <div className={styles.row} key={contact.id}><div><strong>{String(contact.rawValue ?? contact.value ?? "")}</strong><small>{label(contact.type)}{contact.isPrimary ? " · Primary" : ""}</small></div><Button size="compact" onPress={() => setAction({ title: "Edit contact", path: `parties/${partyId}/contact-points/${contact.id}`, method: "PATCH", initial: { version: contact.version, value: contact.rawValue, isPrimary: contact.isPrimary }, fields: [{ key: "value", label: label(contact.type), type: contact.type === "email" ? "email" : "text", required: true }, { key: "isPrimary", label: "Primary contact", type: "checkbox" }] })}>Edit</Button></div>)}<Button size="compact" onPress={() => setAction({ title: "Add contact", path: `parties/${partyId}/contact-points`, fields: [{ key: "type", label: "Type", options: choice(["email", "phone"]), required: true }, { key: "value", label: "Contact details", required: true }, { key: "isPrimary", label: "Primary", type: "checkbox" }] })}>Add contact</Button></div> },
      { id: "addresses", label: "Addresses", panel: <div className={styles.stack}>{addresses.map((address) => <div className={styles.row} key={address.id}><div><strong>{String(address.label ?? "Address")}</strong><p>{[address.line1, address.line2, address.locality, address.region, address.postalCode, address.countryCode].filter(Boolean).join(", ")}</p></div><Button size="compact" onPress={() => setAction({ title: "Edit address", path: `parties/${partyId}/addresses/${address.id}`, method: "PATCH", initial: { version: address.version, label: address.label, line1: address.line1, line2: address.line2, locality: address.locality, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode, isPrimary: address.isPrimary }, fields: [{ key: "label", label: "Label" }, { key: "line1", label: "Street" }, { key: "line2", label: "Building / suite" }, { key: "locality", label: "City" }, { key: "region", label: "State / region" }, { key: "postalCode", label: "Postal code" }, { key: "countryCode", label: "Country code (two letters)", required: true }, { key: "isPrimary", label: "Primary address", type: "checkbox" }], transform: (values) => ({ ...values, countryCode: String(values.countryCode).toUpperCase() }) })}>Edit</Button></div>)}<Button size="compact" onPress={() => setAction({ title: "Add address", path: `parties/${partyId}/addresses`, fields: [{ key: "label", label: "Label" }, { key: "line1", label: "Street" }, { key: "line2", label: "Building / suite" }, { key: "locality", label: "City", required: true }, { key: "region", label: "State / region" }, { key: "postalCode", label: "Postal code" }, { key: "countryCode", label: "Country code (two letters)", required: true }, { key: "isPrimary", label: "Primary address", type: "checkbox" }], transform: (v) => ({ ...v, countryCode: String(v.countryCode).toUpperCase() }) })}>Add address</Button></div> },
      { id: "enquiries", label: "Enquiries", panel: <div><ResourceState {...enquiries} retry={enquiries.refresh} />{rows(enquiries.data).map((enquiry) => <div className={styles.row} key={enquiry.id}><div><strong>{String(enquiry.title)}</strong><small>{label(enquiry.leadStatus ?? enquiry.status)} · {dateText(enquiry.receivedAt)}</small></div>{enquiry.leadId ? <a className={styles.link} href={`/workspace/crm/leads?lead=${enquiry.leadId}`}>Open lead</a> : null}</div>)}</div> },
      { id: "consent", label: "Consent", panel: <div className={styles.stack}><p>Record the customer’s communication preferences and the evidence they supplied.</p>{((party.consents ?? []) as RecordData[]).map((c) => <div className={styles.row} key={c.id}><strong>{label(c.channel)} · {String(c.purpose)}</strong><Badge tone="neutral">{label(c.status)}</Badge></div>)}<Button size="compact" onPress={() => setAction({ title: "Record consent", path: `parties/${partyId}/consents`, fields: [{ key: "channel", label: "Channel", options: choice(["email", "phone", "whatsapp"]), required: true }, { key: "purpose", label: "Purpose", options: choice(["service", "marketing"]), required: true }, { key: "status", label: "Customer decision", options: choice(["granted", "denied", "withdrawn"]), required: true }, { key: "evidenceNote", label: "How and when was this received?", required: true }], transform: ({ evidenceNote, ...v }) => ({ ...v, evidence: { note: evidenceNote, method: "manual_record" } }) })}>Record consent</Button></div> },
      { id: "data", label: "Record controls", panel: <div className={styles.stack}><h3>Record controls</h3><p>Merge duplicates or close records while retaining the CRM audit trail.</p><Button size="compact" isDisabled={party.status !== "active" || relatedParties.loading} onPress={() => setAction({ title: "Merge a duplicate into this record", description: "The selected duplicate will be marked as merged and its CRM history will move to this surviving record.", path: "parties/merge", initial: { survivorPartyId: partyId, fieldDecisions: { displayName: "survivor" } }, fields: [{ key: "mergedPartyId", label: "Duplicate record", options: options(rows(relatedParties.data).filter((item) => item.id !== partyId && item.status === "active"), "displayName"), required: true }, { key: "reason", label: "Reason", required: true }], submit: "Merge duplicate" })}>Merge duplicate</Button><Button size="compact" isDisabled={party.status !== "active"} onPress={() => setAction({ title: "Archive customer record", description: "Archived records remain available in CRM history and can be included in search and exports.", path: `parties/${partyId}/archive`, initial: { version: party.version }, fields: [{ key: "reason", label: "Reason", required: true }], submit: "Archive record" })}>Archive record</Button><Button size="compact" isDisabled={party.status !== "active"} onPress={() => setAction({ title: "Erase private customer data", description: "This removes contact details and personal profile data while retaining the anonymous audit record.", path: `parties/${partyId}/privacy-erasure`, initial: { version: party.version }, fields: [{ key: "reason", label: "Erasure reason", required: true }, { key: "confirmation", label: "Type ERASE to confirm", required: true }], transform: ({ confirmation, ...values }) => { if (confirmation !== "ERASE") throw new Error("Type ERASE exactly to confirm privacy erasure."); return values; }, submit: "Erase private data" })}>Privacy erasure</Button></div> },
    ]} />
  </> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}</div>;
}
