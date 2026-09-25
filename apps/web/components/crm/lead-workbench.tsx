"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronDown, Mail, MessageCircle, Phone, UserRound } from "lucide-react";
import { Button, Callout, Tabs, SelectField, TextInput } from "@/design-system";
import { leadStageLabel, leadStageOptions, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { crmRequest, dateText, label, type RecordData } from "@/lib/crm/client";
import { CrmDateTimeField } from "./crm-date-time-field";
import { NewFollowUpDialog } from "./follow-up-editor";
import { ActionDialog, ActivityPanel, FactList, ResourceState, useCrmResource, type ActionSpec } from "./crm-workbench";
import { initialQualificationValues, qualificationAnswerText, qualificationFields, qualificationValues, type QualificationQuestion } from "@/lib/crm/qualification-fields";
import { LeadAssignmentDialog } from "./lead-assignment-dialog";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { hasResolvedEnquiryType, leadOptionLabel, type EnquiryDetails } from "@/lib/crm/lead-options";
import { formatPhoneForDisplay, phoneCountry, whatsappUrl } from "@/lib/crm/phone";
import { customerDisplayName } from "@/lib/crm/customer-name";
import { RecordAttachments } from "./record-attachments";
import { RequirementNotes } from "./requirement-notes";
import { useWoddyRecord } from "./woddy-chat";
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
  const [stageEditing, setStageEditing] = useState(false);
  const [selectedStage, setSelectedStage] = useState("");
  const [activityRevision, setActivityRevision] = useState(0);
  const [scheduling, setScheduling] = useState(false);
  const [assigning, setAssigning] = useState(false);
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
  const needsEnquiryType = !hasResolvedEnquiryType(String(enquiry?.serviceType ?? lead.serviceType ?? ""));
  const attribution = (enquiry?.attribution ?? []) as RecordData[];
  const enquiryDetails = (enquiry?.details ?? lead.details ?? {}) as EnquiryDetails;
  const contact = enquiryDetails.contact ?? { displayName: lead.partyName };
  const owner = live.ownerMembershipId ? initialData.members.find((m) => m.id === live.ownerMembershipId)?.displayName ?? live.ownerName ?? "Assigned owner" : null;
  const saved = async () => { resource.refresh(); setActivityRevision(value => value + 1); await onChanged(); };
  const active = !["qualified", "disqualified"].includes(String(live.status));
  const stageOptions = leadStageOptions(String(live.status)).filter((stage) => stage.id !== "qualified");
  const canCreateDeal = !opportunities.length && !["disqualified", "paused"].includes(String(live.status));
  const primaryPhone = String(enquiry?.primaryMobile ?? enquiry?.primaryPhone ?? contact.mobile ?? contact.phone ?? "").trim();
  const defaultCountry = phoneCountry(contact.phoneCountryCode, initialData.defaultLocale);
  const whatsappLink = [enquiry?.primaryMobile, enquiry?.primaryPhone, contact.mobile, contact.phone]
    .map(value => whatsappUrl(String(value ?? ""), defaultCountry)).find((value): value is string => Boolean(value));
  const primaryEmail = String(enquiry?.primaryEmail ?? contact.email ?? "").trim();
  const openContact = (target: string) => window.open(target, "_blank", "noopener,noreferrer");
  const latestSla = ((detail?.sla ?? []) as RecordData[])[0];
  const enquiryReference = String(enquiry?.reference ?? lead.reference ?? "").trim();
  const enquiryTitle = String(enquiry?.title ?? lead.title ?? "").trim();
  const showEnquiryTitle = Boolean(enquiryTitle && enquiryTitle !== enquiryReference && enquiryTitle.toLowerCase() !== "enquiry");
  const stageTone = live.status === "qualified" ? "success" : live.status === "disqualified" ? "danger" : live.status === "paused" ? "warning" : "info";
  return <div className={`${styles.workbench} ${styles.enquiryDetail}`}>
    <ResourceState {...resource} retry={resource.refresh} />
    <header className={styles.enquirySummary}>
      <div className={styles.enquiryIdentity}>{enquiryReference && <span className={styles.enquiryReference}>{enquiryReference}</span>}<h2>{customerDisplayName(lead.partyName)}</h2>{showEnquiryTitle && <p>{enquiryTitle}</p>}</div>
      <Button size="compact" variant="quiet" isDisabled={!detail} onPress={() => setEditing(true)}>Edit details</Button>
    </header>
    <div className={styles.enquiryProperties}>
      <div className={styles.enquiryProperty} data-tone={stageTone}><small>Stage</small><SelectField label={null} aria-label="Enquiry stage" selectedKey={String(live.status)} items={[{ id: String(live.status), label: leadStageLabel(String(live.status)) }, ...stageOptions.filter(item => item.id !== String(live.status))]} isDisabled={!detail || Boolean(opportunities.length) || !stageOptions.length} onSelectionChange={key => { if (key) { const changed = String(key) !== String(live.status); setSelectedStage(changed ? String(key) : ""); setStageEditing(changed); } }} /></div>
      <div className={styles.enquiryProperty} data-tone="brand"><small>Owner</small><Button size="compact" isDisabled={!detail || !active} onPress={() => setAssigning(true)}><UserRound size={14} aria-hidden="true" /><span>{owner ?? "Assign owner"}</span><ChevronDown size={14} aria-hidden="true" /></Button></div>
      <div className={styles.enquiryProperty} data-tone={live.nextActionAt ? "success" : "neutral"}><small>Next follow-up</small>{live.nextActionAt ? <strong><CalendarDays size={14} aria-hidden="true" />{dateText(live.nextActionAt)}</strong> : active && !live.isConverted ? <Button size="compact" isDisabled={!detail} onPress={() => setScheduling(true)}><CalendarDays size={14} aria-hidden="true" />Schedule</Button> : <strong>Not scheduled</strong>}</div>
    </div>
    {stageEditing && <InlineStageEditor key={`${lead.id}-${version}-${selectedStage}`} initialStage={selectedStage} lead={live} workspaceId={workspaceId} onCancel={() => { setStageEditing(false); setSelectedStage(""); }} onSaved={async () => { await onChanged(); resource.refresh(); setActivityRevision(value => value + 1); setStageEditing(false); setSelectedStage(""); }} />}
    {enquiry?.summary ? <section className={styles.requestSummary}><small>Project description</small><p>{String(enquiry.summary)}</p></section> : null}
    <div className={styles.enquiryColumns}><main><Tabs defaultSelectedKey="details" items={[
      { id: "details", label: "Details", panel: <div className={styles.stack}>
        <FactList facts={[
          ["Enquiry type", leadOptionLabel(initialData.leadOptions?.enquiryTypes, String(enquiry?.serviceType ?? lead.serviceType ?? ""))],
          ["Sales team", initialData.queues.find(q => q.id === live.queueId)?.name ?? "Not assigned"],
          ...(live.ownershipDueAt ? [["Reassign if no call or note", dateText(live.ownershipDueAt)] as [string, string]] : []),
          ["Mobile", formatPhoneForDisplay(String(enquiry?.primaryMobile ?? contact.mobile ?? ""), phoneCountry(contact.mobileCountryCode ?? contact.phoneCountryCode, initialData.defaultLocale))],
          ["Phone", formatPhoneForDisplay(String(enquiry?.primaryPhone ?? contact.phone ?? ""), defaultCountry)], ["Email", String(enquiry?.primaryEmail ?? contact.email ?? "Not provided")],
          ["Emirate", leadOptionLabel(initialData.leadOptions?.emirates, enquiryDetails.emirate)],
          ["Area", initialData.leadOptions?.areas?.[enquiryDetails.emirate ?? ""]?.find(item => item.id === enquiryDetails.area)?.label ?? enquiryDetails.area ?? enquiryDetails.location ?? "Not provided"],
          ["Budget range", leadOptionLabel(initialData.leadOptions?.budgetRanges, enquiryDetails.budgetRange)],
          ...(enquiryDetails.customerType ? [["Customer type", leadOptionLabel(initialData.leadOptions?.customerTypes, enquiryDetails.customerType)] as [string,string]] : []),
          ...([['Company', contact.company], ['Job position', contact.jobPosition], ['Website', contact.website], ['Address', contact.address], ['Campaign', enquiryDetails.campaign]] as [string,string | undefined][]).filter((pair): pair is [string,string] => Boolean(pair[1])),
          ["Created", dateText(live.createdAt)], ["Last updated", dateText(live.updatedAt)],
          ...configuredFields.filter(field => answers[field.key] !== undefined).map(field => [field.label, qualificationAnswerText(answers[field.key])] as [string,string]),
        ]} />
        {enquiryDetails.internalNotes ? <div><h4>Internal notes</h4><p style={{ whiteSpace: "pre-wrap" }}>{enquiryDetails.internalNotes}</p></div> : null}
        {enquiryDetails.formAnswers?.length ? <details><summary>Form responses</summary><div className={styles.stack}>{enquiryDetails.formAnswers.map(answer => <div key={answer.questionId}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value || "Not provided"}</p></div>)}</div></details> : null}
        {live.disqualificationReason ? <p className={styles.notice}>{String(live.disqualificationReason)}</p> : null}
      </div> },
      { id: "response", label: "Activity", panel: <div className={styles.stack}>
        {(primaryPhone || primaryEmail) ? <div className={styles.actions}>
          {primaryPhone && <Button size="compact" onPress={() => openContact(`tel:${primaryPhone.replace(/[^\d+*#,;]/g, "")}`)}><Phone size={14} aria-hidden="true" />Call</Button>}
          {primaryEmail && <Button size="compact" onPress={() => openContact(`mailto:${primaryEmail}`)}><Mail size={14} aria-hidden="true" />Email</Button>}
          {primaryPhone && <Button size="compact" isDisabled={!whatsappLink} onPress={() => { if (whatsappLink) openContact(whatsappLink); }}><MessageCircle size={14} aria-hidden="true" />WhatsApp</Button>}
        </div> : <p className={styles.contactHint}>Add a phone number or email in Edit details to contact this client.</p>}
        {primaryPhone && !whatsappLink ? <p className={styles.contactHint}>This number needs a valid country code before WhatsApp can open. Correct it in Edit details.</p> : null}
        <ActivityPanel key={activityRevision} workspaceId={workspaceId} leadId={lead.id} partyId={lead.partyId} ownerMembershipId={live.ownerMembershipId as string | null} onChanged={saved} />
      </div> },
      { id: "history", label: "Source & history", panel: <div className={styles.stack}>
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
        {latestSla && <p>Response target: {label(latestSla.status)} · {dateText(latestSla.dueAt)}</p>}
        {live.ownershipDueAt && <p>Ownership review: {dateText(live.ownershipDueAt)}</p>}
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
      { id: "attachments", label: "Files", panel: <RecordAttachments workspaceId={workspaceId} leadId={lead.id} /> },
      { id: "notes", label: "Requirements", panel: <RequirementNotes workspaceId={workspaceId} leadId={lead.id} /> },
    ]} /></main></div>
    {(opportunities.length > 0 || (canCreateDeal && onQualify)) && <section className={`${styles.dealNextStep} ${opportunities.length ? "" : styles.dealNextStepSticky}`}>
      {opportunities.length ? <><strong>{opportunities.length === 1 ? "Linked opportunity" : "Linked opportunities"}</strong>{opportunities.map(opportunity => <div key={opportunity.id} className={styles.linkedOpportunity}><Link className={styles.link} href={`/workspace/crm/opportunities?record=${opportunity.id}`}><span className={styles.dealLinkText}>{opportunity.title && String(opportunity.title) !== enquiryReference ? String(opportunity.title) : "Open opportunity"}</span><ArrowUpRight size={13} aria-hidden="true" /></Link>{opportunity.preProjectCaseId && opportunity.dealFileReference ? <Link className={styles.link} href={`/workspace/pre-projects/cases/${opportunity.preProjectCaseId}/approvals`}>Deal File {String(opportunity.dealFileReference)} <ArrowUpRight size={13} aria-hidden="true" /></Link> : null}</div>)}</> : <>
        <div><strong>{needsEnquiryType ? "Choose an enquiry type" : "Ready to move forward?"}</strong><p>{needsEnquiryType ? "Replace Not Sure Yet with the actual enquiry type before qualification or conversion." : qualificationState?.form && !qualificationState.ready ? "Complete qualification before conversion." : "Convert to an opportunity when the client's requirements are clear."}</p></div>
        {questions.length ? <Button size="compact" isDisabled={!detail || live.status === "qualified"} onPress={() => setAction({ title: qualificationState?.form?.name ?? "Qualification", path: `leads/${lead.id}/qualification`, method: "PUT", initial: initialQualificationValues(questions, answers), fields: configuredFields, transform: values => ({ version, values: qualificationValues(questions, values) }) })}>Qualification</Button> : null}
        {detail && canCreateDeal && onQualify ? needsEnquiryType ? <Button size="compact" variant="primary" onPress={() => setEditing(true)}>Edit enquiry type</Button> : <Button size="compact" variant="primary" isDisabled={Boolean(qualificationState?.form && !qualificationState.ready)} onPress={() => onQualify(live)}>Convert to opportunity</Button> : null}
      </>}
    </section>}

    {editing && detail ? <LeadEnquiryForm initialData={initialData} existing={{ id: lead.id, version, reference: String(enquiry?.reference ?? lead.reference ?? ""), title: String(enquiry?.title ?? lead.title), summary: String(enquiry?.summary ?? ""), serviceType: String(enquiry?.serviceType ?? lead.serviceType ?? ""), details: enquiryDetails, party: { ...contact, displayName: String(enquiry?.partyName ?? lead.partyName), email: String(enquiry?.primaryEmail ?? contact.email ?? ""), phone: String(enquiry?.primaryPhone ?? contact.phone ?? ""), mobile: String(enquiry?.primaryMobile ?? contact.mobile ?? "") } }} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await saved(); }} /> : null}
    {scheduling && <NewFollowUpDialog workspaceId={workspaceId} initialLead={{ ...live }} onClose={() => setScheduling(false)} onCreated={async () => { await saved(); setScheduling(false); }} />}
    {assigning && <LeadAssignmentDialog lead={live} members={initialData.members} workspaceId={workspaceId} onClose={() => setAssigning(false)} onSaved={saved} />}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={saved} /> : null}
  </div>;
}

function InlineStageEditor({ initialStage = "", lead, workspaceId, onCancel, onSaved }: { initialStage?: string; lead: CrmLeadListItem; workspaceId: string; onCancel: () => void; onSaved: () => Promise<void> }) {
  const stage = initialStage;
  const inFlight = useRef(false);
  const [persisted, setPersisted] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  return <form className={styles.inlineStageEditor} aria-label="Update enquiry stage" onSubmit={async event => {
    event.preventDefault(); if (inFlight.current || persisted || !stage) return;
    inFlight.current = true;
    setBusy(true); setFailure("");
    try {
      if (stage === "disqualified" && !reason.trim()) throw new Error("Add a reason for disqualifying this enquiry.");
      await crmRequest(workspaceId, `leads/${lead.id}/status`, "POST", { ...(nextDate && !["disqualified", "paused"].includes(stage) ? { nextActionAt: new Date(nextDate).toISOString() } : {}), version: lead.version, status: stage, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(lead.nextActionAt && !["qualified", "disqualified", "paused"].includes(stage) ? { nextActionAt: lead.nextActionAt } : {}) });
      setPersisted(true);
      try { await onSaved(); } catch { setFailure("Stage saved. Refresh the enquiry to see the change."); }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Stage could not be updated."); }
    finally { inFlight.current = false; setBusy(false); }
  }}>
    {failure && <Callout tone={persisted ? "warning" : "danger"} title={persisted ? "Stage saved — refresh needed" : "Stage not updated"}>{failure}</Callout>}
    <strong>Change stage to {leadStageLabel(stage)}</strong>
    {stage && !["disqualified", "paused"].includes(stage) && !lead.ownerMembershipId && !lead.nextActionAt && <CrmDateTimeField label="Next follow-up" isRequired value={nextDate} isDisabled={busy} onChange={setNextDate} />}
    {stage === "disqualified" && <TextInput label="Reason" value={reason} onChange={setReason} isRequired isDisabled={busy} />}
    <div className={styles.actions}><Button size="compact" isDisabled={busy} onPress={onCancel}>Cancel</Button><Button size="compact" type="submit" variant="primary" isDisabled={!stage || persisted} isLoading={busy}>Save stage</Button></div>
  </form>;
}
