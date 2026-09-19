"use client";

import { useState, type FormEvent } from "react";
import { Button, Callout, ControlledModalDialog, SelectField, TextInput, TextAreaField } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import type { EnquiryDetails, LeadContact, LeadOptions } from "@/lib/crm/lead-options";
import styles from "./leads-page.module.css";

export type EditableEnquiry = {
  id: string; version: number; reference?: string; title?: string; summary?: string;
  serviceType?: string; details?: EnquiryDetails; party: LeadContact;
};

export function LeadEnquiryForm({ initialData, existing, onClose, onSaved, onDuplicate }: {
  initialData: LeadsPageData; existing?: EditableEnquiry; onClose: () => void;
  onSaved: (leadId: string) => Promise<void>; onDuplicate?: () => void;
}) {
  const options = initialData.leadOptions;
  const [requestId] = useState(() => crypto.randomUUID());
  const [contact, setContact] = useState<LeadContact>(existing?.party ?? { displayName: "" });
  const [title, setTitle] = useState(existing?.title === existing?.reference ? "" : existing?.title ?? "");
  const [serviceType, setServiceType] = useState(existing?.serviceType ?? "not_sure");
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [details, setDetails] = useState<EnquiryDetails>(existing?.details ?? {});
  const [source, setSource] = useState(options?.sources.find(s => s.id === "company")?.id ?? options?.sources[0]?.id ?? "");
  const [channel, setChannel] = useState(options?.channels[source]?.find(c => c.id === "call")?.id ?? options?.channels[source]?.[0]?.id ?? "");
  const [mode, setMode] = useState("manual");
  const [ownerMembershipId, setOwner] = useState("");
  const [queueId, setQueue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [savedId, setSavedId] = useState<string>();
  const set = (key: keyof LeadContact) => (value: string) => setContact(previous => ({ ...previous, [key]: value }));
  const setDetail = (key: keyof EnquiryDetails) => (value: string) => setDetails(previous => ({ ...previous, [key]: value }));
  const formId = existing ? `edit-enquiry-${existing.id}` : "create-crm-lead";
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFailure("");
    try {
      if (savedId) { await onSaved(savedId); return; }
      if (!contact.displayName.trim()) throw new Error("Enter a customer name.");
      if (!existing && mode === "manual" && !ownerMembershipId) throw new Error("Choose a salesperson, automatic routing, or leave unassigned.");
      const enquiryDetails = Object.fromEntries(["location", "customerType", "budgetRange", "campaign", "internalNotes"].map(key => [key, details[key as keyof EnquiryDetails] ?? ""]));
      const body = existing ? { version: existing.version, title, serviceType, summary, party: contact, details: enquiryDetails }
        : { workspaceId: initialData.workspaceId, requestId, ...contact, title, serviceType, summary, source, channel, details: enquiryDetails,
            assignment: { mode, ...(mode === "manual" ? { ownerMembershipId, ...(queueId ? { queueId } : {}) } : {}) } };
      const response = await fetch(existing ? `/api/workspace/crm/data/leads/${existing.id}/details?workspaceId=${initialData.workspaceId}` : "/api/workspace/crm/leads", {
        method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? "The enquiry could not be saved.");
      if (result.status === "duplicate_candidate") { onDuplicate?.(); return; }
      const id = existing?.id ?? result.leadId;
      if (!id) throw new Error("The enquiry was received. Refresh Incoming enquiries to check its status.");
      setSavedId(id); await onSaved(id);
    } catch (error) { setFailure(error instanceof Error ? error.message : "The enquiry could not be saved."); }
    finally { setSaving(false); }
  };
  return <ControlledModalDialog isOpen isDismissable={!saving} onOpenChange={open => { if (!open && !saving) onClose(); }} size="lg"
    title={existing ? "Edit enquiry" : "Add enquiry"} description={existing?.reference ?? "Customer details, enquiry and ownership in one place."}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose} isDisabled={saving}>Cancel</Button><Button form={formId} type="submit" variant="primary" isDisabled={!options} isLoading={saving}>{savedId ? "Refresh enquiry" : existing ? "Save changes" : "Create enquiry"}</Button></div>}>
    <form id={formId} className={styles.leadForm} onSubmit={save}>
      {failure && <Callout title="Enquiry not saved" tone="danger">{failure}</Callout>}
      {!options && <Callout title="Enquiry options unavailable" tone="warning">Refresh Enquiries to load the current configuration.</Callout>}
      <fieldset className={styles.enquiryFields} disabled={saving || Boolean(savedId)}>
        <div className={styles.formColumns}><TextInput isRequired label="Customer name" value={contact.displayName} onChange={set("displayName")} /><TextInput label="Mobile" inputType="tel" value={contact.mobile ?? ""} onChange={set("mobile")} /></div>
        <div className={styles.formColumns}><TextInput label="Email" inputType="email" value={contact.email ?? ""} onChange={set("email")} /><TextInput label="Property location" value={details.location ?? ""} onChange={setDetail("location")} placeholder="Area, emirate or property" /></div>
        <div className={styles.formColumns}><SelectField label="Enquiry type" isRequired items={withExisting(options?.enquiryTypes, serviceType)} selectedKey={serviceType} onSelectionChange={key => key && setServiceType(String(key))} /><SelectField label="Budget range · optional" items={[{ id: "", label: "Not provided" }, ...(options?.budgetRanges ?? [])]} selectedKey={details.budgetRange ?? ""} onSelectionChange={key => setDetail("budgetRange")(String(key ?? ""))} /></div>
        <TextAreaField label="Project description · optional" value={summary} onChange={setSummary} placeholder="What would the customer like to do?" />
        {!existing && <>
          <div className={styles.formColumns}><SelectField label="Source" isRequired items={options?.sources ?? []} selectedKey={source} onSelectionChange={key => { const value = String(key); setSource(value); setChannel(options?.channels[value]?.[0]?.id ?? ""); }} /><SelectField label="Channel" isRequired items={options?.channels[source] ?? []} selectedKey={channel} onSelectionChange={key => key && setChannel(String(key))} /></div>
          <div className={styles.formColumns}><SelectField label="Assignment" items={[{ id: "manual", label: "Choose sales owner" }, { id: "automatic", label: "Use routing rules" }, { id: "unassigned", label: "Leave unassigned" }]} selectedKey={mode} onSelectionChange={key => key && setMode(String(key))} />
            {mode === "manual" ? <SelectField isRequired label="Sales owner" items={initialData.members.filter(member => member.status === "active").map(member => ({ id: member.id, label: member.displayName || member.email }))} selectedKey={ownerMembershipId || null} onSelectionChange={key => setOwner(String(key ?? ""))} /> : <p className={styles.routingHint}>{mode === "automatic" ? "Uses the matching rule or default team and available capacity." : "The enquiry stays visible in Unassigned."}</p>}
          </div>
        </>}
        <details className={styles.moreDetails}>
          <summary>Additional details</summary>
          <div className={styles.leadForm}>
            <TextInput label="Enquiry title · optional" value={title} onChange={setTitle} placeholder="Leave empty to use the enquiry reference" />
            <div className={styles.formColumns}><TextInput label="Company" value={contact.company ?? ""} onChange={set("company")} /><TextInput label="Job position" value={contact.jobPosition ?? ""} onChange={set("jobPosition")} /></div>
            <div className={styles.formColumns}><TextInput label="Phone" inputType="tel" value={contact.phone ?? ""} onChange={set("phone")} /><TextInput label="Website" value={contact.website ?? ""} onChange={set("website")} /></div>
            <TextInput label="Address" value={contact.address ?? ""} onChange={set("address")} />
            <div className={styles.formColumns}>{Boolean(options?.customerTypes.length) && <SelectField label="Customer type" items={[{ id: "", label: "Not provided" }, ...(options?.customerTypes ?? [])]} selectedKey={details.customerType ?? ""} onSelectionChange={key => setDetail("customerType")(String(key ?? ""))} />}<TextInput label="Campaign" value={details.campaign ?? ""} onChange={setDetail("campaign")} /></div>
            {!existing && mode === "manual" && <SelectField label="Sales team · optional" items={[{ id: "", label: "No team selected" }, ...initialData.queues.filter(q => q.status === "active").map(q => ({ id: q.id, label: q.name }))]} selectedKey={queueId} onSelectionChange={key => setQueue(String(key ?? ""))} />}
            <TextAreaField label="Internal notes" value={details.internalNotes ?? ""} onChange={setDetail("internalNotes")} />
          </div>
        </details>
        {!existing && <p className={styles.routingHint}>The enquiry reference is assigned automatically.</p>}
      </fieldset>
    </form>
  </ControlledModalDialog>;
}

function withExisting(options: LeadOptions["enquiryTypes"] | undefined, value: string) {
  return options?.some(item => item.id === value) || !value ? options ?? [] : [...(options ?? []), { id: value, label: value.replaceAll("_", " ") }];
}
