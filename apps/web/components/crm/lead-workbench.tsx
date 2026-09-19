"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Callout, Tabs } from "@/design-system";
import { leadStage, leadStageLabel, leadStageOptions, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { dateText, label, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ActivityPanel, FactList, ResourceState, useCrmResource, type ActionSpec } from "./crm-workbench";
import { initialQualificationValues, qualificationAnswerText, qualificationFields, qualificationValues, type QualificationQuestion } from "@/lib/crm/qualification-fields";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { leadOptionLabel, type EnquiryDetails } from "@/lib/crm/lead-options";
import { RequirementNotes } from "./requirement-notes";
import { useWoddyRecord } from "./woddy-chat";
import { WoddyAssist } from "./woddy-assist";
import styles from "./crm-workbench.module.css";


export function LinkedLeadWorkbench({ leadId, initialData, onChanged, onQualify }: { leadId: string; initialData: LeadsPageData; onChanged: () => Promise<void>; onQualify?: (lead: CrmLeadListItem) => void }) {
  const resource = useCrmResource<RecordData>(initialData.workspaceId, `leads/${leadId}`);
  if (!resource.data) return <ResourceState {...resource} retry={resource.refresh} />;
  const enquiry = resource.data.enquiry as RecordData;
  const lead = { ...resource.data, ...enquiry, id: leadId, partyName: enquiry?.partyName ?? "Customer", title: enquiry?.title ?? "Enquiry" } as unknown as CrmLeadListItem;
  return <LeadWorkbench lead={lead} initialData={initialData} onChanged={onChanged} onQualify={onQualify} />;
}

export function LeadWorkbench({ lead, initialData, onChanged, onQualify }: { lead: CrmLeadListItem; initialData: LeadsPageData; onChanged: () => Promise<void>; onQualify?: (lead: CrmLeadListItem) => void }) {
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
  const qualificationState = detail?.qualificationState as { ready: boolean; missingRequired: string[]; form: { name: string; questions: QualificationQuestion[] } | null } | undefined;
  const questions = qualificationState?.form?.questions ?? [];
  const configuredFields = qualificationFields(questions);
  const opportunities = (detail?.opportunities ?? []) as RecordData[];
  const enquiry = detail?.enquiry as Record<string, unknown> | undefined;
  const attribution = (enquiry?.attribution ?? []) as RecordData[];
  const enquiryDetails = (enquiry?.details ?? lead.details ?? {}) as EnquiryDetails;
  const contact = enquiryDetails.contact ?? { displayName: lead.partyName };
  const owner = initialData.members.find((m) => m.id === live.ownerMembershipId)?.displayName ?? lead.ownerName;
  const queues = initialData.queues.map((q) => ({ id: q.id, label: q.name }));
  const members = initialData.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, label: m.displayName }));
  const saved = async () => { resource.refresh(); await onChanged(); };
  const active = !["qualified", "disqualified"].includes(String(live.status));
  const stageOptions = leadStageOptions(String(live.status)).filter((stage) => stage.id !== "qualified");
  const canCreateDeal = !opportunities.length && !["disqualified", "paused"].includes(String(live.status));
  const primaryPhone = String(enquiry?.primaryMobile ?? enquiry?.primaryPhone ?? contact.mobile ?? contact.phone ?? "").trim();
  const primaryEmail = String(enquiry?.primaryEmail ?? contact.email ?? "").trim();
  const openContact = (target: string) => window.open(target, "_blank", "noopener,noreferrer");
  const latestSla = ((detail?.sla ?? []) as RecordData[])[0];
  return <div className={styles.workbench}>
    <ResourceState {...resource} retry={resource.refresh} />
    <div className={styles.toolbar}><div><h3>{lead.partyName}</h3><p>{String(enquiry?.reference ?? lead.reference ?? "")}{lead.title && lead.title !== (enquiry?.reference ?? lead.reference) ? ` · ${lead.title}` : ""}</p></div><Badge tone="neutral">{leadStageLabel(String(live.status))}</Badge></div>
    <Tabs items={[
      { id: "response", label: "Response", panel: <div className={styles.stack}>
        <FactList facts={[
          ["Assigned owner", owner ?? "Unassigned"],
          ["Next action", dateText(live.nextActionAt)],
          ["First-response SLA", latestSla ? `${label(latestSla.status)} · due ${dateText(latestSla.dueAt)}` : "No active SLA"],
          ["Ownership takeover", live.ownershipDueAt ? `Due ${dateText(live.ownershipDueAt)}` : "Not scheduled"],
        ]} />
        <div className={styles.actions}>
          <Button size="compact" isDisabled={!primaryPhone} onPress={() => openContact(`tel:${primaryPhone.replace(/[^\d+*#,;]/g, "")}`)}>Call</Button>
          <Button size="compact" isDisabled={!primaryEmail} onPress={() => openContact(`mailto:${primaryEmail}`)}>Email</Button>
          <Button size="compact" isDisabled={!primaryPhone} onPress={() => openContact(`https://wa.me/${primaryPhone.replace(/\D/g, "")}`)}>WhatsApp</Button>
        </div>
        <Callout title="Contact action is not delivery proof">Opening the phone, email or WhatsApp app does not mark this enquiry as answered. Complete an outbound call activity after a real conversation, or use Inbox for provider-tracked message status.</Callout>
        <WoddyAssist leadId={lead.id} workspaceId={workspaceId} />
        <ActivityPanel workspaceId={workspaceId} leadId={lead.id} partyId={lead.partyId} ownerMembershipId={live.ownerMembershipId as string | null} onChanged={saved} />
      </div> },
      { id: "details", label: "Details", panel: <div className={styles.stack}>
        <FactList facts={[
          ["Enquiry type", leadOptionLabel(initialData.leadOptions?.enquiryTypes, String(enquiry?.serviceType ?? lead.serviceType ?? ""))],
          ["Sales owner", owner ?? "Unassigned"], ["Sales team", initialData.queues.find(q => q.id === live.queueId)?.name ?? "Not assigned"],
          ...(live.ownershipDueAt ? [["Reassign if no call or note", dateText(live.ownershipDueAt)] as [string, string]] : []),
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
          ...configuredFields.filter(field => answers[field.key] !== undefined).map(field => [field.label, qualificationAnswerText(answers[field.key])] as [string,string]),
        ]} />
        {enquiry?.summary ? <div><h4>Project description</h4><p style={{ whiteSpace: "pre-wrap" }}>{String(enquiry.summary)}</p></div> : null}
        {enquiryDetails.internalNotes ? <div><h4>Internal notes</h4><p style={{ whiteSpace: "pre-wrap" }}>{enquiryDetails.internalNotes}</p></div> : null}
        {enquiryDetails.formAnswers?.length ? <details><summary>Form responses</summary><div className={styles.stack}>{enquiryDetails.formAnswers.map(answer => <div key={answer.questionId}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value || "Not provided"}</p></div>)}</div></details> : null}
        {live.disqualificationReason ? <p className={styles.notice}>{String(live.disqualificationReason)}</p> : null}
        {leadStage(String(live.status)) === "qualified" ? <Link className={styles.link} href={`/workspace/pre-projects?search=${encodeURIComponent(lead.title)}`}>Open in Pre-execution</Link> : null}
        <div className={styles.actions}>
        {detail && !opportunities.length && stageOptions.length ? <Button size="compact" onPress={() => setAction({ title: "Update enquiry stage", path: `leads/${lead.id}/status`, initial: { version }, fields: [{ key: "status", label: "Stage", options: stageOptions, required: true }, { key: "reason", label: "Reason (required for Disqualified)" }], transform: (v) => { if (v.status === "disqualified" && !v.reason) throw new Error("Add a reason for this stage."); return { ...v, ...(live.nextActionAt && !["qualified", "disqualified", "paused"].includes(String(v.status)) ? { nextActionAt: live.nextActionAt } : {}) }; } })}>Update stage</Button> : null}
        {detail && canCreateDeal && onQualify ? <Button size="compact" variant="primary" isDisabled={Boolean(qualificationState?.form && !qualificationState.ready)} onPress={() => onQualify(live)}>{live.status === "qualified" ? "Create opportunity" : "Qualify & create opportunity"}</Button> : null}
        <Button size="compact" isDisabled={!detail} onPress={() => setEditing(true)}>Edit details</Button>
        {questions.length ? <Button size="compact" isDisabled={!detail || live.status === "qualified"} onPress={() => setAction({ title: qualificationState?.form?.name ?? "Qualification", path: `leads/${lead.id}/qualification`, method: "PUT", initial: initialQualificationValues(questions, answers), fields: configuredFields, transform: values => ({ version, values: qualificationValues(questions, values) }) })}>Qualification</Button> : null}
        {active && <Button size="compact" isDisabled={!detail} onPress={() => setAction({ title: "Assign sales owner", path: `leads/${lead.id}/assign`, initial: { version, ownerMembershipId: live.ownerMembershipId, queueId: live.queueId }, fields: [{ key: "ownerMembershipId", label: "Sales owner", options: members }, { key: "queueId", label: "Queue", options: queues }, { key: "reason", label: "Assignment reason", required: true }], transform: v => { if (!v.ownerMembershipId && !v.queueId) throw new Error("Choose a sales owner or queue."); return v; } })}>Assign</Button>}
        </div>
        {qualificationState?.form && !qualificationState.ready ? <p className={styles.notice}>Complete required qualification questions before creating an opportunity.</p> : null}
      </div> },
      { id: "history", label: "Provenance", panel: <div className={styles.stack}>
        <FactList facts={[
          ["Source", leadOptionLabel(initialData.leadOptions?.sources, String(enquiry?.source ?? lead.source))],
          ["Channel", leadOptionLabel(initialData.leadOptions?.channels[String(enquiry?.source ?? lead.source)], String(enquiry?.channel ?? lead.channel))],
          ["Intake method", label(String(enquiry?.intakeMethod ?? lead.intakeMethod ?? "manual"))],
          ["Received", dateText(enquiry?.receivedAt)],
          ["Processed", dateText(enquiry?.processedAt)],
          ["External reference", String(enquiry?.externalEventId ?? "Not supplied")],
          ["Correlation reference", String(enquiry?.correlationId ?? "Not supplied")],
        ]} />
        <h4>Attribution</h4>
        {attribution.length ? attribution.map((touch) => <div className={styles.row} key={String(touch.id)}><div><strong>{label(String(touch.source))}</strong><small>{[touch.medium ? label(String(touch.medium)) : null, touch.campaign, touch.content].filter(Boolean).map(String).join(" · ") || "Direct attribution"} · {dateText(touch.touchedAt)}</small>{touch.referrer ? <p>{String(touch.referrer)}</p> : null}</div></div>) : <p className={styles.empty}>No campaign attribution was supplied.</p>}
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
