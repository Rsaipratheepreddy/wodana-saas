"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Tabs } from "@/design-system";
import { leadStage, leadStageLabel, leadStageOptions, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { dateText, label, type RecordData } from "@/lib/crm/client";
import { ActionDialog, FactList, ResourceState, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { leadOptionLabel, type EnquiryDetails } from "@/lib/crm/lead-options";
import { RequirementNotes } from "./requirement-notes";
import { useWoddyRecord } from "./woddy-chat";
import styles from "./crm-workbench.module.css";


export function LinkedLeadWorkbench({ leadId, initialData, onChanged }: { leadId: string; initialData: LeadsPageData; onChanged: () => Promise<void> }) {
  const resource = useCrmResource<RecordData>(initialData.workspaceId, `leads/${leadId}`);
  if (!resource.data) return <ResourceState {...resource} retry={resource.refresh} />;
  const enquiry = resource.data.enquiry as RecordData;
  const lead = { ...resource.data, ...enquiry, id: leadId, partyName: enquiry?.partyName ?? "Lead", title: enquiry?.title ?? "Enquiry" } as unknown as CrmLeadListItem;
  return <LeadWorkbench lead={lead} initialData={initialData} onChanged={onChanged} />;
}

export function LeadWorkbench({ lead, initialData, onChanged }: { lead: CrmLeadListItem; initialData: LeadsPageData; onChanged: () => Promise<void> }) {
  useWoddyRecord("lead", lead.id, lead.title);
  const { workspaceId } = initialData;
  const resource = useCrmResource<RecordData>(workspaceId, `leads/${lead.id}`);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const detail = resource.data;
  const live: CrmLeadListItem & Record<string, unknown> = { ...lead, ...detail };
  const version = live.version;
  const qualification = (detail?.qualification ?? []) as Array<{ questionKey: string; value: unknown }>;
  const answers = Object.fromEntries(qualification.map((q) => [q.questionKey, q.value]));
  const opportunities = (detail?.opportunities ?? []) as RecordData[];
  const enquiry = detail?.enquiry as Record<string, unknown> | undefined;
  const enquiryDetails = (enquiry?.details ?? lead.details ?? {}) as EnquiryDetails;
  const contact = enquiryDetails.contact ?? { displayName: lead.partyName };
  const owner = initialData.members.find((m) => m.id === live.ownerMembershipId)?.displayName ?? lead.ownerName;
  const queues = initialData.queues.map((q) => ({ id: q.id, label: q.name }));
  const members = initialData.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, label: m.displayName }));
  const saved = async () => { resource.refresh(); await onChanged(); };
  const active = !["qualified", "disqualified"].includes(String(live.status));
  const qualificationFields: FieldSpec[] = [
    { key: "budget", label: "Budget & currency" }, { key: "timeline", label: "Target timeline" },
    { key: "location", label: "Project location" }, { key: "decision_maker", label: "Decision maker" },
  ];
  return <div className={styles.workbench}>
    <ResourceState {...resource} retry={resource.refresh} />
    <div className={styles.toolbar}><div><h3>{lead.partyName}</h3><p>{String(enquiry?.reference ?? lead.reference ?? "")}{lead.title && lead.title !== (enquiry?.reference ?? lead.reference) ? ` · ${lead.title}` : ""}</p></div><Badge tone="neutral">{leadStageLabel(String(live.status))}</Badge></div>
    <Tabs items={[
      { id: "details", label: "Details", panel: <div className={styles.stack}>
        <FactList facts={[
          ["Enquiry type", leadOptionLabel(initialData.leadOptions?.enquiryTypes, String(enquiry?.serviceType ?? lead.serviceType ?? ""))],
          ["Lead manager", owner ?? "Unassigned"], ["Sales team", initialData.queues.find(q => q.id === live.queueId)?.name ?? "Not assigned"],
          ["Source", leadOptionLabel(initialData.leadOptions?.sources, String(enquiry?.source ?? lead.source))],
          ["Channel", leadOptionLabel(initialData.leadOptions?.channels[String(enquiry?.source ?? lead.source)], String(enquiry?.channel ?? lead.channel))],
          ["Intake method", label(String(enquiry?.intakeMethod ?? lead.intakeMethod ?? "manual"))],
          ["Mobile", String(enquiry?.primaryMobile ?? contact.mobile ?? "Not provided")],
          ["Phone", String(enquiry?.primaryPhone ?? contact.phone ?? "Not provided")], ["Email", String(enquiry?.primaryEmail ?? contact.email ?? "Not provided")],
          ["Property location", enquiryDetails.location || "Not provided"],
          ["Budget range", leadOptionLabel(initialData.leadOptions?.budgetRanges, enquiryDetails.budgetRange)],
          ...(enquiryDetails.customerType ? [["Customer type", leadOptionLabel(initialData.leadOptions?.customerTypes, enquiryDetails.customerType)] as [string,string]] : []),
          ...([['Company', contact.company], ['Job position', contact.jobPosition], ['Website', contact.website], ['Address', contact.address], ['Campaign', enquiryDetails.campaign]] as [string,string | undefined][]).filter((pair): pair is [string,string] => Boolean(pair[1])),
          ["Next follow-up", dateText(live.nextActionAt)], ["Created", dateText(live.createdAt)], ["Last updated", dateText(live.updatedAt)],
          ...qualificationFields.filter(field => answers[field.key]).map(field => [field.label, String(answers[field.key])] as [string,string]),
        ]} />
        {enquiry?.summary ? <div><h4>Project description</h4><p style={{ whiteSpace: "pre-wrap" }}>{String(enquiry.summary)}</p></div> : null}
        {enquiryDetails.internalNotes ? <div><h4>Internal notes</h4><p style={{ whiteSpace: "pre-wrap" }}>{enquiryDetails.internalNotes}</p></div> : null}
        {enquiryDetails.formAnswers?.length ? <details><summary>Form responses</summary><div className={styles.stack}>{enquiryDetails.formAnswers.map(answer => <div key={answer.questionId}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value || "Not provided"}</p></div>)}</div></details> : null}
        {live.disqualificationReason ? <p className={styles.notice}>{String(live.disqualificationReason)}</p> : null}
        {leadStage(String(live.status)) === "qualified" ? <Link className={styles.link} href={`/workspace/pre-projects?search=${encodeURIComponent(lead.title)}`}>Open in Pre-execution</Link> : null}
        <div className={styles.actions}>
        {detail && !opportunities.length ? <Button size="compact" onPress={() => setAction({ title: "Update lead stage", path: `leads/${lead.id}/status`, initial: { version }, fields: [{ key: "status", label: "Stage", options: [...leadStageOptions(String(live.status))], required: true }, { key: "reason", label: "Reason (required for Disqualified)" }], transform: (v) => { if (v.status === "disqualified" && !v.reason) throw new Error("Add a reason for this stage."); return { ...v, ...(live.nextActionAt && !["qualified", "disqualified", "paused"].includes(String(v.status)) ? { nextActionAt: live.nextActionAt } : {}) }; } })}>Update stage</Button> : null}
        <Button size="compact" isDisabled={!detail} onPress={() => setEditing(true)}>Edit details</Button>
        <Button size="compact" isDisabled={!detail} onPress={() => setAction({ title: "Qualification details", path: `leads/${lead.id}/qualification`, method: "PUT", initial: Object.fromEntries(qualificationFields.map(f => [f.key, answers[f.key] ?? ""])), fields: qualificationFields, transform: values => ({ version, values }) })}>Qualification</Button>
        {active && <Button size="compact" isDisabled={!detail} onPress={() => setAction({ title: "Assign lead manager", path: `leads/${lead.id}/assign`, initial: { version, ownerMembershipId: live.ownerMembershipId, queueId: live.queueId }, fields: [{ key: "ownerMembershipId", label: "Lead manager", options: members }, { key: "queueId", label: "Queue", options: queues }, { key: "reason", label: "Assignment reason", required: true }], transform: v => { if (!v.ownerMembershipId && !v.queueId) throw new Error("Choose a lead manager or queue."); return v; } })}>Assign</Button>}
        </div>
      </div> },
      { id: "history", label: "History", panel: <div className={styles.stack}>
        <h4>Assignment history</h4>
        {((detail?.assignments ?? []) as RecordData[]).map(entry => <div key={String(entry.id)}>
          <strong>{entry.explanation && (entry.explanation as RecordData).mode === "unassigned" ? "Left unassigned" : label(String(entry.assignmentMethod))}</strong>
          <p>{initialData.members.find(member => member.id === entry.ownerMembershipId)?.displayName ?? "Unassigned"} · {dateText(entry.assignedAt)}</p>
          {entry.reason ? <p>{String(entry.reason)}</p> : null}
        </div>)}
        <h4>Original enquiry</h4>
        <p>{dateText(enquiry?.receivedAt)} · {label(String(enquiry?.intakeMethod ?? ""))}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{String((enquiry?.originalSubmission as RecordData | undefined)?.summary ?? "No project description provided")}</p>
      </div> },
      { id: "notes", label: "Requirement notes", panel: <RequirementNotes workspaceId={workspaceId} leadId={lead.id} /> },
    ]} />
    {editing && detail ? <LeadEnquiryForm initialData={initialData} existing={{ id: lead.id, version, reference: String(enquiry?.reference ?? lead.reference ?? ""), title: String(enquiry?.title ?? lead.title), summary: String(enquiry?.summary ?? ""), serviceType: String(enquiry?.serviceType ?? lead.serviceType ?? ""), details: enquiryDetails, party: { ...contact, displayName: String(enquiry?.partyName ?? lead.partyName), email: String(enquiry?.primaryEmail ?? contact.email ?? ""), phone: String(enquiry?.primaryPhone ?? contact.phone ?? ""), mobile: String(enquiry?.primaryMobile ?? contact.mobile ?? "") } }} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await saved(); }} /> : null}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={saved} /> : null}
  </div>;
}
