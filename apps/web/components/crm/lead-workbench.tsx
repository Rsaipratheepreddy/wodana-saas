"use client";

import { useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronDown, CircleDot, Globe, Mail, MessageCircle, Pencil, Phone, PhoneCall, UserRound } from "lucide-react";
import { Button, Callout, EditableField, EditableFieldList, FactRow, Form, IconMenuButton, SelectField, TextInput, useDesignSystem } from "@/design-system";
import { leadStageLabel, leadStageOptions, salesOwnerChoices, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { CrmRequestError, crmRequest, dateText, label, type RecordData } from "@/lib/crm/client";
import { zonedDateTimeToIso } from "@/lib/crm/zoned-time";
import { CrmDateTimeField } from "./crm-date-time-field";
import { NewFollowUpDialog } from "./follow-up-editor";
import { ActionDialog, ActivityPanel, ResourceState, useCrmResource, type ActionSpec } from "./crm-workbench";
import { NextStepCard, RecordColumns, RecordFrame, RecordHeader, RecordPanel, RecordStrip, SideSection, StripItem } from "./record/record-layout";
import { initialQualificationValues, qualificationAnswerText, qualificationFields, qualificationValues, type QualificationQuestion } from "@/lib/crm/qualification-fields";
import { LeadAssignmentDialog } from "./lead-assignment-dialog";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { hasResolvedEnquiryType, leadOptionLabel, TEAM_NOT_APPLICABLE, type EnquiryDetails, type LeadContact, type LeadTeamEntry } from "@/lib/crm/lead-options";
import { problemText, teamRoleLabel } from "@/lib/crm/enquiry-requirements";
import type { SaveProblem } from "@/design-system";
import { formatPhoneForDisplay, phoneCountry, whatsappUrl } from "@/lib/crm/phone";
import { customerDisplayName } from "@/lib/crm/customer-name";
import { RecordAttachments } from "./record-attachments";
import { RequirementNotes } from "./requirement-notes";
import { useWoddyRecord } from "./woddy-chat";
import styles from "./crm-workbench.module.css";
import { LogContactDialog } from "./log-contact-dialog";
import { ChangeHistory } from "./change-history";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { customValueText, enquiryFields, isShown } from "@/lib/crm/enquiry-fields";
import type { ClientMatch } from "@/lib/crm/client-match";
import { ClientMatchList } from "./client-match-list";
import { RespondByChip, useNow } from "./respond-by-chip";


type OpenRecord = (href: string) => void;

export function LinkedLeadWorkbench({ leadId, initialData, onChanged, onQualify, onOpenRecord }: { leadId: string; initialData: LeadsPageData; onChanged: () => Promise<void>; onQualify?: (lead: CrmLeadListItem) => void; onOpenRecord?: OpenRecord }) {
  const t = useT();
  const resource = useCrmResource<RecordData>(initialData.workspaceId, `leads/${leadId}`);
  if (!resource.data) return <ResourceState {...resource} retry={resource.refresh} />;
  const enquiry = resource.data.enquiry as RecordData;
  const lead = { ...resource.data, ...enquiry, id: leadId, partyName: enquiry?.partyName ?? t("Customer"), title: enquiry?.title ?? t("Enquiry") } as unknown as CrmLeadListItem;
  return <LeadWorkbench lead={lead} initialData={initialData} onChanged={onChanged} onQualify={onQualify} onOpenRecord={onOpenRecord} />;
}

/** `onOpenRecord` leaves for a linked record once the sheet is closed; navigating with the sheet open leaves its modal blocking the next page. */
export function LeadWorkbench({ lead, initialData, onChanged, onQualify, onOpenRecord }: { lead: CrmLeadListItem; initialData: LeadsPageData; onChanged: () => Promise<void>; onQualify?: (lead: CrmLeadListItem) => void; onOpenRecord?: OpenRecord }) {
  useWoddyRecord("lead", lead.id, lead.title);
  const t = useT();
  const zoned = useDesignSystem();
  const { workspaceId } = initialData;
  const [contacting, setContacting] = useState(false);
  const resource = useCrmResource<RecordData>(workspaceId, `leads/${lead.id}`);
  const [editing, setEditing] = useState<"edit" | "complete" | false>(false);
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
  const openRecord = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenRecord || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onOpenRecord(event.currentTarget.getAttribute("href") ?? "");
  };
  const enquiry = detail?.enquiry as Record<string, unknown> | undefined;
  const needsEnquiryType = !hasResolvedEnquiryType(String(enquiry?.serviceType ?? lead.serviceType ?? ""));
  const attribution = (enquiry?.attribution ?? []) as RecordData[];
  const enquiryDetails = (enquiry?.details ?? lead.details ?? {}) as EnquiryDetails;
  // PLM-096: what the enquiry type still needs before converting; PLM-100: the team tagged on it, per the type's roles.
  const conversion = (detail?.conversion ?? null) as { ready: boolean; missing: SaveProblem[] } | null;
  const conversionMissing = conversion && !conversion.ready ? conversion.missing : [];
  const team = (detail?.team ?? []) as LeadTeamEntry[];
  const teamRoles = [...new Set([...((detail?.teamRoles ?? []) as string[]), ...team.map((entry) => entry.role)])];
  // PLM-024: the notes come only to those who may read them.
  const notesVisible = detail?.notesVisible !== false;
  const fieldList = enquiryFields(initialData.enquiryFields, "");
  const shownField = (key: string) => isShown(fieldList, key);
  const ownFields = fieldList.filter((field) => field.custom && field.visible);
  const contact = enquiryDetails.contact ?? { displayName: lead.partyName };
  const owner = live.ownerMembershipId ? initialData.members.find((m) => m.id === live.ownerMembershipId)?.displayName ?? live.ownerName ?? t("Assigned owner") : null;
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
  const now = useNow(60_000);
  // S-3: the existing clients this enquiry's client may be.
  const clientMatches = (detail?.clientMatches ?? []) as ClientMatch[];
  const [confirming, setConfirming] = useState("");
  const [confirmFailure, setConfirmFailure] = useState("");
  const confirmClient = async (decision: "same" | "different", partyId?: string) => {
    setConfirming(partyId ?? decision); setConfirmFailure("");
    try {
      await crmRequest(workspaceId, `leads/${lead.id}/confirm-client`, "POST", { version, decision, ...(partyId ? { partyId } : {}) });
      await saved();
    } catch (error) { setConfirmFailure(error instanceof Error ? error.message : t("The client could not be confirmed.")); }
    finally { setConfirming(""); }
  };
  // In place: each change sends the enquiry's details whole (as Edit details does) with the newest version this view saw.
  const [savedVersion, setSavedVersion] = useState(0);
  const canEdit = Boolean(detail) && initialData.canEdit !== false;
  // The client's name and phones are their identity: Sales sees them with a lock; Sales admins change them.
  const identityLocked = canEdit && initialData.canChangeIdentity === false;
  const identityLock = identityLocked ? t("Only Sales admins can change the client's name or phone") : undefined;
  const text = (value: unknown) => typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  const saveDetails = async (change: { serviceType?: string; summary?: string; party?: Partial<LeadContact>; details?: Partial<EnquiryDetails>; team?: Array<{ role: string; membershipId?: string | null; notApplicable?: boolean }> }) => {
    const party = { ...contact, displayName: text(enquiry?.partyName ?? lead.partyName), email: text(enquiry?.primaryEmail ?? contact.email), phone: text(enquiry?.primaryPhone ?? contact.phone), mobile: text(enquiry?.primaryMobile ?? contact.mobile), ...change.party };
    const details = Object.fromEntries((["emirate", "area", "location", "customerType", "budgetRange", "campaign", "internalNotes"] as const).map((key) => [key, text(change.details && key in change.details ? change.details[key] : enquiryDetails[key])]));
    try {
      const result = await crmRequest<RecordData>(workspaceId, `leads/${lead.id}/details`, "PATCH", {
        version: Math.max(Number(version ?? 0), savedVersion), serviceType: change.serviceType ?? text(enquiry?.serviceType ?? lead.serviceType), summary: change.summary ?? text(enquiry?.summary), party, details, ...(change.team ? { team: change.team } : {}) });
      if (result?.version) setSavedVersion(Number(result.version));
      await saved();
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.status === 409) resource.refresh();
      throw cause;
    }
  };
  const options = initialData.leadOptions;
  const areaOptions = options?.areas?.[enquiryDetails.emirate ?? ""] ?? [];
  const regionLabel = t(administrativeAreaLabel(countryFromLocale(initialData.defaultLocale)) as never);
  const withCurrent = (items: Array<{ id: string; label: string }> | undefined, current: string | undefined) => items?.some((item) => item.id === current) || !current ? items ?? [] : [...(items ?? []), { id: current, label: current.replaceAll("_", " ") }];
  const phoneText = (value: unknown, country?: string) => text(value) ? formatPhoneForDisplay(text(value), phoneCountry(country ?? contact.phoneCountryCode, initialData.defaultLocale)) : undefined;
  const enquiryReference = String(enquiry?.reference ?? lead.reference ?? "").trim();
  const enquiryTitle = String(enquiry?.title ?? lead.title ?? "").trim();
  const showEnquiryTitle = Boolean(enquiryTitle && enquiryTitle !== enquiryReference && enquiryTitle.toLowerCase() !== "enquiry");
  // The next step: confirm who the client is, then contact, qualify and convert; once converted, its opportunities.
  const canContact = active && !live.isConverted;
  const nextStep = opportunities.length
    ? <NextStepCard title={opportunities.length === 1 ? t("Linked opportunity") : t("Linked opportunities")} tour="enquiry-next-step">
      <ul className={styles.linkedOpportunities}>{opportunities.map(opportunity => <li key={opportunity.id} className={styles.linkedOpportunity}><Link className={styles.link} href={`/workspace/crm/opportunities?record=${opportunity.id}`} onClick={openRecord}><span className={styles.dealLinkText}>{opportunity.title && String(opportunity.title) !== enquiryReference ? String(opportunity.title) : t("Open opportunity")}</span><ArrowUpRight size={13} aria-hidden="true" /></Link>{opportunity.preProjectCaseId && opportunity.dealFileReference ? <Link className={styles.link} href={`/workspace/pre-projects/cases/${opportunity.preProjectCaseId}/approvals`} onClick={openRecord}>{t("Deal File {reference}", { reference: String(opportunity.dealFileReference) })} <ArrowUpRight size={13} aria-hidden="true" /></Link> : null}</li>)}</ul>
    </NextStepCard>
    : canContact || (canCreateDeal && onQualify) ? <NextStepCard tour="enquiry-next-step"
      title={needsEnquiryType ? t("Choose an enquiry type") : conversionMissing.length ? t("Before converting") : t("Ready to move forward?")}
      why={needsEnquiryType ? t("Replace Not Sure Yet with the actual enquiry type before qualification or conversion.") : conversionMissing.length ? undefined : qualificationState?.form && !qualificationState.ready ? t("Complete qualification before conversion.") : t("Convert to an opportunity when the client's requirements are clear.")}
      meta={<>
        {canContact ? <Button size="compact" variant={canCreateDeal && onQualify ? "secondary" : "primary"} isDisabled={!detail} onPress={() => setContacting(true)}><PhoneCall size={14} aria-hidden="true" />{t("Log contact")}</Button> : null}
        {questions.length && canCreateDeal ? <Button size="compact" isDisabled={!detail || live.status === "qualified"} onPress={() => setAction({ title: qualificationState?.form?.name ?? t("Qualification"), path: `leads/${lead.id}/qualification`, method: "PUT", initial: initialQualificationValues(questions, answers), fields: configuredFields, transform: values => ({ version, values: qualificationValues(questions, values) }) })}>{t("Qualification")}</Button> : null}
        {detail && canCreateDeal && onQualify ? needsEnquiryType ? <Button size="compact" variant="primary" onPress={() => setEditing("edit")}>{t("Edit enquiry type")}</Button>
          : conversionMissing.length ? <Button size="compact" variant="primary" onPress={() => setEditing("complete")}>{t("Complete details")}</Button>
          : <Button size="compact" variant="primary" isDisabled={Boolean(qualificationState?.form && !qualificationState.ready)} onPress={() => onQualify(live)}>{t("Convert to opportunity")}</Button> : null}
      </>}>
      {!needsEnquiryType && conversionMissing.length ? <ul className={styles.beforeConverting} aria-label={t("Before converting")}>{conversionMissing.map((item) => <li key={item.key}>{problemText(item, t, { regionLabel })}</li>)}</ul> : null}
      {canContact ? (primaryPhone || primaryEmail) ? <div className={styles.contactActions}>
        {primaryPhone && <Button size="compact" variant="quiet" onPress={() => openContact(`tel:${primaryPhone.replace(/[^\d+*#,;]/g, "")}`)}><Phone size={14} aria-hidden="true" />{t("Call")}</Button>}
        {primaryPhone && <Button size="compact" variant="quiet" isDisabled={!whatsappLink} onPress={() => { if (whatsappLink) openContact(whatsappLink); }}><MessageCircle size={14} aria-hidden="true" />{t("WhatsApp")}</Button>}
        {primaryEmail && <Button size="compact" variant="quiet" onPress={() => openContact(`mailto:${primaryEmail}`)}><Mail size={14} aria-hidden="true" />{t("Email")}</Button>}
        {primaryPhone && !whatsappLink ? <span className={styles.contactHint}>{t("This number needs a valid country code before WhatsApp can open. Correct it in Edit details.")}</span> : null}
      </div> : <p className={styles.contactHint}>{t("Add a phone number or email in Edit details to contact this client.")}</p> : null}
    </NextStepCard> : null;
  const menu = !live.isConverted && !live.spamAt ? [{ id: "spam", label: t("Mark as spam"), tone: "danger" as const }] : [];
  const sourceFacts: Array<[string, string]> = [
    [t("Source"), leadOptionLabel(initialData.leadOptions?.sources, String(enquiry?.source ?? lead.source))],
    [t("Channel"), leadOptionLabel(initialData.leadOptions?.channels[String(enquiry?.source ?? lead.source)], String(enquiry?.channel ?? lead.channel))],
    ...(enquiry?.originalSource ? [[t("Chosen at intake"), `${leadOptionLabel(initialData.leadOptions?.sources, String(enquiry.originalSource))} · ${leadOptionLabel(initialData.leadOptions?.channels[String(enquiry.originalSource)], String(enquiry.originalChannel ?? ""))}`] as [string, string]] : []),
    ...(enquiry?.referral ? [[t("Referred by"), referralText(enquiry.referral as Referral, t, initialData.leadOptions)] as [string, string]] : []),
    [t("Intake method"), label(String(enquiry?.intakeMethod ?? lead.intakeMethod ?? "manual"))],
    [t("Received"), dateText(enquiry?.receivedAt, zoned)],
    [t("Processed"), dateText(enquiry?.processedAt, zoned)],
    [t("External reference"), String(enquiry?.externalEventId ?? t("Not supplied"))],
    [t("Correlation reference"), String(enquiry?.correlationId ?? t("Not supplied"))],
  ];
  return <RecordFrame className={styles.workbench} tour="enquiry-detail">
    <ResourceState {...resource} retry={resource.refresh} />
    <RecordHeader title={<EditableField canEdit={canEdit && !identityLocked} lockedReason={identityLock} display={customerDisplayName(text(enquiry?.partyName ?? lead.partyName))} heading="h2" isRequired label={t("Customer name")} maxLength={240} onReload={resource.refresh}
        onSave={(displayName) => saveDetails({ party: { displayName } })} value={text(enquiry?.partyName ?? lead.partyName)} />}
      meta={enquiryReference || showEnquiryTitle || live.slaDueAt ? <>{enquiryReference ? <span className={styles.enquiryReference}>{enquiryReference}</span> : null}{showEnquiryTitle ? <span>{enquiryTitle}</span> : null}<RespondByChip lead={live as { slaStatus?: string | null; slaDueAt?: string | null; slaWarningAt?: string | null }} now={now} /></> : null}
      actions={<>
        <Button size="compact" isDisabled={!detail} onPress={() => setEditing("edit")}><Pencil size={14} aria-hidden="true" />{t("Edit details")}</Button>
        {/* Junk from a form (S-13): closed as spam, out of reports, and the contact blocked. */}
        {menu.length ? <IconMenuButton ariaLabel={t("More actions")} items={detail ? menu : []} onAction={() => setAction({ title: t("Mark as spam"), path: `leads/${lead.id}/spam`, method: "POST", submit: t("Mark as spam"),
          description: t("This closes the enquiry as spam and blocks the number, unless the client has other work with you."), submitVariant: "danger",
          fields: [], transform: () => ({ version }) })} /> : null}
      </>} />
    <RecordStrip label={t("Enquiry properties")} tour="enquiry-properties">
      <StripItem icon={<CircleDot size={14} aria-hidden="true" />} label={t("Stage")}><SelectField label={null} aria-label={t("Enquiry stage")} selectedKey={String(live.status)} items={[{ id: String(live.status), label: live.isConverted || opportunities.length ? t("Converted") : t(leadStageLabel(String(live.status))) }, ...stageOptions.filter(item => item.id !== String(live.status)).map(item => ({ ...item, label: t(item.label) }))]} isDisabled={!detail || Boolean(opportunities.length) || !stageOptions.length} onSelectionChange={key => { if (key) { const changed = String(key) !== String(live.status); setSelectedStage(changed ? String(key) : ""); setStageEditing(changed); } }} /></StripItem>
      <StripItem icon={<UserRound size={14} aria-hidden="true" />} label={t("Owner")}><Button size="compact" variant="quiet" isDisabled={!detail || !active} onPress={() => setAssigning(true)}><span>{owner ?? t("Assign owner")}</span><ChevronDown size={14} aria-hidden="true" /></Button></StripItem>
      <StripItem icon={<CalendarDays size={14} aria-hidden="true" />} label={t("Next follow-up")}>{live.nextActionAt ? <span>{dateText(live.nextActionAt, zoned)}</span> : active && !live.isConverted ? <Button size="compact" variant="quiet" isDisabled={!detail} onPress={() => setScheduling(true)}>{t("Schedule")}</Button> : <span>{t("Not scheduled")}</span>}</StripItem>
      <StripItem icon={<Globe size={14} aria-hidden="true" />} label={t("Source")}>{leadOptionLabel(initialData.leadOptions?.sources, String(enquiry?.source ?? lead.source))}</StripItem>
    </RecordStrip>
    {stageEditing && <InlineStageEditor key={`${lead.id}-${version}-${selectedStage}`} initialStage={selectedStage} lead={live} workspaceId={workspaceId} onCancel={() => { setStageEditing(false); setSelectedStage(""); }} onSaved={async () => { await onChanged(); resource.refresh(); setActivityRevision(value => value + 1); setStageEditing(false); setSelectedStage(""); }} />}
    {live.status === "duplicate" ? <Callout title={t("Held as a duplicate")} tone="info" actions={<Button size="compact" isDisabled={!detail} onPress={() => setAction({ title: t("Not a duplicate: open as new"), path: `leads/${lead.id}/reopen-duplicate`, method: "POST", submit: t("Open as new"), fields: [{ key: "reason", label: t("Reason"), type: "textarea", required: true }], transform: (values) => ({ version, reason: String(values.reason ?? "").trim() }) })}>{t("Not a duplicate")}</Button>}>{live.duplicateOfLeadId ? <a href={`/workspace/crm/leads?lead=${String(live.duplicateOfLeadId)}`}>{t("Open the original")}</a> : t("This contact already had an open enquiry.")}</Callout> : null}
    {live.disqualificationReason ? <Callout title={t("Disqualified")} tone="neutral">{String(live.disqualificationReason)}</Callout> : null}
    <RecordColumns sideLabel={t("Enquiry details")}
      next={clientMatches.length || nextStep ? <>
        {clientMatches.length ? <NextStepCard title={t("Confirm client")}>
          <ClientMatchList label={t("Possible existing clients")} matches={clientMatches} actions={(match) => <Button size="compact" variant="secondary" isLoading={confirming === match.partyId} isDisabled={Boolean(confirming)} onPress={() => void confirmClient("same", match.partyId)}>{t("Same client")}</Button>} />
          <div><Button size="compact" variant="quiet" isLoading={confirming === "different"} isDisabled={Boolean(confirming)} onPress={() => void confirmClient("different")}>{t("Different person")}</Button></div>
          {confirmFailure ? <Callout title={t("Client not confirmed")} tone="danger">{confirmFailure}</Callout> : null}
        </NextStepCard> : null}
        {nextStep}
      </> : null}
      activity={<ActivityPanel title={t("Activity")} key={activityRevision} workspaceId={workspaceId} leadId={lead.id} partyId={lead.partyId} ownerMembershipId={live.ownerMembershipId as string | null} onChanged={saved}
          assignments={((detail?.assignments ?? []) as RecordData[]).map((entry) => ({ id: String(entry.id), at: String(entry.assignedAt), ownerName: entry.ownerMembershipId ? initialData.members.find((member) => member.id === entry.ownerMembershipId)?.displayName ?? t("A team member") : null, method: entry.explanation && (entry.explanation as RecordData).mode === "unassigned" ? "unassigned" : String(entry.assignmentMethod ?? "manual"), reason: entry.reason ? String(entry.reason) : null }))} />}
      tabs={[
        { id: "overview", label: t("Overview"), panel: <RecordPanel>
          {enquiry?.summary || canEdit ? <EditableFieldList layout="stacked"><EditableField canEdit={canEdit} kind="multiline" label={t("Project description")} maxLength={10000} onReload={resource.refresh}
            onSave={(summary) => saveDetails({ summary })} placeholder={t("What would the customer like to do?")} value={text(enquiry?.summary)} /></EditableFieldList> : null}
          <SideSection title={t("Key facts")}>
            <EditableFieldList>
              <EditableField canEdit={canEdit} display={leadOptionLabel(options?.enquiryTypes, text(enquiry?.serviceType ?? lead.serviceType))} items={withCurrent(options?.enquiryTypes, text(enquiry?.serviceType ?? lead.serviceType))} kind="select" label={t("Enquiry type")}
                onReload={resource.refresh} onSave={(serviceType) => saveDetails({ serviceType })} value={text(enquiry?.serviceType ?? lead.serviceType)} />
              {teamRoles.map((role) => {
                const tagged = team.find((entry) => entry.role === role);
                return <EditableField key={role} canEdit={canEdit && !live.isConverted} kind="select" label={teamRoleLabel(role, t)} placeholder={t("Not tagged")}
                  items={[...initialData.members.filter((member) => member.status === "active").map((member) => ({ id: member.id, label: member.displayName || member.email })), { id: TEAM_NOT_APPLICABLE, label: t("Not applicable") }]}
                  display={tagged ? <>{tagged.notApplicable ? t("Not applicable") : tagged.name}{tagged.setByName ? <small className={styles.contactHint}> · {t("{name} · {date}", { name: tagged.setByName, date: dateText(tagged.setAt, zoned) })}</small> : null}</> : undefined}
                  onReload={resource.refresh} onSave={(choice) => saveDetails({ team: [{ role, ...(choice === TEAM_NOT_APPLICABLE ? { notApplicable: true } : { membershipId: choice || null }) }] })}
                  value={tagged ? (tagged.notApplicable ? TEAM_NOT_APPLICABLE : tagged.membershipId ?? "") : ""} />;
              })}
              <EditableField canEdit={canEdit && !identityLocked} lockedReason={identityLock} countryCode={text(contact.mobileCountryCode ?? contact.phoneCountryCode)} display={phoneText(enquiry?.primaryMobile ?? contact.mobile, contact.mobileCountryCode ?? contact.phoneCountryCode)} isRequired kind="phone" label={t("Mobile")}
                onReload={resource.refresh} onSave={(mobile, { countryCode }) => saveDetails({ party: { mobile, ...(countryCode ? { mobileCountryCode: countryCode } : {}) } })} value={text(enquiry?.primaryMobile ?? contact.mobile)} />
              <EditableField canEdit={canEdit && !(identityLocked && text(enquiry?.primaryPhone ?? contact.phone))} lockedReason={text(enquiry?.primaryPhone ?? contact.phone) ? identityLock : undefined} countryCode={text(contact.phoneCountryCode)} display={phoneText(enquiry?.primaryPhone ?? contact.phone)} kind="phone" label={t("Phone")} placeholder={t("Not provided")}
                onReload={resource.refresh} onSave={(phone, { countryCode }) => saveDetails({ party: { phone, ...(countryCode ? { phoneCountryCode: countryCode } : {}) } })} value={text(enquiry?.primaryPhone ?? contact.phone)} />
              {shownField("email") ? <EditableField canEdit={canEdit} kind="email" label={t("Email")} maxLength={320} onReload={resource.refresh} onSave={(email) => saveDetails({ party: { email } })} placeholder={t("Not provided")} value={text(enquiry?.primaryEmail ?? contact.email)} /> : null}
              {options?.emirates.length || enquiryDetails.emirate ? <EditableField canEdit={canEdit && Boolean(options?.emirates.length)} display={leadOptionLabel(options?.emirates, enquiryDetails.emirate)} isRequired items={withCurrent(options?.emirates, enquiryDetails.emirate)} kind="select" label={regionLabel}
                onReload={resource.refresh} onSave={(emirate) => saveDetails({ details: { emirate, area: "" } })} value={text(enquiryDetails.emirate)} /> : null}
              {shownField("area") ? areaOptions.length
                ? <EditableField canEdit={canEdit} display={areaOptions.find(item => item.id === enquiryDetails.area)?.label ?? enquiryDetails.area ?? enquiryDetails.location} items={[{ id: "", label: t("Not specified") }, ...withCurrent(areaOptions, enquiryDetails.area)]} kind="select" label={t("Area")}
                  onReload={resource.refresh} onSave={(area) => saveDetails({ details: { area } })} placeholder={t("Not provided")} value={text(enquiryDetails.area)} />
                : <EditableField canEdit={canEdit} display={enquiryDetails.area || enquiryDetails.location || undefined} label={t("Area")} maxLength={240} onReload={resource.refresh} onSave={(area) => saveDetails({ details: { area } })} placeholder={t("Not provided")} value={text(enquiryDetails.area)} /> : null}
              {shownField("budgetRange") ? <EditableField canEdit={canEdit} display={enquiryDetails.budgetRange ? leadOptionLabel(options?.budgetRanges, enquiryDetails.budgetRange) : undefined} items={[{ id: "", label: t("Not provided") }, ...withCurrent(options?.budgetRanges, enquiryDetails.budgetRange)]} kind="select" label={t("Budget range")}
                onReload={resource.refresh} onSave={(budgetRange) => saveDetails({ details: { budgetRange } })} placeholder={t("Not provided")} value={text(enquiryDetails.budgetRange)} /> : null}
              {shownField("customerType") && (options?.customerTypes.length || enquiryDetails.customerType) ? <EditableField canEdit={canEdit && Boolean(options?.customerTypes.length)} display={enquiryDetails.customerType ? leadOptionLabel(options?.customerTypes, enquiryDetails.customerType) : undefined} items={withCurrent(options?.customerTypes, enquiryDetails.customerType)} kind="select" label={t("Customer type")}
                onReload={resource.refresh} onSave={(customerType) => saveDetails({ details: { customerType } })} value={text(enquiryDetails.customerType)} /> : null}
              <FactRow label={t("Sales team")}>{initialData.queues.find(q => q.id === live.queueId)?.name ?? t("Not assigned")}</FactRow>
              {live.ownershipDueAt ? <FactRow label={t("Reassign if no call or note")}>{dateText(live.ownershipDueAt, zoned)}</FactRow> : null}
            </EditableFieldList>
          </SideSection>
        </RecordPanel> },
        { id: "details", label: t("Details"), panel: <RecordPanel>
          <SideSection title={t("Requirements")}><RequirementNotes workspaceId={workspaceId} leadId={lead.id} /></SideSection>
          <SideSection title={t("Client")}>
            <EditableFieldList layout="stacked">
              <EditableField canEdit={canEdit} label={t("Company")} maxLength={240} onReload={resource.refresh} onSave={(company) => saveDetails({ party: { company } })} placeholder={t("Not provided")} value={text(contact.company)} />
              <EditableField canEdit={canEdit} label={t("Job position")} maxLength={160} onReload={resource.refresh} onSave={(jobPosition) => saveDetails({ party: { jobPosition } })} placeholder={t("Not provided")} value={text(contact.jobPosition)} />
              <EditableField canEdit={canEdit} kind="url" label={t("Website")} maxLength={255} onReload={resource.refresh} onSave={(website) => saveDetails({ party: { website } })} placeholder={t("Not provided")} value={text(contact.website)} />
              <EditableField canEdit={canEdit} label={t("Address")} maxLength={500} onReload={resource.refresh} onSave={(address) => saveDetails({ party: { address } })} placeholder={t("Not provided")} value={text(contact.address)} />
              {ownFields.map((field) => <FactRow key={field.custom!.id} label={field.label}>{customValueText(lead.customFields?.[field.custom!.id])}</FactRow>)}
              {configuredFields.filter(field => answers[field.key] !== undefined).map(field => <FactRow key={field.key} label={field.label}>{qualificationAnswerText(answers[field.key])}</FactRow>)}
              {notesVisible ? <EditableField canEdit={canEdit} kind="multiline" label={t("Internal notes")} maxLength={10000} onReload={resource.refresh} onSave={(internalNotes) => saveDetails({ details: { internalNotes } })} placeholder={t("Not provided")} value={text(enquiryDetails.internalNotes)} /> : null}
            </EditableFieldList>
          </SideSection>
          <SideSection title={t("Source")}>
            <EditableFieldList layout="stacked">
              {sourceFacts.map(([name, value]) => <FactRow key={name} label={name}>{value}</FactRow>)}
              <EditableField canEdit={canEdit} label={t("Campaign")} maxLength={160} onReload={resource.refresh} onSave={(campaign) => saveDetails({ details: { campaign } })} placeholder={t("Not provided")} value={text(enquiryDetails.campaign)} />
              <FactRow label={t("Attribution")}>{attribution.length ? <ul className={styles.attribution}>{attribution.map((touch) => <li key={String(touch.id)}><strong>{label(String(touch.source))}</strong> <small>{[touch.medium ? label(String(touch.medium)) : null, touch.campaign, touch.content].filter(Boolean).map(String).join(" · ") || t("Direct attribution")} · {dateText(touch.touchedAt, zoned)}</small>{touch.referrer ? <small>{String(touch.referrer)}</small> : null}</li>)}</ul> : t("No campaign attribution was supplied.")}</FactRow>
              <FactRow label={t("Original enquiry")}><span className={styles.original}>{String((enquiry?.originalSubmission as RecordData | undefined)?.summary ?? t("No project description provided"))}</span></FactRow>
              {live.duplicateOfLeadId && live.status !== "duplicate" ? <FactRow label={t("Duplicate enquiry")}><a className={styles.link} href={`/workspace/crm/leads?lead=${String(live.duplicateOfLeadId)}`}>{t("Open the original")}</a></FactRow> : null}
              <FactRow label={t("Created")}>{dateText(live.createdAt, zoned)}</FactRow>
              <FactRow label={t("Last updated")}>{dateText(live.updatedAt, zoned)}</FactRow>
            </EditableFieldList>
          </SideSection>
          <SideSection title={t("History")}><ChangeHistory workspaceId={workspaceId} leadId={lead.id} members={initialData.members} /></SideSection>
        </RecordPanel> },
        { id: "files", label: t("Files"), panel: <RecordAttachments workspaceId={workspaceId} leadId={lead.id} /> },
      ]} />

    {editing && detail ? <LeadEnquiryForm initialData={initialData} existing={{ id: lead.id, version, reference: String(enquiry?.reference ?? lead.reference ?? ""), title: String(enquiry?.title ?? lead.title), summary: String(enquiry?.summary ?? ""), serviceType: String(enquiry?.serviceType ?? lead.serviceType ?? ""), details: enquiryDetails, source: String(enquiry?.source ?? lead.source ?? ""), channel: String(enquiry?.channel ?? lead.channel ?? ""), referral: (enquiry?.referral ?? null) as never, party: { ...contact, displayName: String(enquiry?.partyName ?? lead.partyName), email: String(enquiry?.primaryEmail ?? contact.email ?? ""), phone: String(enquiry?.primaryPhone ?? contact.phone ?? ""), mobile: String(enquiry?.primaryMobile ?? contact.mobile ?? "") }, customFields: lead.customFields, team, notesVisible }} initialProblems={editing === "complete" ? conversionMissing : undefined} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await saved(); }} /> : null}
    {scheduling && <NewFollowUpDialog workspaceId={workspaceId} initialLead={{ ...live }} onClose={() => setScheduling(false)} onCreated={async () => { await saved(); setScheduling(false); }} />}
    {contacting && <LogContactDialog workspaceId={workspaceId} slaPolicies={initialData.slaPolicies} lead={{ id: lead.id, version: Number(version), name: customerDisplayName(lead.partyName) }} onClose={() => setContacting(false)} onLogged={async () => { setContacting(false); await saved(); }} />}
    {assigning && <LeadAssignmentDialog lead={live} members={salesOwnerChoices(initialData)} workspaceId={workspaceId} onClose={() => setAssigning(false)} onSaved={saved} />}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={saved} /> : null}
  </RecordFrame>;
}

function InlineStageEditor({ initialStage = "", lead, workspaceId, onCancel, onSaved }: { initialStage?: string; lead: CrmLeadListItem; workspaceId: string; onCancel: () => void; onSaved: () => Promise<void> }) {
  const t = useT();
  // The follow-up is the workspace's wall clock (its region's zone).
  const { timeZone } = useDesignSystem();
  const stage = initialStage;
  const inFlight = useRef(false);
  const [persisted, setPersisted] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  return <Form className={styles.inlineStageEditor} aria-label={t("Update enquiry stage")} fieldMarkers="none" onSubmit={async event => {
    event.preventDefault(); if (inFlight.current || persisted || !stage) return;
    inFlight.current = true;
    setBusy(true); setFailure("");
    try {
      if (stage === "disqualified" && !reason.trim()) throw new Error(t("Add a reason for disqualifying this enquiry."));
      const nextActionAt = nextDate && !["disqualified", "paused"].includes(stage) ? zonedDateTimeToIso(nextDate, timeZone) : null;
      if (nextDate && !["disqualified", "paused"].includes(stage) && !nextActionAt) throw new Error(t("Choose the next follow-up date and time."));
      await crmRequest(workspaceId, `leads/${lead.id}/status`, "POST", { ...(nextActionAt ? { nextActionAt } : {}), version: lead.version, status: stage, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(lead.nextActionAt && !["qualified", "disqualified", "paused"].includes(stage) ? { nextActionAt: lead.nextActionAt } : {}) });
      setPersisted(true);
      try { await onSaved(); } catch { setFailure(t("Stage saved. Refresh the enquiry to see the change.")); }
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Stage could not be updated.")); }
    finally { inFlight.current = false; setBusy(false); }
  }}>
    {failure && <Callout tone={persisted ? "warning" : "danger"} title={persisted ? t("Stage saved. Refresh needed.") : t("Stage not updated")}>{failure}</Callout>}
    <strong>{t("Change stage to {stage}", { stage: t(leadStageLabel(stage)) })}</strong>
    {stage && !["disqualified", "paused"].includes(stage) && !lead.ownerMembershipId && !lead.nextActionAt && <CrmDateTimeField label={t("Next follow-up")} isRequired value={nextDate} isDisabled={busy} onChange={setNextDate} />}
    {stage === "disqualified" && <TextInput label={t("Reason")} value={reason} onChange={setReason} isRequired isDisabled={busy} />}
    <div className={styles.actions}><Button size="compact" isDisabled={busy} onPress={onCancel}>{t("Cancel")}</Button><Button size="compact" type="submit" variant="primary" isDisabled={!stage || persisted} isLoading={busy}>{t("Save stage")}</Button></div>
  </Form>;
}

type Referral = { kind?: string; name?: string | null; contact?: string | null; memberName?: string | null; option?: string | null };
function referralText(referral: Referral, t: Translate, options?: { referralBrokers?: { id: string; label: string }[]; referralPartners?: { id: string; label: string }[] }) {
  if (referral.kind === "internal") return referral.memberName ?? t("Team member");
  if (referral.kind === "broker" || referral.kind === "partner") {
    const list = referral.kind === "broker" ? options?.referralBrokers : options?.referralPartners;
    return list?.find((entry) => entry.id === referral.option)?.label ?? referral.option ?? "";
  }
  return [referral.name, referral.contact].filter(Boolean).join(" · ");
}
