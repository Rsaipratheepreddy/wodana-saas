"use client";

import { useState } from "react";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { ActivityFeed, Badge, Button, Callout, EditableField, EditableFieldList, EmptyState, IconMenuButton, useDesignSystem, type ActionItem } from "@/design-system";
import { CrmRequestError, crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { clientTimelineItems } from "@/lib/crm/client-timeline";
import type { ClientTimelineEvent } from "@wodana/contracts";
import { activityTitle } from "@/lib/crm/contact";
import { pendingFollowUp } from "@/lib/crm/now-step";
import { formatPhoneForDisplay } from "@/lib/phone";
import { caseHref } from "@/lib/pre-project/types";
import { useT } from "@/lib/i18n/i18n-provider";
import { RaiseFinanceRequest, useCanRaiseFinanceRequest } from "../finance-requests/raise-request";
import { ActionDialog, ActivityPanel, ResourceState, activityQuery, addActivityAction, choice, completeActivityAction, options, rescheduleActivityAction, useCrmResource, type ActionSpec } from "./crm-workbench";
import { FollowUpRow } from "./opportunity-now";
import { RecordAttachments } from "./record-attachments";
import { NextStepCard, RecordColumns, RecordFrame, RecordHeader, RecordPanel, RecordStrip, SideSection, StripItem } from "./record/record-layout";
import { useWoddyRecord } from "./woddy-chat";
import styles from "./crm-workbench.module.css";

function RelatedRecords({ workspaceId, partyId, collection }: { workspaceId: string; partyId: string; collection: "opportunities" | "conversations" }) {
  const t = useT();
  const [cursor, setCursor] = useState("");
  const path = `${collection}?partyId=${partyId}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const resource = useCrmResource<{ data: RecordData[]; nextCursor?: string }>(workspaceId, path);
  return <div className={styles.stack}><ResourceState {...resource} retry={resource.refresh} />{resource.data?.data.map((item) => <div className={styles.row} key={item.id}><div><strong>{String(item.title ?? item.subject ?? label(item.channel))}</strong><small>{[item.stageName ? String(item.stageName) : null, label(item.status)].filter(Boolean).join(" · ")}</small></div><div className={styles.actions}>{item.preProjectCaseId ? <a className={styles.link} href={caseHref(String(item.preProjectCaseId), new URLSearchParams(), "overview")}>{t("Open in Planning")}</a> : null}<a className={styles.link} href={`/workspace/crm/${collection}?record=${item.id}`}>{collection === "opportunities" ? t("Open opportunity") : t("Open conversation")}</a></div></div>)}{resource.data && !resource.data.data.length ? <p>{collection === "opportunities" ? t("No linked opportunities yet.") : t("No linked conversations yet.")}</p> : null}<div className={styles.actions}>{cursor ? <Button size="compact" onPress={() => setCursor("")}>{t("Back to first page")}</Button> : null}{resource.data?.nextCursor ? <Button size="compact" onPress={() => setCursor(resource.data?.nextCursor ?? "")}>{t("Next page")}</Button> : null}</div></div>;
}

/** Every time zone, with one already chosen kept even if the runtime doesn't list it. */
function timeZoneItems(current: string) {
  const zones = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return [...new Set([...(current ? [current] : []), ...zones])].map((id) => ({ id, label: id.replaceAll("_", " ") }));
}

/** A client (§5c D.7): the next follow-up and the activity beside Overview · Opportunities & projects · Details · Files. */
export function CustomerPanel({ workspaceId, partyId, onChanged }: { workspaceId: string; partyId: string; onChanged?: () => Promise<void> | void }) {
  const t = useT();
  useWoddyRecord("customer", partyId, t("Customer profile"));
  const resource = useCrmResource<RecordData>(workspaceId, `parties/${partyId}`);
  const enquiries = useCrmResource<unknown>(workspaceId, `enquiries?partyId=${partyId}&limit=100`);
  const relatedParties = useCrmResource<unknown>(workspaceId, "parties?limit=100");
  // One load of the client's activities: the next step reads the pending follow-up, the activity lists them all.
  const activities = useCrmResource<unknown>(workspaceId, `activities?${activityQuery({ partyId })}`);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [askingFinance, setAskingFinance] = useState(false);
  const canAskFinance = useCanRaiseFinanceRequest(workspaceId);
  const party = resource.data;
  const contacts = (party?.contacts ?? []) as RecordData[];
  const addresses = (party?.addresses ?? []) as RecordData[];
  const { locale, timeZone } = useDesignSystem();
  const timeline = clientTimelineItems((party?.clientTimeline ?? []) as ClientTimelineEvent[], String(party?.displayName ?? t("Client")), { t, locale, timeZone });
  const timelineAccess = party?.clientTimelineAccess as { communications?: boolean; activities?: boolean } | undefined;
  const saved = async () => { resource.refresh(); enquiries.refresh(); relatedParties.refresh(); activities.refresh(); await onChanged?.(); };
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
  const nextTask = pendingFollowUp(rows(activities.data));
  const others = rows(relatedParties.data).filter((item) => item.id !== partyId && item.status === "active");
  const withLeads = rows(enquiries.data).filter((enquiry) => enquiry.leadId);
  // Merge, archive and erasure: the record's own controls, in its ⋯ menu.
  const menu: ActionItem[] = !party ? [] : [
    ...(canAskFinance && party.status === "active" ? [{ id: "finance", label: t("Request from Finance") }] : []),
    { id: "merge", label: t("Merge duplicate"), isDisabled: party.status !== "active" || relatedParties.loading },
    { id: "archive", label: t("Archive record"), isDisabled: party.status !== "active" },
    { id: "erase", label: t("Privacy erasure"), tone: "danger", isDisabled: party.status !== "active" },
  ];
  const onMenu = (id: string) => {
    if (!party) return;
    if (id === "finance") setAskingFinance(true);
    else if (id === "merge") setAction({ title: t("Merge a duplicate into this record"), description: t("The selected duplicate will be marked as merged and its CRM history will move to this surviving record."), path: "parties/merge", initial: { survivorPartyId: partyId, fieldDecisions: { displayName: "survivor" } }, fields: [{ key: "mergedPartyId", label: t("Duplicate record"), options: options(others, "displayName"), required: true }, { key: "reason", label: t("Reason"), required: true }], submit: t("Merge duplicate") });
    else if (id === "archive") setAction({ title: t("Archive customer record"), description: t("Archived records remain available in CRM history and can be included in search and exports."), path: `parties/${partyId}/archive`, initial: { version: party.version }, fields: [{ key: "reason", label: t("Reason"), required: true }], submit: t("Archive record") });
    else setAction({ title: t("Erase private customer data"), description: t("This removes contact details and personal profile data while retaining the anonymous audit record."), path: `parties/${partyId}/privacy-erasure`, initial: { version: party.version }, fields: [{ key: "reason", label: t("Erasure reason"), required: true }, { key: "confirmation", label: t("Type ERASE to confirm"), required: true }], transform: ({ confirmation, ...values }) => { if (confirmation !== "ERASE") throw new Error(t("Type ERASE exactly to confirm privacy erasure.")); return values; }, submit: t("Erase private data"), submitVariant: "danger" });
  };
  const addActivity = () => setAction(addActivityAction(t, { partyId }));
  return <RecordFrame className={styles.workbench}><ResourceState {...resource} retry={resource.refresh} />{party ? <>
    <RecordHeader title={<EditableField canEdit={editable} heading="h2" isRequired kind={party.type === "person" ? "person-name" : "text"} label={t("Display name")} maxLength={240} onReload={resource.refresh} onSave={(displayName) => updateParty({ displayName })} value={String(party.displayName)} />}
      actions={<IconMenuButton ariaLabel={t("More actions")} items={menu} onAction={onMenu} />} />
    <RecordStrip label={t("Client status")}>
      <EditableField canEdit={editable} display={label(party.lifecycle)} items={["prospect", "customer", "partner", "vendor", "other"].map((id) => ({ id, label: label(id) }))} kind="select" label={t("Lifecycle")}
        onReload={resource.refresh} onSave={(lifecycle) => updateParty({ lifecycle })} value={text(party.lifecycle)} />
      <StripItem label={t("Type")}>{label(party.type)}</StripItem>
      <StripItem label={t("Status")}><Badge tone={party.status === "active" ? "neutral" : "warning"}>{label(party.status)}</Badge></StripItem>
    </RecordStrip>
    <RecordColumns sideLabel={t("Key facts")}
      next={editable ? <NextStepCard title={t("Next follow-up")}>
        {nextTask ? <FollowUpRow title={activityTitle(nextTask, t)} due={String(nextTask.dueAt ?? "")} onComplete={() => setAction(completeActivityAction(t, nextTask))} onReschedule={() => setAction(rescheduleActivityAction(t, nextTask))} />
          : <FollowUpRow onBook={addActivity} />}
      </NextStepCard> : null}
      activity={<>
        <ActivityPanel title={t("Activity")} workspaceId={workspaceId} partyId={partyId} activities={activities} onChanged={saved} />
        <SideSection title={t("Timeline")}>
          {timelineAccess && (!timelineAccess.communications || !timelineAccess.activities) ? <Callout title={t("Timeline access is limited")} tone="warning">{t("Some communication or activity records are hidden by your role.")}</Callout> : null}
          {timeline.length ? <ActivityFeed items={timeline} /> : <p className={styles.empty}>{t("No client communication yet")}</p>}
        </SideSection>
        <SideSection title={t("Conversations")}><RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="conversations" /></SideSection>
      </>}
      tabs={[
        { id: "overview", label: t("Overview"), panel: <RecordPanel>
          <SideSection title={t("Key facts")}>
            <EditableFieldList>
              {party.type === "person" ? <>
                <EditableField canEdit={editable} label={t("Given name")} maxLength={120} onReload={resource.refresh} onSave={(givenName) => updateParty({ givenName: givenName || null })} value={text(party.givenName)} />
                <EditableField canEdit={editable} label={t("Family name")} maxLength={120} onReload={resource.refresh} onSave={(familyName) => updateParty({ familyName: familyName || null })} value={text(party.familyName)} />
                <EditableField canEdit={editable} label={t("Job title")} maxLength={160} onReload={resource.refresh} onSave={(jobTitle) => updateParty({ jobTitle: jobTitle || null })} value={text(party.jobTitle)} />
              </> : <>
                <EditableField canEdit={editable} label={t("Legal name")} maxLength={240} onReload={resource.refresh} onSave={(legalName) => updateParty({ legalName: legalName || null })} value={text(party.legalName)} />
                <EditableField canEdit={editable} label={t("Website domain")} maxLength={255} onReload={resource.refresh} onSave={(websiteDomain) => updateParty({ websiteDomain: websiteDomain || null })} value={text(party.websiteDomain)} />
                <EditableField canEdit={editable} label={t("Industry")} maxLength={120} onReload={resource.refresh} onSave={(industry) => updateParty({ industry: industry || null })} value={text(party.industry)} />
              </>}
              {phone ? <EditableField canEdit={editable} countryCode={text(phone.countryCode)} display={formatPhoneForDisplay(text(phone.rawValue ?? phone.value))} isRequired kind="phone" label={t("Phone")} onReload={resource.refresh}
                onSave={(value, { countryCode }) => update(`parties/${partyId}/contact-points/${phone.id}`, { version: phone.version, value, ...(countryCode ? { countryCode } : {}) })} value={text(phone.rawValue ?? phone.value)} /> : null}
              {email ? <EditableField canEdit={editable} isRequired kind="email" label={t("Email")} onReload={resource.refresh}
                onSave={(value) => update(`parties/${partyId}/contact-points/${email.id}`, { version: email.version, value })} value={text(email.rawValue ?? email.value)} /> : null}
            </EditableFieldList>
          </SideSection>
          <SideSection title={t("Preferences")}>
            <EditableFieldList layout="stacked">
              <EditableField canEdit={editable} label={t("Preferred language / locale")} maxLength={35} onReload={resource.refresh} onSave={(preferredLocale) => updateParty({ preferredLocale: preferredLocale || null })} value={text(party.preferredLocale)} />
              <EditableField canEdit={editable} items={timeZoneItems(text(party.preferredTimezone))} kind="select" label={t("Preferred timezone")} onReload={resource.refresh} onSave={(preferredTimezone) => updateParty({ preferredTimezone: preferredTimezone || null })} value={text(party.preferredTimezone)} />
            </EditableFieldList>
          </SideSection>
        </RecordPanel> },
        { id: "opportunities", label: t("Opportunities & projects"), panel: <RecordPanel>
          <SideSection title={t("Opportunities")}><RelatedRecords workspaceId={workspaceId} partyId={partyId} collection="opportunities" /></SideSection>
          <SideSection title={t("Enquiries")}><ResourceState {...enquiries} retry={enquiries.refresh} />{rows(enquiries.data).map((enquiry) => <div className={styles.row} key={enquiry.id}><div><strong>{String(enquiry.title)}</strong><small>{label(enquiry.leadStatus ?? enquiry.status)} · {dateText(enquiry.receivedAt)}</small></div>{enquiry.leadId ? <a className={styles.link} href={`/workspace/crm/leads?lead=${enquiry.leadId}`}>{t("Open enquiry")}</a> : null}</div>)}{enquiries.data && !rows(enquiries.data).length ? <p className={styles.empty}>{t("No enquiries yet")}</p> : null}</SideSection>
        </RecordPanel> },
        { id: "details", label: t("Details"), panel: <RecordPanel>
          <SideSection title={t("Contact")} action={<Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Add contact"), path: `parties/${partyId}/contact-points`, fields: [{ key: "type", label: t("Type"), options: choice(["email", "phone"]), required: true }, { key: "value", label: t("Contact details"), required: true }, { key: "isPrimary", label: t("Primary"), type: "checkbox" }] })}><Plus aria-hidden="true" size={14} />{t("Add contact")}</Button>}>
            {contacts.map((contact) => <div className={styles.row} key={contact.id}><div><strong>{String(contact.rawValue ?? contact.value ?? "")}</strong><small>{label(contact.type)}{contact.isPrimary ? ` · ${t("Primary")}` : ""}</small></div><Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Edit contact"), path: `parties/${partyId}/contact-points/${contact.id}`, method: "PATCH", initial: { version: contact.version, value: contact.rawValue, isPrimary: contact.isPrimary }, fields: [{ key: "value", label: label(contact.type), type: contact.type === "email" ? "email" : "text", required: true }, { key: "isPrimary", label: t("Primary contact"), type: "checkbox" }] })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div>)}
          </SideSection>
          <SideSection title={t("Addresses")} action={<Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Add address"), path: `parties/${partyId}/addresses`, fields: [{ key: "label", label: t("Label") }, { key: "line1", label: t("Street") }, { key: "line2", label: t("Building / suite") }, { key: "locality", label: t("City"), required: true }, { key: "region", label: t("State / region") }, { key: "postalCode", label: t("Postal code") }, { key: "countryCode", label: t("Country code (two letters)"), required: true }, { key: "isPrimary", label: t("Primary address"), type: "checkbox" }], transform: (v) => ({ ...v, countryCode: String(v.countryCode).toUpperCase() }) })}><Plus aria-hidden="true" size={14} />{t("Add address")}</Button>}>
            {addresses.map((address) => <div className={styles.row} key={address.id}><div><strong>{String(address.label ?? t("Address"))}</strong><small>{[address.line1, address.line2, address.locality, address.region, address.postalCode, address.countryCode].filter(Boolean).join(", ")}</small></div><Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Edit address"), path: `parties/${partyId}/addresses/${address.id}`, method: "PATCH", initial: { version: address.version, label: address.label, line1: address.line1, line2: address.line2, locality: address.locality, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode, isPrimary: address.isPrimary }, fields: [{ key: "label", label: t("Label") }, { key: "line1", label: t("Street") }, { key: "line2", label: t("Building / suite") }, { key: "locality", label: t("City") }, { key: "region", label: t("State / region") }, { key: "postalCode", label: t("Postal code") }, { key: "countryCode", label: t("Country code (two letters)"), required: true }, { key: "isPrimary", label: t("Primary address"), type: "checkbox" }], transform: (values) => ({ ...values, countryCode: String(values.countryCode).toUpperCase() }) })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div>)}
          </SideSection>
          <SideSection title={t("Relationships")} action={<Button size="compact" variant="quiet" isDisabled={relatedParties.loading || Boolean(relatedParties.failure)} onPress={() => setAction({ title: t("Add relationship"), path: "relationships", initial: { fromPartyId: partyId }, fields: [{ key: "toPartyId", label: t("Related customer or organization"), options: options(others, "displayName"), required: true }, { key: "type", label: t("Relationship"), options: choice(["works_for", "referred_by", "consultant_for", "partner_of"]), required: true }, { key: "label", label: t("Notes") }, { key: "isPrimary", label: t("Primary relationship"), type: "checkbox" }] })}><Plus aria-hidden="true" size={14} />{t("Add relationship")}</Button>}>
            {((party.relationships ?? []) as RecordData[]).map((relationship) => <div className={styles.row} key={relationship.id}><div><strong>{String(relationship.fromPartyName)} → {String(relationship.toPartyName)}</strong><small>{label(relationship.type)}{relationship.endedAt ? ` · ${t("Ended")}` : ""}</small></div><div className={styles.actions}><a className={styles.link} href={`/workspace/crm/customers?record=${relationship.fromPartyId === partyId ? relationship.toPartyId : relationship.fromPartyId}`}>{t("Open profile")}</a><Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Edit relationship"), path: `relationships/${relationship.id}`, method: "PATCH", initial: { version: relationship.version, label: relationship.label, isPrimary: relationship.isPrimary, endedAt: relationship.endedAt }, fields: [{ key: "label", label: t("Notes") }, { key: "isPrimary", label: t("Primary relationship"), type: "checkbox" }, { key: "endedAt", label: relationship.endedAt ? t("Ended at") : t("End relationship at"), type: "datetime-local" }] })}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div></div>)}
            <ResourceState {...relatedParties} retry={relatedParties.refresh} />
          </SideSection>
          <SideSection title={t("Consent")} action={<Button size="compact" variant="quiet" onPress={() => setAction({ title: t("Record consent"), path: `parties/${partyId}/consents`, fields: [{ key: "channel", label: t("Channel"), options: choice(["email", "phone", "whatsapp"]), required: true }, { key: "purpose", label: t("Purpose"), options: choice(["service", "marketing"]), required: true }, { key: "status", label: t("Customer decision"), options: choice(["granted", "denied", "withdrawn"]), required: true }, { key: "evidenceNote", label: t("How and when was this received?"), required: true }], transform: ({ evidenceNote, ...v }) => ({ ...v, evidence: { note: evidenceNote, method: "manual_record" } }) })}><ShieldCheck aria-hidden="true" size={14} />{t("Record consent")}</Button>}>
            {((party.consents ?? []) as RecordData[]).map((c) => <div className={styles.row} key={c.id}><strong>{label(c.channel)} · {String(c.purpose)}</strong><Badge tone="neutral">{label(c.status)}</Badge></div>)}
          </SideSection>
        </RecordPanel> },
        { id: "files", label: t("Files"), panel: withLeads.length ? <RecordPanel>{withLeads.map((enquiry) => <SideSection key={String(enquiry.id)} title={String(enquiry.title ?? t("Enquiry"))}><RecordAttachments workspaceId={workspaceId} leadId={String(enquiry.leadId)} /></SideSection>)}</RecordPanel>
          : <EmptyState illustration="upload" title={t("No enquiry files")} description={t("Project files live in Planning.")} /> },
      ]} />
  </> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}
    {askingFinance ? <RaiseFinanceRequest workspaceId={workspaceId} origin={{ partyId }} onClose={() => setAskingFinance(false)} /> : null}</RecordFrame>;
}
